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
test("repository authorization guides preserve notes access, support another image repo and never expose credentials", async () => {
  const { env } = await configured()
  const response = await handle(
    new Request(`${origin}/ready?repository=LeiGuo0812/another-images`),
    env,
  )
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.match(body, /howard-notes/)
  assert.match(body, /LeiGuo0812\/another-images/)
  assert.match(body, /https:\/\/github.com\/apps\/howard-notes-test\/installations\/new/)
  assert.ok(!body.includes(app.clientSecret))
  assert.equal(
    (await handle(new Request(`${origin}/ready?repository=${encodeURIComponent("<script>")}`), env))
      .status,
    400,
  )
})
function callback(pending, additions = "code=code-from-github-123") {
  return new Request(
    `${origin}/oauth/callback?state=${pending.authorize.searchParams.get("state")}&${additions}`,
    { headers: { Cookie: pending.cookie } },
  )
}
function upstream({ user = 50766698, push = true, expires = 28800 } = {}) {
  const calls = []
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options })
      if (url.endsWith("/access_token"))
        return Response.json({
          access_token: "ghu_mock-short-lived-access",
          token_type: "bearer",
          expires_in: expires,
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
test("GitHub configuration errors are distinguished from an explicit authorization refusal", async () => {
  for (const [code, message] of [
    ["redirect_uri_mismatch", /回调地址不匹配/],
    ["application_suspended", /登录应用已暂停/],
    ["unknown_error", /未完成本次授权/],
    ["", /未完成本次授权/],
  ]) {
    const { env } = await configured()
    const pending = await startResult(env)
    const api = upstream()
    const response = await handle(
      callback(
        pending,
        new URLSearchParams({ error: code, error_description: "untrusted-detail" }),
      ),
      env,
      api.fetcher,
    )
    assert.equal(response.status, 400)
    const payload = await (await handle(resultRequest(env), env)).json()
    assert.match(payload.error, message)
    assert.ok(!payload.error.includes("取消"))
    assert.ok(!payload.error.includes("untrusted-detail"))
    assert.equal(payload.token, undefined)
    assert.equal(api.calls.length, 0)
    assert.equal((await handle(resultRequest(env), env)).status, 403)
  }
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
  assert.ok(body.includes("/github/events&quot;,&quot;active&quot;:false"))
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

const resultSecret = Buffer.alloc(32, 7).toString("base64url")
const resultChannel = Buffer.alloc(32, 9).toString("base64url")
const wrongSecret = Buffer.alloc(32, 11).toString("base64url")
async function secretChallenge(secret = resultSecret) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  ).toString("base64url")
}
async function startResult(env, mode = "popup", requestChannel = resultChannel) {
  const challenge = await secretChallenge()
  const url = new URL(`${origin}/login`)
  url.search = new URLSearchParams({ channel: requestChannel, challenge, mode }).toString()
  assert.ok(!url.href.includes(resultSecret))
  const response = await handle(new Request(url), env)
  assert.equal(response.status, 302)
  const authorize = new URL(response.headers.get("Location"))
  assert.equal(authorize.origin, "https://github.com")
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256")
  assert.ok(!authorize.href.includes(resultSecret))
  return {
    authorize,
    cookie: response.headers.get("Set-Cookie").split(";")[0],
    channel: requestChannel,
    challenge,
  }
}
function resultRequest(env, options = {}) {
  const {
    requestOrigin = new URL(env.ADMIN_URL).origin,
    secret = resultSecret,
    requestChannel = resultChannel,
    contentType = "application/json",
    body = JSON.stringify({ channel: requestChannel, secret }),
    endpoint = "/result",
  } = options
  const headers = { "Content-Type": contentType }
  if (requestOrigin !== null) headers.Origin = requestOrigin
  return new Request(`${origin}${endpoint}`, { method: "POST", headers, body })
}
function assertPrivateResponse(response, allowedOrigin = null) {
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), allowedOrigin)
  assert.notEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
}
function assertNoCredentials(text) {
  for (const value of [
    "ghu_mock-short-lived-access",
    "must-not-reach-browser",
    app.clientSecret,
    "code-from-github-123",
    resultSecret,
  ])
    assert.ok(!text.includes(value), `Response unexpectedly included ${value}`)
}

