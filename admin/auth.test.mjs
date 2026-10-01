import test from "node:test"
import assert from "node:assert/strict"
import { acceptsMessage, acceptsResult, brokerOrigin, resumeSignIn, signIn } from "./auth.mjs"
test("login only accepts credentials from its own popup, exact origin and random channel", () => {
  const popup = {},
    origin = "https://auth.example.test",
    channel = "c".repeat(43)
  const event = {
    source: popup,
    origin,
    data: {
      type: "howard-github-auth",
      channel,
      token: "ghu_mock-authorized-user",
      login: "LeiGuo0812",
      serverTime: Date.now(),
      expiresAt: Date.now() + 3600000,
    },
  }
  assert.equal(acceptsMessage(event, popup, origin, channel), true)
  for (const change of [
    { source: {} },
    { origin: "https://evil.test" },
    { data: { ...event.data, channel: "other" } },
    { data: { ...event.data, expiresAt: 1 } },
    { data: { ...event.data, token: "" } },
  ])
    assert.equal(acceptsMessage({ ...event, ...change }, popup, origin, channel), false)
})
test("broker config accepts only HTTPS origins without credentials or redirects", () => {
  assert.equal(brokerOrigin("https://auth.example.test/"), "https://auth.example.test")
  for (const value of [
    "http://auth.example.test",
    "https://user:pass@auth.example.test",
    "https://auth.example.test/login",
    "https://auth.example.test/?next=evil",
    "javascript:alert(1)",
  ])
    assert.throws(() => brokerOrigin(value))
})

