import test from "node:test"
import assert from "node:assert/strict"
import { createPublicationWorker } from "./publication-worker-client.mjs"
import {
  createRuntimePublisher,
  publicChange,
  publicationRecord,
  publicationChunks,
  runtimeApiBase,
  renderedPageHash,
} from "./runtime-publish.mjs"

const base = "https://site.example/howard-notes/"
const api = "https://content.example/howard-notes/api/content"
const commit = "a".repeat(40)
const nextCommit = "b".repeat(40)
const source = "\uFEFF# 原始正文\r\n\r\n保留换行。\r\n"
const article = { id: "a", file: "notes/a.md", title: "文章", published: true }

function fixture({
  failFinish = false,
  configError = false,
  disabled = false,
  unchanged = false,
  idempotent = false,
  concurrentUpdate = false,
  projectionChunks,
  onChunk,
} = {}) {
  const values = new Map(),
    requests = [],
    states = [],
    synced = [],
    prepared = [],
    reads = []
  let snapshotReads = 0,
    currentCommit = commit,
    publicCommit = "0".repeat(40),
    visible = true,
    revision = 1
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const snapshot = () => ({
    commit: currentCommit,
    catalog: {
      version: 2,
      articles: [
        { ...article, published: visible },
        { ...article, id: "draft", published: false },
      ],
    },
    settings: { brand: "Howard" },
    entries: new Map([["library/notes/a.md", { sha: "source-sha" }]]),
  })
  const client = {
    token: "synthetic-token-must-not-persist",
    snapshot: async () => {
      snapshotReads++
      return snapshot()
    },
    read: async (value) => {
      reads.push(value.id)
      return { text: source, sha: "source-sha" }
    },
    save: () => assert.fail("Synchronizing must never create a new Git commit"),
  }
  const publisher = createRuntimePublisher({
    siteBase: base,
    getClient: () => client,
    storage,
    fetcher: async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      requests.push({ url, ...options, body })
      assert.equal(options.redirect, "error")
      assert.equal(options.credentials, "omit")
      if (url.endsWith("runtime-config.json")) {
        if (configError) {
          configError = false
          return Response.json({ error: "temporary configuration error" }, { status: 503 })
        }
        return Response.json({ version: 1, enabled: !disabled, apiBase: api })
      }
      if (url === `${api}/config`)
        return Response.json({ version: 1, enabled: true, revision, commit: currentCommit })
      if (url === `${api}/snapshot`)
        return Response.json({
          revision: revision + (concurrentUpdate ? 1 : 0),
          commit: publicCommit,
          documents: [
            {
              ...article,
              source,
              sourceSha: "source-sha",
              ...(unchanged ? { html: "<p>内容</p>" } : {}),
            },
          ],
          pageHashes: unchanged ? { "notes/a": await renderedPageHash("<html>文章</html>") } : {},
        })
      if (url === `${api}/shell`) return Response.json({ head: "", postscript: "" })
      assert.equal(options.headers.Authorization, `Bearer ${client.token}`)
      if (url === `${api}/sync/begin`)
        return Response.json(
          idempotent
            ? { status: "synchronized", revision, commit: currentCommit }
            : {
                syncId: "test-sync",
                revision: revision + 1,
                currentCommit: publicCommit,
                reusableDocuments: unchanged ? ["a"] : [],
              },
        )
      if (url === `${api}/sync/chunk`) {
        const result = await onChunk?.(body)
        return result || Response.json({ status: "staged" })
      }
      if (url === `${api}/sync/finish`) {
        if (failFinish) {
          failFinish = false
          return Response.json({ error: "temporary publication error" }, { status: 503 })
        }
        publicCommit = currentCommit
        return Response.json({
          status: "synchronized",
          commit: currentCommit,
          revision: ++revision,
        })
      }
      assert.fail(`Unexpected request ${url}`)
    },
    loadProjection: async () =>
      projectionChunks
        ? {
            preparePublication: async (value) => {
              prepared.push(value)
              return { chunks: projectionChunks, contentIndex: {}, blogData: {} }
            },
          }
        : {
            prepareProjection: async (value) => {
              prepared.push(value)
              return {
                documents: value.catalog.articles
                  .filter((article) => article.published)
                  .map((article) => ({
                    ...article,
                    source,
                    sourceSha: "source-sha",
                    html: "<p>内容</p>",
                  })),
                contentIndex: { "notes/a": { title: article.title } },
                blogData: { articles: [article] },
              }
            },
            renderPages: async (projection) =>
              projection.documents.map((doc) => ({
                path: `notes/${doc.id}`,
                html: "<html>文章</html>",
              })),
          },
    onState: (state) => states.push(state),
    onSynchronized: (state) => synced.push(state),
  })
  return {
    client,
    publisher,
    requests,
    values,
    states,
    synced,
    prepared,
    reads,
    snapshot,
    advance: (value = nextCommit) => (currentCommit = value),
    visibility: (value) => (visible = value),
    externalUpdate: () => {
      publicCommit = "c".repeat(40)
      revision++
    },
    failNextFinish: () => (failFinish = true),
    snapshotReads: () => snapshotReads,
  }
}

