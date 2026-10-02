import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import { handle } from "./worker.mjs"

const origin = "https://owner-cache.example.test"
const base = "/howard-notes/"
const repository = "fixture-owner/notes"

function deferred() {
  let resolve
  const promise = new Promise((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(fs.readFileSync(new URL("personal-notes-schema.sql", import.meta.url), "utf8"))
  t.after(() => sqlite.close())
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let args = []
      return {
        bind(...values) {
          args = values
          return this
        },
        async first() {
          return statement.get(...args) || null
        },
        async all() {
          return { results: statement.all(...args) }
        },
        async run() {
          return { meta: { changes: statement.run(...args).changes } }
        },
      }
    },
    withSession() {
      return this
    },
  }
  const env = {
    DB,
    SITE_PREFIX: base,
    OWNER_ID: "101",
    REPOSITORY: repository,
    FALLBACK_ORIGIN: "https://fallback.example.test",
    OWNER_AUTH_CACHE_SECONDS: "60",
    SYNC_SECRET: "fixture-automation-secret",
    SESSION_SECRET: Buffer.alloc(32, 9).toString("base64url"),
  }
  const requests = []
  const users = new Map()
  const permissions = new Map([[repository, true]])
  const statuses = new Map()
  let gate = null
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname
    const token = options.headers.Authorization.slice("Bearer ".length)
    requests.push({ path, token })
    if (gate) await gate.promise
    if (statuses.has(path)) return Response.json({}, { status: statuses.get(path) })
    if (path === "/user") return Response.json({ id: users.get(token) ?? 101 })
    if (path.startsWith("/repos/"))
      return Response.json({ permissions: { push: permissions.get(path.slice(7)) || false } })
    throw new Error(`Unexpected fixture endpoint ${path}`)
  }
  const call = (headers = {}, route = "personal/articles", body) =>
    handle(
      new Request(origin + base + "api/content/" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer fixture-owner-token",
          Origin: origin,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      {},
      fetcher,
    )
  return {
    env,
    users,
    permissions,
    statuses,
    requests,
    fetcher,
    call,
    set gate(value) {
      gate = value
    },
  }
}

test("Worker coalesces concurrent owner requests and reuses successful verification without exposing credentials", async (t) => {
  const f = fixture(t),
    gate = deferred()
  f.gate = gate
  const pending = Array.from({ length: 12 }, () => f.call())
  // WebCrypto token digests finish asynchronously before the GitHub calls start.
  for (let tries = 0; tries < 100 && f.requests.length < 2; tries++)
    await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.requests.length, 2)
  gate.resolve()
  const responses = await Promise.all(pending)
  for (const response of responses) {
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.owner, true)
    assert.deepEqual(body.articles, [])
    assert.ok(!JSON.stringify(body).includes("fixture-owner-token"))
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  }
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 2)
})

test("Worker does not cache denied owners, denied repository permissions, or upstream failures", async (t) => {
  for (const failure of ["owner", "permission", "401", "503"]) {
    await t.test(failure, async (t) => {
      const f = fixture(t)
      if (failure === "owner") f.users.set("fixture-owner-token", 999)
      else if (failure === "permission") f.permissions.set(repository, false)
      else f.statuses.set("/user", Number(failure))
      const status = failure === "401" ? 401 : failure === "503" ? 502 : 403
      assert.equal((await f.call()).status, status)
      assert.equal((await f.call()).status, status)
      assert.equal(f.requests.length, 4)
      f.users.clear()
      f.permissions.set(repository, true)
      f.statuses.clear()
      assert.equal((await f.call()).status, 200)
      assert.equal((await f.call()).status, 200)
      assert.equal(f.requests.length, 6)
    })
  }
})

test("Worker rechecks revoked permissions at the 60-second boundary and never caches the resulting denial", async (t) => {
  let now = 1_000_000
  t.mock.method(Date, "now", () => now)
  const f = fixture(t)
  f.env.OWNER_AUTH_CACHE_SECONDS = "600"
  assert.equal((await f.call()).status, 200)
  f.permissions.set(repository, false)
  now += 59_999
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 2)
  now += 1
  assert.equal((await f.call()).status, 403)
  assert.equal((await f.call()).status, 403)
  assert.equal(f.requests.length, 6)
  f.permissions.set(repository, true)
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 8)
})

test("Worker disabled cache settings perform fresh GitHub permission checks", async (t) => {
  for (const setting of [undefined, "0", "-1", "invalid"]) {
    const f = fixture(t)
    f.env.OWNER_AUTH_CACHE_SECONDS = setting
    assert.equal((await f.call()).status, 200)
    assert.equal((await f.call()).status, 200)
    assert.equal(f.requests.length, 4)
  }
})

test("Worker cache is bounded to 128 token entries", async (t) => {
  const f = fixture(t)
  for (let index = 0; index < 128; index++)
    assert.equal((await f.call({ Authorization: `Bearer fixture-token-${index}` })).status, 200)
  assert.equal(f.requests.length, 256)
  assert.equal((await f.call({ Authorization: "Bearer fixture-token-0" })).status, 200)
  assert.equal(f.requests.length, 256)
  assert.equal((await f.call({ Authorization: "Bearer fixture-token-128" })).status, 200)
  assert.equal((await f.call({ Authorization: "Bearer fixture-token-127" })).status, 200)
  assert.equal(f.requests.length, 258)
  assert.equal((await f.call({ Authorization: "Bearer fixture-token-0" })).status, 200)
  assert.equal(f.requests.length, 260)
})