test("result-based login starts pending with only a hashed secret and never consumes a pending result", async () => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  const row = sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel)
  assert.equal(row.challenge, pending.challenge)
  assert.equal(row.encrypted, null)
  assert.ok(row.expires > Date.now())
  assert.ok(!JSON.stringify(row).includes(resultSecret))
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handle(resultRequest(env), env)
    assert.equal(response.status, 202)
    assertPrivateResponse(response, new URL(env.ADMIN_URL).origin)
    assertNoCredentials(await response.text())
    assert.equal(
      sqlite
        .prepare("SELECT count(*) AS count FROM login_results WHERE channel = ?")
        .get(resultChannel).count,
      1,
    )
  }
})

test("popup callback stores an encrypted five-minute result and its HTML contains no token", async () => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  const api = upstream()
  const before = Date.now()
  const response = await handle(callback(pending), env, api.fetcher)
  const after = Date.now()
  assert.equal(response.status, 200)
  const body = await response.text()
  assertNoCredentials(body)
  assert.ok(!body.includes("postMessage"))
  assertPrivateResponse(response)
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/)
  const row = sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel)
  assert.ok(row.expires >= before + 300000)
  assert.ok(row.expires <= after + 300000)
  assert.ok(!row.encrypted.includes("ghu_mock"))
  const payload = await unseal(row.encrypted, env, "login-result")
  assert.equal(payload.token, "ghu_mock-short-lived-access")
  assert.equal(payload.login, "LeiGuo0812")
  assert.ok(payload.expiresAt > Date.now())
  assert.ok(!JSON.stringify(payload).includes("must-not-reach-browser"))
  await assert.rejects(unseal(row.encrypted, env, "config"))
  await assert.rejects(unseal(row.encrypted, env, "flow"))
})

test("same-page callback returns only to the fixed admin URL with a non-secret login channel", async () => {
  const { env } = await configured()
  const pending = await startResult(env, "redirect")
  const api = upstream()
  const response = await handle(callback(pending), env, api.fetcher)
  assert.equal(response.status, 302)
  const returned = new URL(response.headers.get("Location"))
  const fixed = new URL(env.ADMIN_URL)
  assert.equal(returned.origin, fixed.origin)
  assert.equal(returned.pathname, fixed.pathname)
  assert.deepEqual([...returned.searchParams], [["login", resultChannel]])
  assert.equal(returned.hash, "")
  assertNoCredentials(returned.href)
  assertNoCredentials(await response.text())
  assertPrivateResponse(response)
})

test("the initiating secret retrieves exactly one result and replay is rejected", async () => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  const api = upstream()
  await handle(callback(pending), env, api.fetcher)
  const response = await handle(resultRequest(env), env)
  assert.equal(response.status, 200)
  assertPrivateResponse(response, new URL(env.ADMIN_URL).origin)
  const payload = await response.json()
  assert.equal(payload.type, "howard-github-auth")
  assert.equal(payload.channel, resultChannel)
  assert.equal(payload.token, "ghu_mock-short-lived-access")
  assert.equal(payload.login, "LeiGuo0812")
  assert.ok(payload.expiresAt > Date.now())
  assert.ok(!JSON.stringify(payload).includes("must-not-reach-browser"))
  assert.equal(
    sqlite
      .prepare("SELECT count(*) AS count FROM login_results WHERE channel = ?")
      .get(resultChannel).count,
    0,
  )
  const replay = await handle(resultRequest(env), env)
  assert.equal(replay.status, 403)
  assertNoCredentials(await replay.text())
  assert.equal((await handle(callback(pending), env, api.fetcher)).status, 400)
  assert.equal(api.calls.length, 3)
})

test("concurrent result retrieval has only one winner in real SQLite", async () => {
  const { env } = await configured()
  const pending = await startResult(env)
  await handle(callback(pending), env, upstream().fetcher)
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => handle(resultRequest(env), env)),
  )
  assert.equal(responses.filter((response) => response.status === 200).length, 1)
  assert.equal(responses.filter((response) => response.status === 403).length, 7)
  for (const response of responses) {
    const body = await response.text()
    if (response.status === 200) assert.match(body, /ghu_mock-short-lived-access/)
    else assertNoCredentials(body)
  }
})