test("public changes exclude draft saves and draft deletion", async () => {
  const f = fixture()
  assert.equal(publicChange({ kind: "draft" }), false)
  assert.equal(publicChange({ kind: "delete", scope: "draft" }), false)
  assert.equal(publicChange({ kind: "delete", scope: "published" }), true)
  assert.equal((await f.publisher.publish({ kind: "draft", commit })).status, "draft")
  assert.equal(
    (await f.publisher.publish({ kind: "delete", scope: "draft", commit })).status,
    "draft",
  )
  assert.equal(f.requests.length, 0)
  assert.equal(f.values.size, 0)
})

test("successful publication reuses only byte-identical public sources and confirms final commit", async () => {
  const f = fixture()
  const result = await f.publisher.publish(
    { kind: "article", commit, articleId: "a" },
    f.snapshot(),
  )
  assert.equal(result.status, "synchronized")
  assert.equal(result.commit, commit)
  assert.equal(f.reads.length, 0)
  assert.equal(f.snapshotReads(), 0)
  assert.equal(f.values.size, 0)
  assert.equal(f.synced.length, 1)
  assert.equal(
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(f.prepared[0].sources.get(article.file)),
    source,
  )
  assert.equal(f.prepared[0].sources.has("notes/draft.md"), false)
  const chunks = f.requests.filter((request) => request.url.endsWith("/sync/chunk"))
  assert.ok(chunks.some((request) => request.body.documents?.[0].source === source))
  assert.ok(chunks.some((request) => request.body.contentIndex))
  assert.ok(chunks.some((request) => request.body.blogData))
  for (const request of f.requests.filter((request) => !request.body))
    assert.equal(request.headers.Authorization, undefined)
})

test("failed D1 finish remains pending; retry reads latest Git head and makes no Git write", async () => {
  const f = fixture({ failFinish: true })
  const result = await f.publisher.publish(
    { kind: "article", commit, articleId: "a" },
    f.snapshot(),
  )
  assert.equal(result.status, "pending")
  assert.equal(f.synced.length, 0)
  const persisted = [...f.values.values()].join("")
  assert.ok(persisted.includes(commit))
  assert.ok(!persisted.includes("synthetic-token"))
  assert.ok(!persisted.includes("原始正文"))
  assert.ok(!persisted.includes("<p>"))
  f.advance()
  const retried = await f.publisher.retry()
  assert.equal(retried.status, "synchronized")
  assert.equal(retried.commit, nextCommit)
  assert.equal(f.snapshotReads(), 1)
  assert.equal(f.synced.length, 1)
  assert.equal(f.values.size, 0)
  assert.equal(
    f.requests.filter((request) => request.url.endsWith("/sync/begin")).at(-1).body.commit,
    nextCommit,
  )
})

test("browser publication and retry use only the acknowledged public snapshot of a merged owner library", async () => {
  const f = fixture({ failFinish: true })
  let publicReads = 0
  f.client.publicSnapshot = async () => {
    publicReads++
    return f.snapshot()
  }
  f.client.snapshot = async () =>
    assert.fail("private owner catalog must never be projected publicly")
  const merged = {
    ...f.snapshot(),
    catalog: {
      version: 2,
      articles: [{ ...article, published: false, title: "PRIVATE_SOURCE_MUST_NOT_SYNC" }],
    },
    publicSnapshot: f.snapshot(),
  }
  assert.equal((await f.publisher.publish({ kind: "article", commit }, merged)).status, "pending")
  f.advance()
  assert.equal((await f.publisher.retry()).status, "synchronized")
  assert.equal(publicReads, 1)
  assert.ok(
    f.prepared.every(
      (value) => value.catalog.articles.find((row) => row.id === "a").published === true,
    ),
  )
  assert.doesNotMatch(JSON.stringify(f.requests), /PRIVATE_SOURCE_MUST_NOT_SYNC/)
})

