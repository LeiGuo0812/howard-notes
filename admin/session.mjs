const HINT = "howard-notes:session-present:v1"
export function hasSessionHint() {
  try {
    return Number(localStorage.getItem(HINT)) > Date.now()
  } catch {
    return false
  }
}
async function endpoint(siteBase) {
  try {
    const response = await fetch(new URL("runtime-config.json", siteBase), { cache: "no-store" })
    if (!response.ok) return null
    const config = await response.json()
    const api = new URL(config.apiBase, siteBase)
    return config.enabled &&
      api.origin === location.origin &&
      api.pathname.replace(/\/$/, "").endsWith("/api/content")
      ? api.href.replace(/\/$/, "") + "/session"
      : null
  } catch {
    return null
  }
}
async function request(siteBase, options) {
  const url = await endpoint(siteBase)
  if (!url) return null
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options })
  if (!response.ok) return null
  return response.json()
}
export async function restoreSession(siteBase) {
  try {
    const result = await request(siteBase, { method: "GET" })
    if (!result?.token) {
      try {
        localStorage.removeItem(HINT)
      } catch {}
    }
    return result
  } catch {
    return null
  }
}
export async function rememberSession(siteBase, credentials) {
  try {
    const result = await request(siteBase, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.token}` },
      body: JSON.stringify({
        expiresAt: credentials.expiresAt,
        serverTime: credentials.serverTime,
      }),
    })
    if (result?.status === "remembered") {
      try {
        localStorage.setItem(HINT, String(result.expiresAt))
      } catch {}
    }
  } catch {}
}
export async function clearSession(siteBase) {
  try {
    localStorage.removeItem(HINT)
  } catch {}
  try {
    await request(siteBase, { method: "DELETE" })
  } catch {}
}
