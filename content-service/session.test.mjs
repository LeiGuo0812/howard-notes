import test from "node:test"
import assert from "node:assert/strict"
import { sessionResponse } from "./session.mjs"
const env = {
  SESSION_SECRET: Buffer.alloc(32, 7).toString("base64url"),
  SITE_PREFIX: "/howard-notes/",
}
const url = "https://notes.example/howard-notes/api/content/session"
const authorize = async (request) => {
  assert.equal(request.headers.get("Authorization"), "Bearer private-token")
  return "private-token"
}
async function start() {
  return sessionResponse(
    new Request(url, {
      method: "POST",
      headers: {
        Origin: "https://notes.example",
        Authorization: "Bearer private-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serverTime: 100, expiresAt: 3600100 }),
    }),
    env,
    authorize,
  )
}
test("encrypted HttpOnly session restores token only to same origin and clears on logout", async () => {
  const response = await start()
  assert.equal(response.status, 200)
  const cookie = response.headers.get("Set-Cookie")
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/)
  assert.ok(!cookie.includes("private-token"))
  const restored = await sessionResponse(
    new Request(url, { headers: { Cookie: cookie.split(";")[0] } }),
    env,
    authorize,
  )
  assert.equal(restored.status, 200)
  assert.equal((await restored.json()).token, "private-token")
  assert.equal(restored.headers.get("Access-Control-Allow-Origin"), null)
  const logout = await sessionResponse(new Request(url, { method: "DELETE" }), env, authorize)
  assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/)
})
test("cross-origin and cross-site requests cannot restore or clear sessions", async () => {
  for (const headers of [{ Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    for (const method of ["GET", "DELETE"])
      assert.equal(
        (await sessionResponse(new Request(url, { method, headers }), env, authorize)).status,
        403,
      )
  }
})
test("tampered, revoked, and expired sessions never return credentials", async () => {
  const cookie = (await start()).headers.get("Set-Cookie").split(";")[0]
  const bad = await sessionResponse(
    new Request(url, { headers: { Cookie: cookie + "x" } }),
    env,
    authorize,
  )
  assert.equal(bad.status, 401)
  assert.match(bad.headers.get("Set-Cookie"), /Max-Age=0/)
  const revoked = await sessionResponse(
    new Request(url, { headers: { Cookie: cookie } }),
    env,
    async () => {
      throw new Error("revoked")
    },
  )
  assert.equal(revoked.status, 401)
  const elsewhere = await sessionResponse(
    new Request(url.replace("notes.example", "other.example"), { headers: { Cookie: cookie } }),
    env,
    authorize,
  )
  assert.equal(elsewhere.status, 401)
})

test("expiry clears the cookie while a transient verification failure preserves it", async () => {
  const cookie = (await start()).headers.get("Set-Cookie").split(";")[0]
  const transient = await sessionResponse(
    new Request(url, { headers: { Cookie: cookie } }),
    env,
    async () => {
      const error = new Error("temporary")
      error.status = 502
      throw error
    },
  )
  assert.equal(transient.status, 503)
  assert.equal(transient.headers.get("Set-Cookie"), null)
  const now = Date.now
  try {
    Date.now = () => now() + 3600001
    const expired = await sessionResponse(
      new Request(url, { headers: { Cookie: cookie } }),
      env,
      authorize,
    )
    assert.equal(expired.status, 401)
    assert.match(expired.headers.get("Set-Cookie"), /Max-Age=0/)
  } finally {
    Date.now = now
  }
})