test("temporary service configuration error does not pretend static deployment succeeded", async () => {
  const f = fixture({ configError: true })
  const result = await f.publisher.publish({ kind: "settings", commit }, f.snapshot())
  assert.equal(result.status, "pending")
  assert.ok(f.publisher.pending())
  assert.equal(f.synced.length, 0)
  assert.equal((await f.publisher.retry()).status, "synchronized")
  assert.equal(
    f.requests.filter((request) => request.url.endsWith("runtime-config.json")).length,
    2,
  )
})

test("explicitly disabled runtime retains the static publishing fallback", async () => {
  const f = fixture({ disabled: true })
  assert.equal(
    (await f.publisher.publish({ kind: "unpublish", commit }, f.snapshot())).status,
    "static",
  )
  assert.equal(f.requests.length, 1)
  assert.equal(f.prepared.length, 0)
  assert.equal(f.values.size, 0)
})

test("unchanged documents and pages are reused while metadata is always synchronized", async () => {
  const f = fixture({ unchanged: true })
  assert.equal(
    (await f.publisher.publish({ kind: "settings", commit }, f.snapshot())).status,
    "synchronized",
  )
  const chunks = f.requests.filter((request) => request.url.endsWith("/sync/chunk"))
  assert.equal(chunks.length, 2)
  assert.ok(chunks.every((request) => !request.body.documents && !request.body.pages))
  assert.ok(chunks.some((request) => request.body.contentIndex))
  assert.ok(chunks.some((request) => request.body.blogData))
})

test("an already synchronized begin acknowledges the saved commit without another upload", async () => {
  const f = fixture({ idempotent: true })
  assert.equal(
    (await f.publisher.publish({ kind: "article", commit }, f.snapshot())).status,
    "synchronized",
  )
  assert.equal(f.requests.filter((request) => request.url.endsWith("/sync/chunk")).length, 0)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/sync/finish")).length, 0)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/snapshot")).length, 0)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/shell")).length, 0)
  assert.equal(f.prepared.length, 0)
  assert.equal(f.reads.length, 0)
  assert.equal(f.synced.length, 1)
})

test("consecutive publications reuse only the exact canonically confirmed public baseline", async () => {
  const f = fixture()
  assert.equal(
    (await f.publisher.publish({ kind: "article", commit }, f.snapshot())).status,
    "synchronized",
  )
  f.advance()
  assert.equal(
    (await f.publisher.publish({ kind: "article", commit: nextCommit }, f.snapshot())).status,
    "synchronized",
  )
  assert.equal(f.requests.filter((request) => request.url.endsWith("/snapshot")).length, 1)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/shell")).length, 1)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/sync/begin")).length, 2)
  assert.equal(f.prepared[1].previous.commit, commit)
  assert.equal(f.prepared[1].previous.revision, 2)
  assert.deepEqual(
    f.prepared[1].previous.documents.map((doc) => doc.id),
    ["a"],
  )
  assert.equal(f.prepared[1].previous.documents[0].html, "<p>内容</p>")
  assert.equal(
    f.prepared[1].previous.pageHashes["notes/a"],
    await renderedPageHash("<html>文章</html>"),
  )
})

test("an external publication invalidates the in-memory baseline before source/AST reuse", async () => {
  const f = fixture()
  await f.publisher.publish({ kind: "article", commit }, f.snapshot())
  f.advance()
  f.externalUpdate()
  assert.equal(
    (await f.publisher.publish({ kind: "settings", commit: nextCommit }, f.snapshot())).status,
    "synchronized",
  )
  assert.equal(f.requests.filter((request) => request.url.endsWith("/snapshot")).length, 2)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/shell")).length, 2)
  assert.equal(f.prepared[1].previous.commit, "c".repeat(40))
  assert.equal(f.prepared[1].previous.revision, 3)
})

