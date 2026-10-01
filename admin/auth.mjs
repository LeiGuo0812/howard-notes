const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
const PENDING_KEY = "howard-login-pending"
const LOGIN_MS = 300000
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/

export function brokerOrigin(value) {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("登录服务地址不正确。")
  return url.origin
}
export function acceptsMessage(event, popup, origin, channel) {
  return event.source === popup && event.origin === origin && acceptsResult(event.data, channel)
}
export function acceptsResult(data, channel) {
  return (
    data?.type === "howard-github-auth" &&
    data.channel === channel &&
    ((typeof data.error === "string" && data.error.length > 0 && data.error.length <= 300) ||
      (typeof data.token === "string" &&
        data.token.length >= 16 &&
        data.token.length <= 500 &&
        typeof data.login === "string" &&
        data.login.length > 0 &&
        data.login.length <= 100 &&
        Number.isSafeInteger(data.serverTime) &&
        data.serverTime > 0 &&
        Number.isSafeInteger(data.expiresAt) &&
        data.expiresAt > data.serverTime &&
        data.expiresAt - data.serverTime <= 28800000))
  )
}

async function requestJSON(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      ...options,
      signal: controller.signal,
    })
    return { response, data: await response.json() }
  } finally {
    clearTimeout(timeout)
  }
}
async function loginOrigin(configUrl) {
  const url = new URL(configUrl ?? "auth-config.json", location.href)
  if (url.origin !== location.origin || url.username || url.password)
    throw new Error("登录设置地址不正确。")
  const { response, data } = await requestJSON(url)
  if (!response.ok) throw new Error("无法读取登录设置，请刷新后重试。")
  if (!data.brokerOrigin) throw new Error("账号登录尚未开通，请先完成首次配置。")
  return brokerOrigin(data.brokerOrigin)
}
function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Login tokens are never stored; an unavailable proof store cannot block cleanup.
  }
}
function closePopup(popup) {
  try {
    popup?.close()
  } catch {
    // COOP may sever the window reference while the authorization page remains open.
  }
}
function waitForResult(pending) {
  return new Promise((resolve, reject) => {
    let done = false,
      requesting = false,
      timer
    const finish = (error, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(timeout)
      window.removeEventListener("focus", wake)
      document.removeEventListener("visibilitychange", wake)
      if (error) reject(error)
      else resolve(value)
    }
    const poll = async () => {
      clearTimeout(timer)
      if (done || requesting) return
      if (Date.now() >= pending.expires) return finish(new Error("登录已超时，请重试。"))
      if (document.visibilityState === "hidden") return
      requesting = true
      try {
        const { response, data } = await requestJSON(`${pending.origin}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: pending.channel, secret: pending.secret }),
        })
        if (done) return
        if (response.status === 200) {
          if (!acceptsResult(data, pending.channel))
            return finish(new Error("登录返回信息不正确，请重新登录。"))
          return data.error ? finish(new Error(data.error)) : finish(null, data)
        }
        if ([400, 401, 403, 404, 410].includes(response.status))
          return finish(
            new Error(
              typeof data.error === "string" && data.error.length > 0 && data.error.length <= 300
                ? data.error
                : "登录已失效，请重新登录。",
            ),
          )
        // Pending results, temporary network failures and server limits remain retryable.
      } catch {
        // A mobile tab can lose its network while GitHub is in front; retry on return.
      } finally {
        requesting = false
        if (!done && document.visibilityState !== "hidden") timer = setTimeout(poll, 1500)
      }
    }
    const wake = () => {
      if (document.visibilityState !== "hidden") void poll()
    }
    const timeout = setTimeout(
      () => finish(new Error("登录已超时，请重试。")),
      Math.max(0, pending.expires - Date.now()),
    )
    window.addEventListener("focus", wake)
    document.addEventListener("visibilitychange", wake)
    void poll()
  })
}

// A popup is opened synchronously from the click when the current editor must stay intact.
// Initial login always uses the same tab; only a short-lived claim proof survives navigation.
// GitHub credentials remain in memory and never enter storage or URLs.
export async function signIn({ preservePage = false, configUrl, returnTo } = {}) {
  const channel = encode(crypto.getRandomValues(new Uint8Array(32)))
  const redirect = !preservePage
  const popup = redirect
    ? null
    : window.open("", `howard-login-${channel}`, "popup,width=540,height=720")
  if (!redirect && !popup) throw new Error("请允许此网站打开登录窗口，再点击登录。")
  if (popup) {
    popup.document.title = "正在连接 GitHub…"
    popup.document.body.textContent = "正在连接 GitHub…"
  }
  try {
    let returnUrl
    if (returnTo !== undefined) {
      if (
        typeof returnTo !== "string" ||
        !returnTo ||
        returnTo.length > 2048 ||
        /[\u0000-\u0020\u007f\\]/.test(returnTo)
      )
        throw new Error("登录返回地址不正确。")
      const target = new URL(returnTo, location.href)
      if (
        target.origin !== location.origin ||
        target.username ||
        target.password ||
        target.href.length > 2048
      )
        throw new Error("登录返回地址不正确。")
      returnUrl = target.href
    }
    const origin = await loginOrigin(configUrl)
    const secret = encode(crypto.getRandomValues(new Uint8Array(32)))
    const challenge = encode(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))),
    )
    const pending = { channel, secret, origin, expires: Date.now() + LOGIN_MS }
    const prepared = await requestJSON(`${origin}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, challenge }),
    })
    if (!prepared.response.ok || prepared.data.ready !== true)
      throw new Error(
        typeof prepared.data.error === "string" &&
          prepared.data.error.length > 0 &&
          prepared.data.error.length <= 300
          ? prepared.data.error
          : "无法准备 GitHub 登录，请稍后重试。",
      )
    const login = new URL("/login", origin)
    login.search = new URLSearchParams({
      channel,
      challenge,
      mode: redirect ? "redirect" : "popup",
      ...(returnUrl ? { returnTo: returnUrl } : {}),
    }).toString()
    if (redirect) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
        if (sessionStorage.getItem(PENDING_KEY) !== JSON.stringify(pending)) throw new Error()
      } catch {
        clearPending()
        throw new Error("浏览器禁止临时登录存储，请允许此网站使用存储后重试。")
      }
      location.assign(login.href)
      return null
    }
    popup.location.replace(login.href)
    return await waitForResult(pending)
  } catch (error) {
    if (error.name === "AbortError") throw new Error("连接登录服务超时，请检查网络后重试。")
    if (error.name === "TypeError") throw new Error("无法连接登录服务，请检查网络后重试。")
    throw error
  } finally {
    closePopup(popup)
  }
}

export async function resumeSignIn({ configUrl } = {}) {
  const url = new URL(location.href)
  const channel = url.searchParams.get("login")
  if (url.searchParams.has("login")) {
    url.searchParams.delete("login")
    window.history.replaceState(null, "", url.href)
  }
  let stored
  try {
    stored = sessionStorage.getItem(PENDING_KEY)
  } catch {
    if (channel) throw new Error("浏览器无法恢复登录，请允许此网站使用存储后重试。")
    return null
  }
  if (!stored && !channel) return null
  try {
    const pending = JSON.parse(stored || "null")
    if (
      !pending ||
      !RANDOM_VALUE.test(pending.channel || "") ||
      !RANDOM_VALUE.test(pending.secret || "") ||
      (channel !== null && channel !== pending.channel) ||
      !Number.isFinite(pending.expires) ||
      pending.expires <= Date.now() ||
      pending.expires > Date.now() + LOGIN_MS ||
      brokerOrigin(pending.origin) !== (await loginOrigin(configUrl))
    )
      throw new Error("登录已失效，请重新登录。")
    return await waitForResult(pending)
  } finally {
    clearPending()
  }
}
