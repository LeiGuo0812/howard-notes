const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
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
  const data = event.data
  return (
    event.source === popup &&
    event.origin === origin &&
    data?.type === "howard-github-auth" &&
    data.channel === channel &&
    ((typeof data.error === "string" && data.error.length <= 300) ||
      (typeof data.token === "string" &&
        data.token.length >= 16 &&
        data.token.length <= 500 &&
        typeof data.login === "string" &&
        Number.isFinite(data.expiresAt) &&
        data.expiresAt > Date.now() &&
        data.expiresAt <= Date.now() + 28800000))
  )
}

// Call directly from a click so mobile/desktop browsers permit the login window.
// Credentials never enter localStorage, sessionStorage, URLs or source files.
export async function signIn() {
  const channel = encode(crypto.getRandomValues(new Uint8Array(32)))
  const popup = window.open("", `howard-login-${channel}`, "popup,width=540,height=720")
  if (!popup) throw new Error("请允许此网站打开登录窗口，再点击登录。")
  popup.document.title = "正在连接 GitHub…"
  popup.document.body.textContent = "正在连接 GitHub…"
  try {
    const response = await fetch(new URL("auth-config.json", location.href), { cache: "no-store" })
    if (!response.ok) throw new Error("无法读取登录设置，请刷新后重试。")
    const config = await response.json()
    if (!config.brokerOrigin) throw new Error("账号登录尚未开通，请先完成首次配置。")
    const origin = brokerOrigin(config.brokerOrigin)
    return await new Promise((resolve, reject) => {
      let done = false
      const finish = (error, value) => {
        if (done) return
        done = true
        window.removeEventListener("message", receive)
        clearInterval(closed)
        clearTimeout(timeout)
        popup.close()
        if (error) reject(error)
        else resolve(value)
      }
      const receive = (event) => {
        if (!acceptsMessage(event, popup, origin, channel)) return
        if (event.data.error) finish(new Error(event.data.error))
        else finish(null, event.data)
      }
      const closed = setInterval(() => {
        if (popup.closed) finish(new Error("已取消登录。"))
      }, 500)
      const timeout = setTimeout(() => finish(new Error("登录已超时，请重试。")), 300000)
      window.addEventListener("message", receive)
      popup.location.replace(`${origin}/login?channel=${channel}`)
    })
  } catch (error) {
    popup.close()
    throw error
  }
}