test("a failed finish never promotes its projection into the cached public version", async () => {
  const f = fixture()
  await f.publisher.publish({ kind: "article", commit }, f.snapshot())
  f.advance()
  f.failNextFinish()
  assert.equal(
    (await f.publisher.publish({ kind: "article", commit: nextCommit }, f.snapshot())).status,
    "pending",
  )
  assert.equal((await f.publisher.retry()).status, "synchronized")
  assert.equal(f.prepared[1].previous.commit, commit)
  assert.equal(f.prepared[2].previous.commit, commit)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/snapshot")).length, 1)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/shell")).length, 1)
  assert.equal(f.values.size, 0)
})

test("a snapshot changed after begin is rejected before staging any old rendered content", async () => {
  const f = fixture({ concurrentUpdate: true })
  const result = await f.publisher.publish({ kind: "article", commit }, f.snapshot())
  assert.equal(result.status, "pending")
  assert.equal(result.code, 409)
  assert.equal(f.prepared.length, 0)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/sync/chunk")).length, 0)
  assert.equal(f.synced.length, 0)
  assert.ok(f.publisher.pending())
})

test("removing an article also removes its cached document/page hashes before restoring it", async () => {
  const f = fixture()
  await f.publisher.publish({ kind: "article", commit }, f.snapshot())
  f.visibility(false)
  f.advance()
  await f.publisher.publish(
    { kind: "delete", commit: nextCommit, scope: "published" },
    f.snapshot(),
  )
  const beforeRestore = f.requests.length
  f.visibility(true)
  f.advance("d".repeat(40))
  assert.equal(
    (await f.publisher.publish({ kind: "article", commit: "d".repeat(40) }, f.snapshot())).status,
    "synchronized",
  )
  assert.deepEqual(f.prepared[2].previous.documents, [])
  assert.deepEqual(f.prepared[2].previous.pageHashes, {})
  assert.deepEqual(f.reads, ["a"])
  const restoreChunks = f.requests
    .slice(beforeRestore)
    .filter((request) => request.url.endsWith("/sync/chunk"))
  assert.ok(restoreChunks.some((request) => request.body.documents?.[0]?.id === "a"))
  assert.ok(restoreChunks.some((request) => request.body.pages?.[0]?.path === "notes/a"))
})

test("publication prewarm shares one worker and disposal rejects active work without leaking timers", async (t) => {
  const original = globalThis.Worker
  const workers = []
  globalThis.Worker = class {
    constructor(url, options) {
      this.url = url
      this.options = options
      workers.push(this)
    }
    postMessage(data) {
      this.message = data
    }
    terminate() {
      this.terminated = true
    }
  }
  const background = createPublicationWorker(base)
  t.after(() => {
    background.dispose()
    if (original) globalThis.Worker = original
    else delete globalThis.Worker
  })
  background.warm()
  background.warm()
  assert.equal(workers.length, 1)
  assert.equal(workers[0].url.href, `${base}maintenance-assets/publication-worker.js`)
  assert.equal(workers[0].options.type, "module")
  const completed = background.preparePublication({ public: true })
  workers[0].onmessage({ data: { id: workers[0].message.id, result: { chunks: [] } } })
  assert.deepEqual(await completed, { chunks: [] })
  const stopped = background.preparePublication({ public: true })
  background.dispose()
  await assert.rejects(stopped, /后台准备已停止/)
  assert.equal(workers[0].terminated, true)
})

test("chunk uploads refill available slots without waiting for one slow request, with concurrency capped at three", async (t) => {
  const paths = ["notes/a", "about", "topics/index", "notes/index"]
  let releaseFirst,
    fourthStarted,
    active = 0,
    maximum = 0
  const blocked = new Promise((resolve) => (releaseFirst = resolve))
  const nextStarted = new Promise((resolve) => (fourthStarted = resolve))
  t.after(() => releaseFirst())
  const f = fixture({
    projectionChunks: paths.map((path) => ({ documents: [], pages: [{ path, html: "内容" }] })),
    onChunk: async (body) => {
      const path = body.pages?.[0]?.path
      if (!path) return
      maximum = Math.max(maximum, ++active)
      if (path === paths[3]) fourthStarted()
      if (path === paths[0]) await blocked
      else await new Promise((resolve) => setTimeout(resolve, 0))
      active--
    },
  })
  const publication = f.publisher.publish({ kind: "article", commit }, f.snapshot())
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("A free upload slot was not refilled")), 1000)
    nextStarted.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  assert.ok(maximum <= 3)
  assert.ok(active > 0)
  releaseFirst()
  assert.equal((await publication).status, "synchronized")
  assert.equal(f.states.filter((state) => state.progress).at(-1).progress, "4/4")
})