test("wrong origins and secrets cannot read or consume a completed result", async () => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  await handle(callback(pending), env, upstream().fetcher)
  const legitimateOrigin = new URL(env.ADMIN_URL).origin
  for (const requestOrigin of [
    null,
    "null",
    "https://attacker.test",
    legitimateOrigin + ".attacker.test",
    legitimateOrigin + "/",
    origin,
  ]) {
    const response = await handle(resultRequest(env, { requestOrigin }), env)
    assert.equal(response.status, 403)
    assertPrivateResponse(response)
    assertNoCredentials(await response.text())
  }
  const wrong = await handle(resultRequest(env, { secret: wrongSecret }), env)
  assert.equal(wrong.status, 403)
  assertNoCredentials(await wrong.text())
  assert.equal(
    sqlite
      .prepare("SELECT count(*) AS count FROM login_results WHERE channel = ?")
      .get(resultChannel).count,
    1,
  )
  assert.equal((await handle(resultRequest(env), env)).status, 200)
})

test("invalid result bodies or content types cannot consume a valid result", async () => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  await handle(callback(pending), env, upstream().fetcher)
  for (const options of [
    { contentType: "text/plain" },
    { contentType: "application/x-www-form-urlencoded" },
    { body: "{" },
    { body: "null" },
    { body: "[]" },
    { body: JSON.stringify({ channel: resultChannel }) },
    { secret: "bad-secret" },
    { requestChannel: "bad-channel" },
    {
      body: JSON.stringify({
        channel: resultChannel,
        secret: resultSecret,
        padding: "x".repeat(1024),
      }),
    },
  ]) {
    const response = await handle(resultRequest(env, options), env)
    assert.equal(response.status, 400)
    assertNoCredentials(await response.text())
  }
  assert.equal(
    sqlite
      .prepare("SELECT count(*) AS count FROM login_results WHERE channel = ?")
      .get(resultChannel).count,
    1,
  )
  assert.equal((await handle(resultRequest(env), env)).status, 200)
})

test("pending and completed result expiry fail without returning credentials", async () => {
  for (const complete of [false, true]) {
    const { env, sqlite } = await configured()
    const pending = await startResult(env)
    if (complete) await handle(callback(pending), env, upstream().fetcher)
    sqlite.prepare("UPDATE login_results SET expires = ? WHERE channel = ?").run(1, resultChannel)
    const response = await handle(resultRequest(env), env)
    assert.equal(response.status, 403)
    assertNoCredentials(await response.text())
  }
})

test("result preflight admits only the admin origin, POST method and content-type header", async () => {
  const { env } = await configured()
  const legitimateOrigin = new URL(env.ADMIN_URL).origin
  const preflight = (requestOrigin, method = "POST", requestHeaders = "content-type") =>
    new Request(`${origin}/result`, {
      method: "OPTIONS",
      headers: {
        Origin: requestOrigin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": requestHeaders,
      },
    })
  const response = await handle(preflight(legitimateOrigin), env)
  assert.equal(response.status, 204)
  assertPrivateResponse(response, legitimateOrigin)
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST")
  assert.equal(response.headers.get("Access-Control-Allow-Headers")?.toLowerCase(), "content-type")
  assert.match(response.headers.get("Vary"), /Origin/i)
  for (const request of [
    preflight("https://attacker.test"),
    preflight("null"),
    preflight(legitimateOrigin, "GET"),
    preflight(legitimateOrigin, "PUT"),
    preflight(legitimateOrigin, "POST", "content-type,authorization"),
    preflight(legitimateOrigin, "POST", "x-custom-header"),
  ]) {
    const denied = await handle(request, env)
    assert.equal(denied.status, 403)
    assert.notEqual(denied.headers.get("Access-Control-Allow-Origin"), "*")
    assert.notEqual(denied.headers.get("Access-Control-Allow-Headers"), "*")
    assertNoCredentials(await denied.text())
  }
})

