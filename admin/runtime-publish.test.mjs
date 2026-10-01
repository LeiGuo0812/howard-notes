import test from "node:test"
import assert from "node:assert/strict"
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
} = {}) {
  const values = new Map(),
    requests = [],
    states = [],
    synced = [],
    prepared = [],
    reads = []
  let snapshotReads = 0,
    currentCommit = commit,
    revision = 1
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const snapshot = () => ({
    commit: currentCommit,
    catalog: { version: 2, articles: [article, { ...article, id: "draft", published: false }] },
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
                revision,
                currentCommit,
                reusableDocuments: unchanged ? ["a"] : [],
              },
        )
      if (url === `${api}/sync/chunk`) return Response.json({ status: "staged" })
      if (url === `${api}/sync/finish`) {
        if (failFinish) {
          failFinish = false
          return Response.json({ error: "temporary publication error" }, { status: 503 })
        }
        return Response.json({
          status: "synchronized",
          commit: currentCommit,
          revision: ++revision,
        })
      }
      assert.fail(`Unexpected request ${url}`)
    },
    loadProjection: async () => ({
      prepareProjection: async (value) => {
        prepared.push(value)
        return {
          documents: [{ ...article, source, sourceSha: "source-sha", html: "<p>内容</p>" }],
          contentIndex: { "notes/a": { title: article.title } },
          blogData: { articles: [article] },
        }
      },
      renderPages: async () => [{ path: "notes/a", html: "<html>文章</html>" }],
    }),
    onState: (state) => states.push(state),
    onSynchronized: (state) => synced.push(state),
  })
  return {
    publisher,
    requests,
    values,
    states,
    synced,
    prepared,
    reads,
    snapshot,
    advance: () => (currentCommit = nextCommit),
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
  assert.equal(f.synced.length, 1)
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
