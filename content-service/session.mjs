const name = "howard_session"
const bytes = new TextEncoder()
const encode = (value) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0))
export async function sessionResponse(request, env, authorize) {
  const url = new URL(request.url)
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  const reply = (body, status = 200) => Response.json(body, { status, headers })
  const origin = request.headers.get("Origin")
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return reply({ error: "请求来源不正确。" }, 403)
  const cookie = (value, age) => {
    headers["Set-Cookie"] =
      `${name}=${value}; Path=${env.SITE_PREFIX || "/howard-notes/"}; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`
  }
  if (request.method === "DELETE") {
    cookie("", 0)
    return reply({ status: "signed-out" })
  }
  if (!env.SESSION_SECRET) return reply({ error: "登录状态保存暂不可用。" }, 503)
  const key = await crypto.subtle.importKey("raw", decode(env.SESSION_SECRET), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
  const aad = bytes.encode(url.origin + (env.SITE_PREFIX || "/howard-notes/"))
  try {
    if (request.method === "POST") {
      // Never allow the automation credential to establish a browser session.
      if (request.headers.has("X-Howard-Sync-Key")) return reply({ error: "请求来源不正确。" }, 403)
      const token = await authorize(request)
      const data = await request.json()
      const remaining = data.expiresAt - data.serverTime
      if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 28800000)
        return reply({ error: "登录有效期不正确。" }, 400)
      const expiresAt = Date.now() + remaining
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        key,
        bytes.encode(JSON.stringify({ token, expiresAt })),
      )
      cookie(encode(iv) + "." + encode(new Uint8Array(sealed)), Math.floor(remaining / 1000))
      return reply({ status: "remembered", expiresAt })
    }
    if (request.method !== "GET") return reply({ error: "请求方法不正确。" }, 405)
    const raw = (request.headers.get("Cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1)
    if (!raw) return reply(null)
    const [iv, ciphertext] = raw.split(".")
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(iv), additionalData: aad },
      key,
      decode(ciphertext),
    )
    const credentials = JSON.parse(new TextDecoder().decode(plaintext))
    if (credentials.expiresAt <= Date.now()) throw new Error("expired")
    const restored = new Request(request.url, {
      headers: { Authorization: `Bearer ${credentials.token}` },
    })
    await authorize(restored)
    return reply({ ...credentials, serverTime: Date.now() })
  } catch (error) {
    if (error.status >= 500) return reply({ error: "暂时无法验证登录，请稍后重试。" }, 503)
    cookie("", 0)
    return reply(
      { error: request.method === "GET" ? "登录状态已过期，请重新登录。" : error.message },
      error.status || 401,
    )
  }
}