test("result-based errors remain retrievable once without exposing access or refresh tokens", async () => {
  for (const scenario of [
    { options: { user: 1234 }, message: /所有者/ },
    { options: { push: false }, message: /写入权限/ },
    { options: { expires: 0 }, message: /短期/ },
    { options: { expires: 28801 }, message: /短期/ },
    { cancelled: true, message: /取消 GitHub 授权/ },
  ]) {
    const { env, sqlite } = await configured()
    const pending = await startResult(env, "redirect")
    const api = upstream(scenario.options)
    const completed = await handle(
      callback(
        pending,
        scenario.cancelled
          ? "error=access_denied&error_description=untrusted-text"
          : "code=code-from-github-123",
      ),
      env,
      api.fetcher,
    )
    assert.equal(completed.status, 302)
    assertNoCredentials(completed.headers.get("Location"))
    assertNoCredentials(await completed.text())
    const row = sqlite
      .prepare("SELECT encrypted FROM login_results WHERE channel = ?")
      .get(resultChannel)
    const stored = await unseal(row.encrypted, env, "login-result")
    assert.match(stored.error, scenario.message)
    assert.equal(stored.token, undefined)
    const response = await handle(resultRequest(env), env)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.type, "howard-github-auth")
    assert.equal(payload.channel, resultChannel)
    assert.match(payload.error, scenario.message)
    assertNoCredentials(JSON.stringify(payload))
    assert.ok(!JSON.stringify(payload).includes("untrusted-text"))
    assert.equal((await handle(resultRequest(env), env)).status, 403)
    if (scenario.cancelled) assert.equal(api.calls.length, 0)
  }
})

test("invalid challenges and transport modes are rejected before creating a pending result", async () => {
  const { env, sqlite } = await configured()
  const validChallenge = await secretChallenge()
  for (const parameters of [
    { challenge: "short", mode: "popup" },
    { challenge: "a".repeat(44), mode: "popup" },
    { challenge: "+".repeat(43), mode: "popup" },
    { challenge: validChallenge, mode: "unsupported" },
    { challenge: validChallenge, mode: "" },
    { challenge: validChallenge, mode: "https://attacker.test/" },
  ]) {
    const url = new URL(`${origin}/login`)
    url.search = new URLSearchParams({ channel: resultChannel, ...parameters }).toString()
    const response = await handle(new Request(url), env)
    assert.equal(response.status, 400)
    assert.equal(response.headers.get("Location"), null)
    assertNoCredentials(await response.text())
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM login_results").get().count, 0)
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM login_flows").get().count, 0)
})

test("a repeated channel cannot replace a pending or completed proof-bound result", async () => {
  for (const complete of [false, true]) {
    const { env, sqlite } = await configured()
    const pending = await startResult(env)
    if (complete) await handle(callback(pending), env, upstream().fetcher)
    const previous = sqlite
      .prepare("SELECT * FROM login_results WHERE channel = ?")
      .get(resultChannel)
    const url = new URL(`${origin}/login`)
    url.search = new URLSearchParams({
      channel: resultChannel,
      challenge: await secretChallenge(wrongSecret),
      mode: "redirect",
    }).toString()
    const repeated = await handle(new Request(url), env)
    assert.equal(repeated.status, 400)
    assert.equal(repeated.headers.get("Location"), null)
    assertNoCredentials(await repeated.text())
    assert.deepEqual(
      sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel),
      previous,
    )
    assert.equal((await handle(resultRequest(env, { secret: wrongSecret }), env)).status, 403)
    assert.equal((await handle(resultRequest(env), env)).status, complete ? 200 : 202)
  }
})

test("popup authorization errors expose only a bounded message while their result remains consumable", async () => {
  const { env } = await configured()
  const pending = await startResult(env)
  const api = upstream()
  const response = await handle(
    callback(pending, "error=access_denied&error_description=untrusted-text"),
    env,
    api.fetcher,
  )
  assert.equal(response.status, 400)
  const body = await response.text()
  assert.match(body, /取消 GitHub 授权/)
  assertNoCredentials(body)
  assert.ok(!body.includes("untrusted-text"))
  assert.ok(!body.includes("postMessage"))
  const result = await handle(resultRequest(env), env)
  assert.equal(result.status, 200)
  const payload = await result.json()
  assert.match(payload.error, /取消 GitHub 授权/)
  assert.equal(payload.token, undefined)
  assert.equal(api.calls.length, 0)
})

async function prepareRequest(env, options = {}) {
  return resultRequest(env, {
    endpoint: "/prepare",
    body: JSON.stringify({ channel: resultChannel, challenge: await secretChallenge() }),
    ...options,
  })
}

test("preparing the proof before opening GitHub permits polling without a navigation race", async () => {
  const { env, sqlite } = await configured()
  const response = await handle(await prepareRequest(env), env)
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { ready: true })
  assertPrivateResponse(response, new URL(env.ADMIN_URL).origin)
  const row = sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel)
  assert.equal(row.challenge, await secretChallenge())
  assert.equal(row.encrypted, null)
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM login_flows").get().count, 0)
  const polled = await handle(resultRequest(env), env)
  assert.equal(polled.status, 202)
  assertNoCredentials(await polled.text())
  assert.deepEqual(
    sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel),
    row,
  )
})

