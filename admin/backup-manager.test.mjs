import { test } from "node:test"
import assert from "node:assert/strict"
import { backupRequest, backupMetrics, createBackupManager } from "./backup-manager.mjs"

function managerFixture(t, latest = null) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1 })
  class Element {
    children = []
    handlers = new Map()
    classList = { add() {} }
    setAttribute() {}
    append(...children) {
      this.children.push(...children)
    }
    replaceChildren(...children) {
      this.children = children
    }
    addEventListener(type, listener) {
      this.handlers.set(type, listener)
    }
    click() {
      return this.handlers.get("click")?.()
    }
  }
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => new Element() }
  const root = new Element(),
    calls = [],
    notices = []
  let statusValue = { latest },
    statusGate
  const client = {
    token: "fixture",
    siteBase: "https://notes.example/site/",
    endpoint: async () => "https://notes.example/site/api/content",
    fetcher: async (url, options) => {
      const path = url.split("/").at(-1)
      calls.push({ path, body: options.body ? JSON.parse(options.body) : null })
      if (path === "status") {
        if (statusGate) await statusGate
        return Response.json(statusValue)
      }
      return Response.json(path === "run" ? { accepted: true } : {})
    },
  }
  const manager = createBackupManager({
    root,
    getClient: () => client,
    notify: (...value) => notices.push(value),
  })
  t.after(() => {
    manager.dispose()
    globalThis.document = previousDocument
  })
  return {
    manager,
    calls,
    notices,
    run: root.children[2].children[0],
    status: root.children[1],
    setStatus: (value) => {
      statusValue = value
    },
    blockStatus: (value) => {
      statusGate = value
    },
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test("a Cron-busy manual start retries the same generation then continues progress and stops on completion", async (t) => {
  const old = { id: "old", completedAt: "2026-10-03T00:00:00Z", rows: 10 }
  const f = managerFixture(t, old)
  await f.manager.load()
  await f.run.click()
  assert.deepEqual(
    f.calls.filter((row) => row.path === "run").map((row) => row.body),
    [{ action: "start", expectedLatestId: "old" }],
  )
  t.mock.timers.tick(5000)
  await settle()
  assert.match(f.status.textContent, /等待.*自动重试/)
  assert.deepEqual(f.calls.filter((row) => row.path === "run").at(-1).body, {
    action: "start",
    expectedLatestId: "old",
  })
  f.setStatus({ latest: old, progress: { copiedTables: 2, totalTables: 10, rows: 20 } })
  t.mock.timers.tick(5000)
  await settle()
  assert.deepEqual(f.calls.filter((row) => row.path === "run").at(-1).body, { action: "continue" })
  f.setStatus({ latest: { ...old, id: "new" } })
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(f.status.textContent, "加密备份已完成。")
  const count = f.calls.length
  t.mock.timers.tick(60000)
  await settle()
  assert.equal(f.calls.length, count)
})

test("an empty backup history still retries but stops after twelve total starts and allows an explicit retry", async (t) => {
  const f = managerFixture(t)
  await f.manager.load()
  await f.run.click()
  for (let i = 0; i < 11; i++) {
    t.mock.timers.tick(5000)
    await settle()
  }
  const runs = f.calls.filter((row) => row.path === "run")
  assert.equal(runs.length, 12, "one initial request plus eleven bounded retries")
  assert.ok(runs.every((row) => row.body.expectedLatestId === null && row.body.action === "start"))
  t.mock.timers.tick(5000)
  await settle()
  assert.match(f.status.textContent, /无法启动.*重试/)
  assert.equal(f.notices.at(-1)[1], true)
  t.mock.timers.tick(60000)
  await settle()
  assert.equal(f.calls.filter((row) => row.path === "run").length, 12)
  await f.run.click()
  assert.equal(f.calls.filter((row) => row.path === "run").length, 13)
})

test("manual start waits for the first status response to establish its generation baseline", async (t) => {
  const f = managerFixture(t, { id: "existing", completedAt: "2026-10-03T00:00:00Z", rows: 3 })
  assert.equal(f.run.disabled, true)
  await f.run.click()
  assert.equal(f.calls.filter((row) => row.path === "run").length, 0)
  await f.manager.load()
  assert.equal(f.run.disabled, false)
  await f.run.click()
  assert.deepEqual(f.calls.filter((row) => row.path === "run").at(-1).body, {
    action: "start",
    expectedLatestId: "existing",
  })
})

test("refresh clicks cannot bypass the retry interval or duplicate in-flight status requests", async (t) => {
  const f = managerFixture(t)
  await f.manager.load()
  await f.run.click()
  await f.manager.load()
  await f.manager.load()
  assert.equal(f.calls.filter((row) => row.path === "run").length, 1)
  let release
  f.blockStatus(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const pending = f.manager.load()
  await settle()
  const before = f.calls.filter((row) => row.path === "status").length
  await f.manager.load()
  assert.equal(f.calls.filter((row) => row.path === "status").length, before)
  release()
  await pending
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(f.calls.filter((row) => row.path === "run").length, 2)
})

test("backup metrics distinguish stale backups, queued jobs and retained unlinked files", () => {
  const rows = backupMetrics(
    { health: { stale: true, restartCount: 3, durationMs: 1200 } },
    {
      files: { uniqueObjectCount: 2, uniqueObjectBytes: 2 * 1024 * 1024, uncataloguedCount: 1 },
      queue: { activeCount: 4, awaitingAuthCount: 1, oldestPendingAgeMs: 20 * 60000 },
    },
  )
  assert.match(JSON.stringify(rows), /48 小时/)
  assert.match(JSON.stringify(rows), /2\.0 MB/)
  assert.match(JSON.stringify(rows), /继续保留/)
  assert.match(JSON.stringify(rows), /20 分钟/)
  assert.equal(backupMetrics({}, null).length, 0)
})

test("backup request never sends credentials to another origin or an arbitrary route", async () => {
  let calls = 0
  const client = {
    token: "fixture",
    siteBase: "https://notes.example/site/",
    endpoint: async () => "https://other.example/site/api/content",
    fetcher: async () => calls++,
  }
  await assert.rejects(backupRequest(client, "status"), /其他地址/)
  await assert.rejects(backupRequest(client, "../session"), /操作不正确/)
  assert.equal(calls, 0)
})

test("backup downloads preserve the binary response, refuse redirects and bypass caches", async () => {
  let actual
  const expected = new Response(new Uint8Array([1, 0, 255]))
  const client = {
    token: "fixture",
    siteBase: "https://notes.example/site/",
    endpoint: async () => "https://notes.example/site/api/content",
    fetcher: async (url, options) => {
      actual = { url, options }
      return expected
    },
  }
  assert.equal(await backupRequest(client, "download"), expected)
  assert.equal(actual.url, "https://notes.example/site/api/content/backups/download")
  assert.equal(actual.options.redirect, "error")
  assert.equal(actual.options.cache, "no-store")
  assert.equal(actual.options.credentials, "same-origin")
})
