import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import { handle, seal, unseal } from "./worker.mjs"

const origin = "https://login.example.test"
const channel = "c".repeat(43)
const app = {
  clientId: "Iv1.test",
  clientSecret: "server-secret-must-not-leak",
  slug: "howard-notes-test",
}
function environment() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(fs.readFileSync(new URL("schema.sql", import.meta.url), "utf8"))
  const env = {
    ENCRYPTION_KEY: "a".repeat(43),
    SETUP_KEY: "s".repeat(43),
    OWNER_ID: "50766698",
    OWNER_LOGIN: "LeiGuo0812",
    REPOSITORY: "LeiGuo0812/howard-notes",
    ADMIN_URL: "https://leiguo0812.github.io/howard-notes/admin/",
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql)
        let values = []
        return {
          bind(...args) {
            values = args
            return this
          },
          async first() {
            return statement.get(...values) || null
          },
          async run() {
            const result = statement.run(...values)
            return { meta: { changes: Number(result.changes) } }
          },
        }
      },
    },
  }
  return { env, sqlite }
}
async function configured() {
  const state = environment()
  await state.env.DB.prepare("INSERT INTO app_config (id, encrypted) VALUES (1, ?)")
    .bind(await seal(app, state.env, "config"))
    .run()
  return state
}
async function start(env) {
  const response = await handle(new Request(`${origin}/login?channel=${channel}`), env)
  assert.equal(response.status, 302)
  const authorize = new URL(response.headers.get("Location"))
  assert.equal(authorize.origin, "https://github.com")
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256")
  assert.equal(authorize.searchParams.get("redirect_uri"), `${origin}/oauth/callback`)
  const cookie = response.headers.get("Set-Cookie")
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax; Path=\//)
  return { authorize, cookie: cookie.split(";")[0] }
}
function callback(pending, additions = "code=code-from-github-123") {
  return new Request(
    `${origin}/oauth/callback?state=${pending.authorize.searchParams.get("state")}&${additions}`,
    { headers: { Cookie: pending.cookie } },
  )
}
function upstream({ user = 50766698, push = true } = {}) {
  const calls = []
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options })
      if (url.endsWith("/access_token"))
        return Response.json({
          access_token: "ghu_mock-short-lived-access",
          token_type: "bearer",
          expires_in: 28800,
          refresh_token: "must-not-reach-browser",
        })
      if (url.endsWith("/user")) return Response.json({ id: user, login: "LeiGuo0812" })
      if (url.endsWith("/repos/LeiGuo0812/howard-notes"))
        return Response.json({ permissions: { push } })
      throw new Error(`Unexpected test URL: ${url}`)
    },
  }
}
test("login uses PKCE, encrypted cookie and one-use state; secrets are never in its URL", async () => {
  const { env } = await configured()
  const pending = await start(env)
  const api = upstream()
  const response = await handle(callback(pending), env, api.fetcher)
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /ghu_mock-short-lived-access/)
  assert.match(body, /https:\/\/leiguo0812.github.io/)
  assert.ok(!body.includes(app.clientSecret))
  assert.ok(!body.includes("must-not-reach-browser"))
  assert.ok(!body.includes("code-from-github-123"))
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/)
  const verifier = api.calls[0].options.body.get("code_verifier")
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url")
  assert.equal(challenge, pending.authorize.searchParams.get("code_challenge"))
  assert.equal(api.calls[0].options.body.get("client_secret"), app.clientSecret)
  const again = await handle(callback(pending), env, api.fetcher)
  assert.equal(again.status, 400)
  assert.equal(api.calls.length, 3)
})
test("wrong state, missing cookie and tampered cookie cannot exchange a code", async () => {
  const { env } = await configured(),
    pending = await start(env),
    api = upstream()
  for (const request of [
    new Request(callback(pending).url),
    new Request(callback(pending).url.replace("state=", "state=wrong"), {
      headers: { Cookie: pending.cookie },
    }),
    new Request(callback(pending).url, { headers: { Cookie: pending.cookie + "tampered" } }),
  ])
    assert.equal((await handle(request, env, api.fetcher)).status, 400)
  assert.equal(api.calls.length, 0)
})
test("expired requests fail before GitHub and encryption binds the purpose", async () => {
  const { env, sqlite } = await configured(),
    pending = await start(env),
    api = upstream()
  sqlite.exec("UPDATE login_flows SET expires = 1")
  assert.equal((await handle(callback(pending), env, api.fetcher)).status, 400)
  assert.equal(api.calls.length, 0)
  const sealed = await seal({ value: "secret" }, env, "config")
  await assert.rejects(unseal(sealed, env, "flow"))
})
test("other accounts and read-only access cannot obtain editor credentials", async () => {
  for (const options of [{ user: 1234 }, { push: false }]) {
    const { env } = await configured(),
      pending = await start(env),
      api = upstream(options)
    const response = await handle(callback(pending), env, api.fetcher)
    const body = await response.text()
    assert.equal(response.status, 400)
    assert.ok(!body.includes("ghu_mock"))
    assert.ok(body.includes(channel))
  }
})
test("cancelled authorization reports a bounded message and consumes the request", async () => {
  const { env } = await configured(),
    pending = await start(env),
    api = upstream()
  const response = await handle(
    callback(pending, "error=access_denied&error_description=untrusted-text"),
    env,
    api.fetcher,
  )
  const body = await response.text()
  assert.match(body, /取消 GitHub 授权/)
  assert.ok(!body.includes("untrusted-text"))
  assert.equal(api.calls.length, 0)
  assert.equal((await handle(callback(pending), env, api.fetcher)).status, 400)
})
test("setup requires a secret and same origin before creating a GitHub manifest", async () => {
  const { env } = environment()
  const entry = await handle(new Request(`${origin}/setup`), env)
  assert.equal(entry.headers.get("Referrer-Policy"), "strict-origin")
  const request = (key, requestOrigin = origin) =>
    new Request(`${origin}/setup/start`, {
      method: "POST",
      headers: { Origin: requestOrigin },
      body: new URLSearchParams({ key }),
    })
  assert.equal((await handle(request("wrong"), env)).status, 403)
  assert.equal((await handle(request(env.SETUP_KEY, "https://attacker.test"), env)).status, 403)
  assert.equal((await handle(request(env.SETUP_KEY, "null"), env)).status, 403)
  const response = await handle(request(env.SETUP_KEY), env)
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin")
  assert.ok(body.includes("contents&quot;:&quot;write"))
  assert.ok(!body.includes(env.SETUP_KEY))
  assert.ok(body.includes("public&quot;:false"))
})
test("manifest setup stores only encrypted credentials, checks ownership and cannot replace an app", async () => {
  for (const owner of [1234, 50766698]) {
    const { env, sqlite } = environment()
    const started = await handle(
      new Request(`${origin}/setup/start`, {
        method: "POST",
        headers: { Origin: origin },
        body: new URLSearchParams({ key: env.SETUP_KEY }),
      }),
      env,
    )
    const html = await started.text(),
      state = html.match(/apps\/new\?state=([A-Za-z0-9_-]+)/)[1]
    const response = await handle(
      new Request(`${origin}/setup/callback?state=${state}&code=manifest-code-123`, {
        headers: { Cookie: started.headers.get("Set-Cookie").split(";")[0] },
      }),
      env,
      async () =>
        Response.json({
          owner: { id: owner },
          permissions: { contents: "write", metadata: "read" },
          client_id: app.clientId,
          client_secret: app.clientSecret,
          slug: app.slug,
          pem: "never-store-private-key",
        }),
    )
    const row = sqlite.prepare("SELECT encrypted FROM app_config").get()
    if (owner === 1234) {
      assert.equal(response.status, 400)
      assert.equal(row, undefined)
    } else {
      assert.equal(response.status, 302)
      assert.ok(!row.encrypted.includes(app.clientSecret))
      assert.deepEqual(await unseal(row.encrypted, env, "config"), app)
      const repeated = await handle(
        new Request(`${origin}/setup/start`, {
          method: "POST",
          headers: { Origin: origin },
          body: new URLSearchParams({ key: env.SETUP_KEY }),
        }),
        env,
      )
      assert.equal(repeated.status, 400)
    }
  }
})