test("a failed chunk stops new work and retains pending state without advancing metadata or finish", async () => {
  const f = fixture({
    projectionChunks: Array.from({ length: 8 }, (_, index) => ({
      documents: [],
      pages: [{ path: `notes/p${index}`, html: "内容" }],
    })),
    onChunk: async (body) => {
      if (body.pages[0].path === "notes/p0")
        return Response.json({ error: "temporary chunk failure" }, { status: 503 })
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  })
  assert.equal(
    (await f.publisher.publish({ kind: "article", commit }, f.snapshot())).status,
    "pending",
  )
  assert.equal(f.requests.filter((request) => request.url.endsWith("/sync/chunk")).length, 3)
  assert.equal(f.requests.filter((request) => request.url.endsWith("/sync/finish")).length, 0)
  assert.ok(f.publisher.pending())
  assert.equal(f.synced.length, 0)
})

test("sync response for another commit is never reported as online", async () => {
  const f = fixture()
  f.advance()
  const snapshot = f.snapshot()
  snapshot.commit = commit
  const result = await f.publisher.publish({ kind: "article", commit }, snapshot)
  assert.equal(result.status, "pending")
  assert.equal(f.synced.length, 0)
  assert.ok(f.publisher.pending())
})

test("retry records are bounded identifiers and reject malformed commit values", () => {
  assert.equal(publicationRecord({ kind: "article", commit: "invalid" }), null)
  assert.deepEqual(publicationRecord({ kind: "article", commit, token: "secret", source }), {
    version: 1,
    kind: "article",
    commit,
  })
  assert.equal(
    publicationRecord({ kind: "delete", commit, removedIds: Array(200).fill("a") }).removedIds
      .length,
    100,
  )
})

test("large pages remain publishable while combined chunks leave Free Worker CPU room", () => {
  const pages = [120000, 120000, 120000, 500000].map((length, i) => ({
    path: `notes/page-${i}`,
    html: "a".repeat(length),
  }))
  const chunks = publicationChunks([], pages)
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.pages),
    pages,
  )
  assert.ok(
    chunks.every((chunk) => chunk.pages.length === 1 || JSON.stringify(chunk).length <= 250000),
  )
  assert.equal(chunks.at(-1).pages.length, 1)
  assert.throws(() =>
    publicationChunks([], [{ path: "notes/too-large", html: "a".repeat(730000) }]),
  )
})

test("publication chunks enforce combined row count and UTF-8 byte size", () => {
  const documents = Array.from({ length: 13 }, (_, index) => ({
    id: `d${index}`,
    source: "汉".repeat(100),
  }))
  const pages = Array.from({ length: 12 }, (_, index) => ({
    path: `notes/p${index}`,
    html: "a".repeat(120),
  }))
  const chunks = publicationChunks(documents, pages, 1200, 5)
  assert.equal(chunks.flatMap((chunk) => chunk.documents).length, 13)
  assert.equal(chunks.flatMap((chunk) => chunk.pages).length, 12)
  for (const chunk of chunks) {
    assert.ok(chunk.documents.length + chunk.pages.length <= 5)
    assert.ok(new TextEncoder().encode(JSON.stringify(chunk)).length <= 1200)
  }
  assert.throws(() => publicationChunks([{ source: "汉".repeat(1000) }], [], 1200), /大小限制/)
})

test("runtime origin validation prevents credential URLs, unexpected paths, and insecure remote hosts", () => {
  assert.equal(
    runtimeApiBase("/howard-notes/api/content", base),
    "https://site.example/howard-notes/api/content",
  )
  assert.equal(
    runtimeApiBase("/howard-notes/api/content", "http://localhost:8080/howard-notes/"),
    "http://localhost:8080/howard-notes/api/content",
  )
  for (const value of [
    "http://content.example/api/content",
    "https://user:password@content.example/api/content",
    "https://content.example/api/content?token=secret",
    "https://content.example/api/content#fragment",
    "https://content.example/other",
  ])
    assert.throws(() => runtimeApiBase(value, base), /地址不正确/)
})
