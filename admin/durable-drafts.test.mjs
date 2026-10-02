import test from "node:test"
import assert from "node:assert/strict"
import { createDurableDraftController } from "./durable-drafts.mjs"

function fixture() {
  const records = new Map(),
    receipts = new Map(),
    states = [],
    calls = []
  let loseAck = false
  const request = async (path, method, body) => {
    calls.push({ path, method, body: body ? structuredClone(body) : null })
    const [, encodedId, action] = path.split("/")
    const id = decodeURIComponent(encodedId)
    const prior = records.get(id)
    if (method === "GET") {
      if (!prior) {
        const error = new Error("missing")
        error.status = 404
        throw error
      }
      return structuredClone(prior)
    }
    if (receipts.has(body.requestId)) return structuredClone(receipts.get(body.requestId))
    if (body.version !== (prior?.version || 0)) {
      const error = new Error("conflict")
      error.status = 409
      throw error
    }
    const value = {
      editorId: id,
      version: (prior?.version || 0) + 1,
      record: body.record || prior.record,
      status: action === "delete" ? "TRASH" : "ACTIVE",
    }
    records.set(id, structuredClone(value))
    receipts.set(body.requestId, structuredClone(value))
    if (loseAck) {
      loseAck = false
      throw new Error("lost acknowledgement")
    }
    return structuredClone(value)
  }
  const controller = createDurableDraftController({
    request,
    onState: (state) => states.push(state),
  })
  return {
    records,
    receipts,
    states,
    calls,
    request,
    controller,
    loseNextAck() {
      loseAck = true
    },
  }
}

test("durable drafts serialize writes per editor and clone the complete unchanged source baseline", async () => {
  const f = fixture()
  const baseline = { sha: "public-source", raw: "\uFEFF正文\r\n", version: 7 }
  const first = { baseline, content: "未保存修改1" }
  const p1 = f.controller.save("article-a", first)
  first.content = "调用者之后修改，不能影响入队快照"
  const p2 = f.controller.save("article-a", { baseline, content: "未保存修改2" })
  const saved = await Promise.all([p1, p2])
  assert.equal(saved[0].version, 1)
  assert.equal(saved[1].version, 2)
  assert.equal(
    f.calls.filter((call) => call.method === "POST")[0].body.record.content,
    "未保存修改1",
  )
  assert.deepEqual(f.records.get("article-a").record.baseline, baseline)
  assert.equal(f.records.get("article-a").record.content, "未保存修改2")
  assert.deepEqual(
    f.states.filter((state) => state.state === "saved").map((state) => state.version),
    [1, 2],
  )
})

test("cross-device load discovers a durable original and 404 starts a new explicit version zero", async () => {
  const f = fixture()
  assert.equal(await f.controller.load("new-memory-a"), null)
  await f.controller.save("memory:123", {
    kind: "memory",
    content: "\uFEFF原文\r\n",
    baseline: { version: 8 },
  })
  const secondDevice = createDurableDraftController({ request: f.request })
  const restored = await secondDevice.load("memory:123")
  assert.equal(restored.version, 1)
  assert.equal(restored.record.content, "\uFEFF原文\r\n")
  assert.equal(restored.record.baseline.version, 8)
  await secondDevice.save("memory:123", { ...restored.record, content: "合并后的修改" })
  assert.equal(f.records.get("memory:123").version, 2)
})

test("lost save acknowledgement retries the identical UUID before committing a newer edit", async () => {
  const f = fixture()
  f.loseNextAck()
  await assert.rejects(f.controller.save("memory-a", { content: "first" }), /lost acknowledgement/)
  const saved = await f.controller.save("memory-a", { content: "second" })
  assert.equal(saved.version, 2)
  const posts = f.calls.filter((call) => call.method === "POST")
  assert.equal(posts.length, 3)
  assert.equal(posts[0].body.requestId, posts[1].body.requestId)
  assert.equal(posts[0].body.version, posts[1].body.version)
  assert.notEqual(posts[1].body.requestId, posts[2].body.requestId)
  assert.equal(f.records.get("memory-a").record.content, "second")
})

test("a 409 keeps the old baseline and blocks retries until an explicit reviewed merge", async () => {
  const f = fixture()
  await f.controller.save("article-a", { content: "first", baseline: { sha: "original" } })
  f.records.set("article-a", {
    editorId: "article-a",
    version: 2,
    status: "ACTIVE",
    record: { content: "other device", baseline: { sha: "original" } },
  })
  await assert.rejects(
    f.controller.save("article-a", { content: "my unmerged edit", baseline: { sha: "original" } }),
    { status: 409 },
  )
  const count = f.calls.length
  await assert.rejects(f.controller.retry("article-a"), { status: 409 })
  await assert.rejects(f.controller.save("article-a", { content: "still unmerged" }), {
    status: 409,
  })
  assert.equal(f.calls.length, count)
  const remote = await f.controller.load("article-a")
  assert.equal(remote.version, 2)
  await assert.rejects(f.controller.save("article-a", { content: "load alone must not rebase" }), {
    status: 409,
  })
  assert.equal(f.records.get("article-a").record.content, "other device")
  await f.controller.acceptRemoteVersion("article-a", remote.version)
  const merged = await f.controller.save("article-a", {
    content: "reviewed merged text",
    baseline: { sha: "original" },
  })
  assert.equal(merged.version, 3)
  assert.equal(merged.record.baseline.sha, "original")
})

test("a deleted recovery slot can be reused without losing the article's primary original", async () => {
  const f = fixture()
  await f.controller.save("memory-a", { content: "recovery" })
  const removed = await f.controller.remove("memory-a")
  assert.equal(removed.status, "TRASH")
  assert.equal((await f.controller.load("memory-a")).status, "TRASH")
  const next = await f.controller.save("memory-a", { content: "later edit" })
  assert.equal(next.version, 4)
  assert.equal(next.status, "ACTIVE")
  assert.equal(next.record.content, "later edit")
  assert(f.calls.some((call) => call.path.endsWith("/restore")))
})

test("dispose suppresses late private UI callbacks and queued mutations", async () => {
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const states = [],
    calls = []
  const request = async (path, method, body) => {
    calls.push({ path, method })
    if (method === "GET") {
      const error = new Error("missing")
      error.status = 404
      throw error
    }
    await blocked
    return { editorId: "memory-a", version: 1, status: "ACTIVE", record: body.record }
  }
  const controller = createDurableDraftController({
    request,
    onState: (state) => states.push(state),
  })
  const first = controller.save("memory-a", { content: "private text" })
  const second = controller.save("memory-a", { content: "queued private text" })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.filter((call) => call.method === "POST").length, 1)
  controller.dispose()
  const count = states.length
  release()
  await assert.rejects(first, { name: "AbortError" })
  await assert.rejects(second, { name: "AbortError" })
  assert.equal(states.length, count)
  assert.equal(calls.filter((call) => call.method === "POST").length, 1)
})

test("independent editors can persist concurrently and malformed IDs never become API paths", async () => {
  const f = fixture()
  await Promise.all([
    f.controller.save("article-a", { raw: "article" }),
    f.controller.save("memory-b", { raw: "memory" }),
  ])
  assert.equal(f.records.size, 2)
  assert.throws(() => f.controller.save("../secret", { raw: "bad" }), /编号/)
  assert.throws(() => f.controller.load("id/other"), /编号/)
})