test("a prepared login can finish through popup or same-page return and retrieve the result", async () => {
  for (const mode of ["popup", "redirect"]) {
    const { env } = await configured()
    assert.equal((await handle(await prepareRequest(env), env)).status, 201)
    const pending = await startResult(env, mode)
    const response = await handle(callback(pending), env, upstream().fetcher)
    assert.equal(response.status, mode === "popup" ? 200 : 302)
    assertNoCredentials(await response.text())
    const result = await handle(resultRequest(env), env)
    assert.equal(result.status, 200)
    assert.equal((await result.json()).token, "ghu_mock-short-lived-access")
  }
})

test("duplicate prepares cannot replace pending or completed login results", async () => {
  for (const complete of [false, true]) {
    const { env, sqlite } = await configured()
    assert.equal((await handle(await prepareRequest(env), env)).status, 201)
    if (complete) {
      const pending = await startResult(env)
      await handle(callback(pending), env, upstream().fetcher)
    }
    const previous = sqlite
      .prepare("SELECT * FROM login_results WHERE channel = ?")
      .get(resultChannel)
    for (const challenge of [await secretChallenge(), await secretChallenge(wrongSecret)]) {
      const response = await handle(
        await prepareRequest(env, { body: JSON.stringify({ channel: resultChannel, challenge }) }),
        env,
      )
      assert.equal(response.status, 409)
      assertNoCredentials(await response.text())
      assert.deepEqual(
        sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel),
        previous,
      )
    }
    assert.equal((await handle(resultRequest(env), env)).status, complete ? 200 : 202)
  }
})

test("preparation rejects wrong origins and malformed inputs before allocating any login state", async () => {
  const { env, sqlite } = await configured()
  for (const requestOrigin of [null, "null", "https://attacker.test", origin]) {
    const response = await handle(await prepareRequest(env, { requestOrigin }), env)
    assert.equal(response.status, 403)
    assertPrivateResponse(response)
    assertNoCredentials(await response.text())
  }
  for (const options of [
    { contentType: "text/plain" },
    { body: "{" },
    { body: "null" },
    { body: "[]" },
    { body: JSON.stringify({ channel: resultChannel }) },
    { body: JSON.stringify({ channel: "short", challenge: await secretChallenge() }) },
    { body: JSON.stringify({ channel: resultChannel, challenge: "short" }) },
    {
      body: JSON.stringify({
        channel: resultChannel,
        challenge: await secretChallenge(),
        padding: "x".repeat(1024),
      }),
    },
  ]) {
    const response = await handle(await prepareRequest(env, options), env)
    assert.equal(response.status, 400)
    assertNoCredentials(await response.text())
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM login_results").get().count, 0)
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM login_flows").get().count, 0)
})

test("prepare preflight is restricted to the admin origin and JSON POSTs", async () => {
  const { env } = await configured()
  const allowedOrigin = new URL(env.ADMIN_URL).origin
  const makeRequest = (requestOrigin, method = "POST", requestedHeaders = "content-type") =>
    new Request(`${origin}/prepare`, {
      method: "OPTIONS",
      headers: {
        Origin: requestOrigin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": requestedHeaders,
      },
    })
  const allowed = await handle(makeRequest(allowedOrigin), env)
  assert.equal(allowed.status, 204)
  assertPrivateResponse(allowed, allowedOrigin)
  assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "POST")
  for (const request of [
    makeRequest("https://attacker.test"),
    makeRequest(allowedOrigin, "GET"),
    makeRequest(allowedOrigin, "POST", "content-type,authorization"),
  ]) {
    const response = await handle(request, env)
    assert.equal(response.status, 403)
    assertNoCredentials(await response.text())
  }
})