test("Worker checks origins on every cache hit, including changed fallback policy", async (t) => {
  const f = fixture(t)
  // An unknown sync route exercises Worker.authorize itself without a domain's
  // additional origin guard or any database mutations.
  const route = "sync/fixture-unknown"
  assert.equal((await f.call({}, route, {})).status, 404)
  assert.equal(f.requests.length, 2)
  const forbidden = await f.call({ Origin: "https://untrusted.example.test" }, route, {})
  assert.equal(forbidden.status, 403)
  assert.match((await forbidden.json()).error, /来源/)
  assert.equal((await f.call({ Origin: f.env.FALLBACK_ORIGIN }, route, {})).status, 404)
  assert.equal(f.requests.length, 2)
  const previousOrigin = f.env.FALLBACK_ORIGIN
  f.env.FALLBACK_ORIGIN = "https://changed-fallback.example.test"
  assert.equal((await f.call({ Origin: previousOrigin }, route, {})).status, 403)
  assert.equal((await f.call({ Origin: "https://untrusted.example.test" })).status, 403)
  assert.equal((await f.call({ Origin: "", "Sec-Fetch-Site": "cross-site" })).status, 403)
  assert.equal(f.requests.length, 2)
})

test("Worker separates owner, repository, token, and fetcher verification policies", async (t) => {
  const f = fixture(t)
  assert.equal((await f.call()).status, 200)
  f.env.OWNER_ID = "999"
  assert.equal((await f.call()).status, 403)
  assert.equal(f.requests.length, 4)
  f.env.OWNER_ID = "101"
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 4)
  f.env.REPOSITORY = "fixture-owner/locked"
  assert.equal((await f.call()).status, 403)
  assert.equal(f.requests.length, 6)
  f.permissions.set(f.env.REPOSITORY, true)
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 8)
  f.env.REPOSITORY = repository
  f.users.set("fixture-other-token", 999)
  assert.equal((await f.call({ Authorization: "Bearer fixture-other-token" })).status, 403)
  assert.equal(f.requests.length, 10)
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 10)
  const secondFetcher = fixture(t)
  secondFetcher.users.set("fixture-owner-token", 999)
  assert.equal((await secondFetcher.call()).status, 403)
  assert.equal(secondFetcher.requests.length, 2)
})

test("automation authorization cannot populate owner cache or access private routes after an owner cache hit", async (t) => {
  const f = fixture(t)
  f.users.set("fixture-automation-token", 999)
  const automation = {
    Authorization: "Bearer fixture-automation-token",
    "X-Howard-Sync-Key": f.env.SYNC_SECRET,
  }
  assert.equal((await f.call(automation, "sync/fixture-unknown", {})).status, 404)
  assert.equal(f.requests.length, 0)
  assert.equal((await f.call({ Authorization: automation.Authorization })).status, 403)
  assert.equal(f.requests.length, 2)
  assert.equal((await f.call()).status, 200)
  assert.equal(f.requests.length, 4)
  assert.equal((await f.call({ "X-Howard-Sync-Key": f.env.SYNC_SECRET })).status, 403)
  assert.equal(
    (await f.call({ "X-Howard-Sync-Key": "" }, "personal/articles/import", { articles: [] }))
      .status,
    403,
  )
  assert.equal(f.requests.length, 4)
})

test("invalid bearer tokens are rejected before any verification or cache lookup", async (t) => {
  const f = fixture(t)
  assert.equal((await f.call()).status, 200)
  for (const Authorization of ["", "Bearer", "Bearer two values", `Bearer ${"x".repeat(8193)}`])
    assert.equal((await f.call({ Authorization })).status, 401)
  assert.equal(f.requests.length, 2)
})

test("ordinary long bearer tokens still require exact owner and repository permissions without leaking credentials", async (t) => {
  for (const size of [300, 1024]) {
    await t.test(`${size} bytes`, async (t) => {
      const f = fixture(t)
      const token = "fixture-long-" + "x".repeat(size - "fixture-long-".length)
      const headers = { Authorization: `Bearer ${token}` }
      f.users.set(token, 999)
      const wrongOwner = await f.call(headers)
      assert.equal(wrongOwner.status, 403)
      assert.ok(!(await wrongOwner.text()).includes(token))
      assert.equal(f.requests.length, 2)
      f.users.set(token, 101)
      f.permissions.set(repository, false)
      const noPermission = await f.call(headers)
      assert.equal(noPermission.status, 403)
      assert.ok(!(await noPermission.text()).includes(token))
      assert.equal(f.requests.length, 4)
      f.permissions.set(repository, true)
      const valid = await f.call(headers)
      assert.equal(valid.status, 200)
      assert.ok(!(await valid.text()).includes(token))
      assert.equal(f.requests.length, 6)
      assert.equal((await f.call(headers)).status, 200)
      assert.equal(f.requests.length, 6)
      assert.ok(
        f.requests.every(
          (request) => request.path === "/user" || request.path === `/repos/${repository}`,
        ),
      )
    })
  }
})