const pendingKey = "howard-login-pending"
const result = (channel) => ({
  type: "howard-github-auth",
  channel,
  token: "ghu_mock-owner-short-lived-token",
  login: "LeiGuo0812",
  serverTime: Date.now(),
  expiresAt: Date.now() + 3600000,
})
function browser(t, { mobile = false, blockedStorage = false, popupAllowed = true } = {}) {
  const originals = new Map()
  const replace = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  const store = new Map()
  let navigated = "",
    closed = 0,
    opened = 0
  const popup = {
    document: { title: "", body: { textContent: "" } },
    location: { replace: (value) => (navigated = value) },
    close: () => closed++,
    get closed() {
      throw new Error("The COOP-severed window reference must not decide login cancellation")
    },
  }
  const location = new URL("https://leiguo0812.github.io/howard-notes/admin/")
  location.assign = (value) => (navigated = value)
  const window = new EventTarget()
  window.innerWidth = mobile ? 390 : 1440
  window.matchMedia = () => ({ matches: mobile })
  window.open = () => {
    opened++
    return popupAllowed ? popup : null
  }
  window.history = { replaceState: (_state, _title, value) => (location.href = value) }
  const document = new EventTarget()
  document.visibilityState = "visible"
  replace("window", window)
  replace("document", document)
  replace("location", location)
  replace("sessionStorage", {
    getItem: (key) => {
      if (blockedStorage) throw new Error("Storage denied")
      return store.get(key) || null
    },
    setItem: (key, value) => {
      if (blockedStorage) throw new Error("Storage denied")
      store.set(key, value)
    },
    removeItem: (key) => store.delete(key),
  })
  const calls = []
  let resultCalls = 0
  replace("fetch", async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith("auth-config.json"))
      return Response.json({ brokerOrigin: "https://login.example.test" })
    if (String(url).endsWith("/prepare")) return Response.json({ ready: true }, { status: 201 })
    resultCalls++
    return Response.json(result(JSON.parse(options.body).channel))
  })
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return {
    store,
    calls,
    location,
    document,
    window,
    get navigated() {
      return navigated
    },
    get opened() {
      return opened
    },
    get closed() {
      return closed
    },
    get resultCalls() {
      return resultCalls
    },
  }
}
test("mobile login navigates in the same tab with only a hash challenge, never its claim secret", async (t) => {
  const page = browser(t, { mobile: true })
  assert.equal(await signIn(), null)
  assert.equal(page.opened, 0)
  const pending = JSON.parse(page.store.get(pendingKey))
  assert.deepEqual(Object.keys(pending).sort(), ["channel", "expires", "origin", "secret"])
  const url = new URL(page.navigated)
  assert.equal(url.searchParams.get("channel"), pending.channel)
  assert.equal(url.searchParams.get("mode"), "redirect")
  assert.equal(
    url.searchParams.get("challenge"),
    Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.secret)),
    ).toString("base64url"),
  )
  assert.ok(!url.href.includes(pending.secret))
  assert.ok(!page.store.get(pendingKey).includes("token"))
  assert.equal(page.resultCalls, 0)
  const prepared = page.calls.find((request) => request.url.endsWith("/prepare"))
  assert.deepEqual(JSON.parse(prepared.options.body), {
    channel: pending.channel,
    challenge: url.searchParams.get("challenge"),
  })
  assert.ok(!prepared.options.body.includes(pending.secret))
})
test("desktop initial login uses the same tab without popups or device detection and resumes after return", async (t) => {
  const page = browser(t, { popupAllowed: false })
  page.window.matchMedia = () => {
    throw new Error("Initial login must not depend on pointer type")
  }
  Object.defineProperty(page.window, "innerWidth", {
    get() {
      throw new Error("Initial login must not depend on viewport width")
    },
  })
  assert.equal(await signIn(), null)
  assert.equal(page.opened, 0)
  const pending = JSON.parse(page.store.get(pendingKey))
  const url = new URL(page.navigated)
  assert.equal(url.searchParams.get("mode"), "redirect")
  assert.equal(url.searchParams.get("channel"), pending.channel)
  assert.ok(!url.href.includes(pending.secret))
  assert.ok(!page.store.get(pendingKey).includes("token"))
  assert.equal(page.resultCalls, 0)
  page.location.search = `?login=${pending.channel}`
  assert.equal((await resumeSignIn()).login, "LeiGuo0812")
  assert.equal(page.location.search, "")
  assert.equal(page.store.size, 0)
  assert.equal(page.resultCalls, 1)
})
test("mobile callback resumes after reload, removes the return query and clears its one-use proof", async (t) => {
  const page = browser(t, { mobile: true })
  await signIn()
  const pending = JSON.parse(page.store.get(pendingKey))
  page.location.search = `?keep=1&login=${pending.channel}`
  const credentials = await resumeSignIn()
  assert.equal(credentials.login, "LeiGuo0812")
  assert.equal(page.location.search, "?keep=1")
  assert.equal(page.store.has(pendingKey), false)
  assert.equal(page.resultCalls, 1)
  const request = page.calls.at(-1)
  assert.equal(request.options.method, "POST")
  assert.equal(request.options.credentials, "omit")
  assert.equal(request.options.cache, "no-store")
  assert.deepEqual(JSON.parse(request.options.body), {
    channel: pending.channel,
    secret: pending.secret,
  })
  assert.ok(!request.url.includes(pending.secret))
})
test("main-site login uses the shared config and resumes with the article query and fragment intact", async (t) => {
  const page = browser(t, { mobile: true, popupAllowed: false })
  page.location.href =
    "https://leiguo0812.github.io/howard-notes/notes/article-one?sort=latest&tag=%E6%8A%80%E6%9C%AF#heading-two"
  const returnTo = page.location.href
  const configUrl = "https://leiguo0812.github.io/howard-notes/admin/auth-config.json"
  assert.equal(await signIn({ configUrl, returnTo }), null)
  assert.equal(page.opened, 0)
  const login = new URL(page.navigated)
  const pending = JSON.parse(page.store.get(pendingKey))
  assert.equal(login.searchParams.get("returnTo"), returnTo)
  assert.ok(!login.href.includes(pending.secret))
  assert.deepEqual(Object.keys(pending).sort(), ["channel", "expires", "origin", "secret"])
  const returned = new URL(returnTo)
  returned.searchParams.set("login", pending.channel)
  page.location.href = returned.href
  assert.equal((await resumeSignIn({ configUrl })).login, "LeiGuo0812")
  assert.equal(page.location.href, returnTo)
  assert.equal(page.store.size, 0)
  assert.equal(page.resultCalls, 1)
  assert.equal(page.calls.filter((request) => request.url === configUrl).length, 2)
})
test("main-site reauthentication keeps the current page and proof in memory", async (t) => {
  const page = browser(t)
  page.location.href = "https://leiguo0812.github.io/howard-notes/notes/article-one#section"
  const returnTo = page.location.href
  const credentials = await signIn({
    preservePage: true,
    configUrl: "/howard-notes/admin/auth-config.json",
    returnTo,
  })
  assert.equal(credentials.login, "LeiGuo0812")
  assert.equal(page.location.href, returnTo)
  assert.equal(new URL(page.navigated).searchParams.get("returnTo"), returnTo)
  assert.equal(page.opened, 1)
  assert.equal(page.closed, 1)
  assert.equal(page.store.size, 0)
})
test("unsafe client return addresses never prepare or navigate an authorization", async (t) => {
  const page = browser(t)
  for (const returnTo of [
    "https://attacker.test/howard-notes/",
    "//attacker.test/howard-notes/",
    "javascript:alert(1)",
    "https://user:pass@leiguo0812.github.io/howard-notes/",
    "",
    "https://leiguo0812.github.io/howard-notes/\nnotes/one",
    "https://leiguo0812.github.io/howard-notes/\\notes/one",
    "/howard-notes/" + "x".repeat(2048),
  ])
    await assert.rejects(signIn({ returnTo }), /登录返回地址不正确/)
  assert.equal(page.calls.length, 0)
  assert.equal(page.navigated, "")
  assert.equal(page.store.size, 0)
})
test("shared config URL cannot fetch a cross-origin credential configuration", async (t) => {
  const page = browser(t)
  await assert.rejects(
    signIn({ configUrl: "https://attacker.test/auth-config.json" }),
    /登录设置地址/,
  )
  assert.equal(page.calls.length, 0)
  assert.equal(page.navigated, "")
})
test("desktop and mobile reauthentication claim results without reading the popup closed flag", async (t) => {
  const page = browser(t, { mobile: true })
  const credentials = await signIn({ preservePage: true })
  assert.equal(page.opened, 1)
  assert.equal(new URL(page.navigated).searchParams.get("mode"), "popup")
  assert.equal(credentials.login, "LeiGuo0812")
  assert.equal(page.closed, 1)
  assert.equal(page.store.size, 0)
})
test("blocked mobile storage preserves the page and reports how to retry", async (t) => {
  const page = browser(t, { mobile: true, blockedStorage: true })
  await assert.rejects(signIn(), /允许此网站使用存储/)
  assert.equal(page.navigated, "")
  assert.equal(page.resultCalls, 0)
})
test("blocked desktop popups report the failure before fetching configuration", async (t) => {
  const page = browser(t, { popupAllowed: false })
  await assert.rejects(signIn({ preservePage: true }), /允许此网站打开登录窗口/)
  assert.equal(page.calls.length, 0)
})
test("mismatched or expired callback proofs cannot claim credentials", async (t) => {
  const page = browser(t, { mobile: true })
  for (const change of [
    { expires: 1 },
    { channel: "wrong" },
    { secret: "wrong" },
    { expires: Date.now() + 600000 },
  ]) {
    page.store.set(
      pendingKey,
      JSON.stringify({
        channel: "c".repeat(43),
        secret: "s".repeat(43),
        origin: "https://login.example.test",
        expires: Date.now() + 60000,
        ...change,
      }),
    )
    page.location.search = `?login=${"c".repeat(43)}`
    await assert.rejects(resumeSignIn(), /登录已失效/)
    assert.equal(page.location.search, "")
    assert.equal(page.store.size, 0)
  }
  assert.equal(page.resultCalls, 0)
})
test("a modified stored broker never receives the claim secret", async (t) => {
  const page = browser(t, { mobile: true })
  page.store.set(
    pendingKey,
    JSON.stringify({
      channel: "c".repeat(43),
      secret: "s".repeat(43),
      origin: "https://attacker.example.test",
      expires: Date.now() + 60000,
    }),
  )
  page.location.search = `?login=${"c".repeat(43)}`
  await assert.rejects(resumeSignIn(), /登录已失效/)
  assert.equal(page.resultCalls, 0)
  assert.equal(page.store.size, 0)
})
test("actual GitHub refusal and malformed result payloads never become editor credentials", async (t) => {
  const page = browser(t)
  for (const refused of [true, false]) {
    globalThis.fetch = async (url, options) =>
      String(url).endsWith("auth-config.json")
        ? Response.json({ brokerOrigin: "https://login.example.test" })
        : String(url).endsWith("/prepare")
          ? Response.json({ ready: true }, { status: 201 })
          : Response.json(
              refused
                ? {
                    type: "howard-github-auth",
                    channel: JSON.parse(options.body).channel,
                    error: "你已取消 GitHub 授权。",
                  }
                : result("attacker-channel"),
            )
    await assert.rejects(
      signIn({ preservePage: true }),
      refused ? /取消 GitHub 授权/ : /返回信息不正确/,
    )
  }
  assert.equal(page.closed, 2)
})
test("the prepare handshake finishes before navigation; refusal never begins OAuth", async (t) => {
  const page = browser(t)
  globalThis.fetch = async (url) =>
    String(url).endsWith("auth-config.json")
      ? Response.json({ brokerOrigin: "https://login.example.test" })
      : Response.json({ error: "登录已失效，请重新登录。" }, { status: 403 })
  await assert.rejects(signIn({ preservePage: true }), /登录已失效/)
  assert.equal(page.navigated, "")
  assert.equal(page.closed, 1)
  assert.equal(page.store.size, 0)
})
test("foreground return retries temporary network failures and pending authorization", async (t) => {
  const page = browser(t)
  let attempts = 0
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("auth-config.json"))
      return Response.json({ brokerOrigin: "https://login.example.test" })
    if (String(url).endsWith("/prepare")) return Response.json({ ready: true }, { status: 201 })
    attempts++
    if (attempts === 1) throw new TypeError("Network unavailable while the tab is in background")
    if (attempts === 2) return Response.json({ pending: true }, { status: 202 })
    return Response.json(result(JSON.parse(options.body).channel))
  }
  const login = signIn({ preservePage: true })
  while (attempts < 1) await new Promise(setImmediate)
  await new Promise(setImmediate)
  assert.equal(attempts, 1)
  page.window.dispatchEvent(new Event("focus"))
  await new Promise(setImmediate)
  assert.equal(attempts, 2)
  page.document.dispatchEvent(new Event("visibilitychange"))
  assert.equal((await login).login, "LeiGuo0812")
  assert.equal(attempts, 3)
  assert.equal(page.closed, 1)
})
test("result validation bounds the error, account and credential expiry", () => {
  const channel = "c".repeat(43)
  assert.equal(acceptsResult(result(channel), channel), true)
  for (const change of [
    { type: "other" },
    { login: "" },
    { login: "x".repeat(101) },
    { token: "x".repeat(501) },
    { expiresAt: Date.now() + 28801000 },
    { serverTime: undefined },
    { serverTime: 0 },
    { serverTime: Infinity },
    { expiresAt: 1 },
    { error: "", token: "" },
    { error: "x".repeat(301), token: "" },
  ])
    assert.equal(acceptsResult({ ...result(channel), ...change }, channel), false)
})
test("valid full-lifetime results are independent of phone clock and delivery speed", () => {
  const original = Date.now
  const channel = "c".repeat(43)
  const issuedAt = original()
  const credentials = { ...result(channel), expiresAt: issuedAt + 28800000 }
  try {
    for (const clockOffset of [-3600000, -5000, -1000, 0, 1000, 3600000])
      for (const deliveryDelay of [20, 100, 1500, 6000]) {
        Date.now = () => issuedAt + deliveryDelay + clockOffset
        assert.equal(
          acceptsResult({ ...credentials, serverTime: issuedAt + deliveryDelay }, channel),
          true,
          `clock ${clockOffset}ms, delivery ${deliveryDelay}ms`,
        )
      }
  } finally {
    Date.now = original
  }
})
test("server-relative validation still rejects expiry, excessive lifetime and malformed timing", () => {
  const channel = "c".repeat(43)
  const serverTime = Date.now()
  const credentials = { ...result(channel), serverTime }
  for (const change of [
    { expiresAt: serverTime },
    { expiresAt: serverTime - 1 },
    { expiresAt: serverTime + 28800001 },
    { expiresAt: "not-a-timestamp" },
    { serverTime: "not-a-timestamp" },
    { serverTime: undefined },
    { serverTime: -1 },
  ])
    assert.equal(acceptsResult({ ...credentials, ...change }, channel), false)
})