test("matching pending GET login retries preserve the proof while completed results reject a new flow", async () => {
  const { env, sqlite } = await configured()
  await handle(await prepareRequest(env), env)
  const previous = sqlite
    .prepare("SELECT * FROM login_results WHERE channel = ?")
    .get(resultChannel)
  const pending = await startResult(env)
  await startResult(env)
  assert.deepEqual(
    sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel),
    previous,
  )
  await handle(callback(pending), env, upstream().fetcher)
  const completed = sqlite
    .prepare("SELECT * FROM login_results WHERE channel = ?")
    .get(resultChannel)
  const url = new URL(`${origin}/login`)
  url.search = new URLSearchParams({
    channel: resultChannel,
    challenge: await secretChallenge(),
    mode: "popup",
  }).toString()
  const again = await handle(new Request(url), env)
  assert.equal(again.status, 400)
  assertNoCredentials(await again.text())
  assert.deepEqual(
    sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel),
    completed,
  )
  assert.equal((await handle(resultRequest(env), env)).status, 200)
})

test("a later callback from a pending retry cannot replace the first completed result", async () => {
  const { env, sqlite } = await configured()
  const first = await startResult(env)
  const retry = await startResult(env)
  assert.equal((await handle(callback(first), env, upstream().fetcher)).status, 200)
  const completed = sqlite
    .prepare("SELECT * FROM login_results WHERE channel = ?")
    .get(resultChannel)
  const late = await handle(callback(retry), env, upstream().fetcher)
  assert.equal(late.status, 400)
  assertNoCredentials(await late.text())
  assert.deepEqual(
    sqlite.prepare("SELECT * FROM login_results WHERE channel = ?").get(resultChannel),
    completed,
  )
  const result = await handle(resultRequest(env), env)
  assert.equal(result.status, 200)
  assert.equal((await result.json()).token, "ghu_mock-short-lived-access")
})

test("result delivery adds a fresh server clock and overrides a stored timestamp", async (t) => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  await handle(callback(pending), env, upstream().fetcher)
  const row = sqlite
    .prepare("SELECT encrypted FROM login_results WHERE channel = ?")
    .get(resultChannel)
  const stored = await unseal(row.encrypted, env, "login-result")
  sqlite
    .prepare("UPDATE login_results SET encrypted = ? WHERE channel = ?")
    .run(await seal({ ...stored, serverTime: 1 }, env, "login-result"), resultChannel)
  const deliveredAt = Date.now() + 2000
  t.mock.method(Date, "now", () => deliveredAt)
  const response = await handle(resultRequest(env), env)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.serverTime, deliveredAt)
  assert.equal(payload.expiresAt, stored.expiresAt)
  assert.ok(payload.expiresAt > payload.serverTime)
  assert.ok(payload.expiresAt - payload.serverTime <= 28800000)
  assert.equal(payload.channel, resultChannel)
})

test("an access token that expires before result delivery is consumed without exposing credentials", async (t) => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  await handle(callback(pending), env, upstream({ expires: 1 }).fetcher)
  const row = sqlite
    .prepare("SELECT encrypted, expires FROM login_results WHERE channel = ?")
    .get(resultChannel)
  const stored = await unseal(row.encrypted, env, "login-result")
  const deliveredAt = stored.expiresAt + 1
  assert.ok(row.expires > deliveredAt)
  t.mock.method(Date, "now", () => deliveredAt)
  const response = await handle(resultRequest(env), env)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.type, "howard-github-auth")
  assert.equal(payload.channel, resultChannel)
  assert.equal(payload.serverTime, deliveredAt)
  assert.match(payload.error, /登录凭据已过期/)
  assert.equal(payload.token, undefined)
  assertNoCredentials(JSON.stringify(payload))
  assert.equal((await handle(resultRequest(env), env)).status, 403)
})

test("owner and repository validation time is not added to the GitHub token lifetime", async (t) => {
  const { env, sqlite } = await configured()
  const pending = await startResult(env)
  const api = upstream()
  const exchangeAt = Date.now()
  let serverClock = exchangeAt
  t.mock.method(Date, "now", () => serverClock)
  const fetcher = async (...args) => {
    const response = await api.fetcher(...args)
    serverClock += 2000
    return response
  }
  const response = await handle(callback(pending), env, fetcher)
  assert.equal(response.status, 200)
  const row = sqlite
    .prepare("SELECT encrypted FROM login_results WHERE channel = ?")
    .get(resultChannel)
  const stored = await unseal(row.encrypted, env, "login-result")
  assert.equal(serverClock, exchangeAt + 6000)
  assert.equal(stored.expiresAt, exchangeAt + 28800000)
  const delivered = await (await handle(resultRequest(env), env)).json()
  assert.equal(delivered.serverTime, serverClock)
  assert.equal(delivered.expiresAt - delivered.serverTime, 28794000)
})
