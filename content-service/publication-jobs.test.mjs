import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { createHash, randomUUID } from "node:crypto"
import {
  publicationJobsResponse,
  runPublicationJob,
  runPendingPublications,
} from "./publication-jobs.mjs"
import { persistPersonalArticle, getPersonalArticle } from "./personal-notes.mjs"

const origin = "https://notes.example"
const token = "owner-secret-test-only"
const raw = "\uFEFF# 私密原文\r\n\r\n原始行尾、中文和 **正文** 不变。\r\n"
const metadata = {
  id: "private-note",
  file: "notes/private-note.md",
  title: "原文",
  category: "笔记",
  tags: ["测试"],
  date: "2024-07-02",
  created: "2024-07-02",
  modified: "2025-08-31",
  published: false,
}
const publicMetadata = { ...metadata, published: true }
const settings = JSON.parse(
  fs.readFileSync(new URL("../library/site.json", import.meta.url), "utf8"),
)
const sha = (value) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(value)}\0`)
    .update(value)
    .digest("hex")

function fixture({ published = false } = {}) {
  const sqlite = new DatabaseSync(":memory:")
  for (const file of ["schema.sql", "personal-notes-schema.sql", "publication-jobs-schema.sql"])
    sqlite.exec(fs.readFileSync(new URL(file, import.meta.url), "utf8"))
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let values = []
      return {
        bind(...v) {
          values = v
          return this
        },
        async first() {
          return statement.get(...values) || null
        },
        async all() {
          return { results: statement.all(...values) }
        },
        async run() {
          return { meta: { changes: statement.run(...values).changes } }
        },
      }
    },
    async batch(statements) {
      sqlite.exec("BEGIN")
      try {
        const result = []
        for (const statement of statements) result.push(await statement.run())
        sqlite.exec("COMMIT")
        return result
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  }
  const env = {
    SESSION_SECRET: Buffer.alloc(32, 11).toString("base64url"),
    REPOSITORY: "owner/notes",
    BRANCH: "main",
  }
  const files = new Map([
    [
      "library/catalog.json",
      JSON.stringify({ version: 2, articles: published ? [publicMetadata] : [] }),
    ],
    ["library/site.json", JSON.stringify(settings)],
    ...(published ? [["library/notes/private-note.md", raw]] : []),
  ])
  const state = {
    head: "1".repeat(40),
    writes: 0,
    loseAck: false,
    failNetwork: false,
    requests: [],
    prepared: null,
    nextCommit: null,
    history: ["1".repeat(40)],
  }
  const fetcher = async (url, options) => {
    state.requests.push({ url, method: options.method })
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    assert.equal(options.redirect, "manual")
    assert.equal(options.headers["User-Agent"], "Howard-Notes-Publication")
    if (state.failNetwork) throw new Error("network-unavailable-token-should-not-leak")
    const endpoint = new URL(url).pathname.replace("/repos/owner/notes/", "") + new URL(url).search
    const body = options.body ? JSON.parse(options.body) : null
    const response = (result) => Response.json(result)
    if (endpoint === "git/ref/heads/main") return response({ object: { sha: state.head } })
    if (endpoint.startsWith("git/commits/") && options.method === "GET")
      return response({ tree: { sha: "tree-current" } })
    if (endpoint.startsWith("git/trees/tree-current") && options.method === "GET")
      return response({
        tree: [...files].map(([path, content]) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: sha(content),
        })),
        truncated: false,
      })
    if (endpoint.startsWith("git/blobs/")) {
      const match = [...files.values()].find(
        (content) => sha(content) === endpoint.slice("git/blobs/".length),
      )
      assert.notEqual(match, undefined, "requested blob must exist")
      return response({ content: Buffer.from(match).toString("base64") })
    }
    if (endpoint === "git/trees" && options.method === "POST") {
      state.prepared = body.tree
      return response({ sha: "tree-next" })
    }
    if (endpoint === "git/commits" && options.method === "POST") {
      state.nextCommit = createHash("sha1")
        .update(JSON.stringify(body) + state.writes)
        .digest("hex")
      return response({ sha: state.nextCommit })
    }
    if (endpoint === "git/refs/heads/main" && options.method === "PATCH") {
      assert.equal(body.force, false)
      for (const item of state.prepared) {
        if (item.sha === null) files.delete(item.path)
        else files.set(item.path, item.content)
      }
      state.head = body.sha
      state.history.push(state.head)
      state.writes++
      if (state.loseAck) {
        state.loseAck = false
        throw new Error("accepted update, response lost")
      }
      return response({ object: { sha: state.head } })
    }
    if (endpoint.startsWith("compare/")) {
      const [base, current] = endpoint.slice("compare/".length).split("...")
      const baseIndex = state.history.indexOf(base),
        currentIndex = state.history.indexOf(current)
      const status =
        base === current
          ? "identical"
          : currentIndex >= 0 && baseIndex >= 0
            ? currentIndex > baseIndex
              ? "ahead"
              : "behind"
            : current === state.head
              ? "ahead"
              : "behind"
      return response({ status })
    }
    throw new Error(`Unexpected Git fixture request ${endpoint}`)
  }
  const authorize = async (request) => {
    if (
      request.headers.get("Authorization") !== `Bearer ${token}` ||
      request.headers.get("Origin") !== origin
    ) {
      const error = new Error("此账号没有维护权限。")
      error.status = 403
      throw error
    }
    return token
  }
  const call = (body, route = "personal/jobs", headers = {}, method) =>
    publicationJobsResponse(
      new Request(origin + "/howard-notes/api/content/" + route, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
      DB,
      route,
      authorize,
      {},
      fetcher,
    )
  const note = async (content = raw, version = 0, fields = {}) =>
    persistPersonalArticle(DB, {
      article: { ...metadata, ...fields },
      raw: content,
      version,
      requestId: randomUUID(),
    })
  const sync = (commit = state.head) => {
    sqlite
      .prepare("UPDATE content_state SET revision=revision+1,commit_sha=? WHERE id=1")
      .run(commit)
    const revision = sqlite.prepare("SELECT revision FROM content_state").get().revision
    const catalog = JSON.parse(files.get("library/catalog.json"))
    sqlite
      .prepare("INSERT INTO public_payloads(revision,name,body) VALUES(?,?,?)")
      .run(revision, "catalog", JSON.stringify(catalog))
    for (const item of catalog.articles.filter((a) => a.published))
      sqlite
        .prepare("INSERT INTO public_documents(revision,id,source_sha,body) VALUES(?,?,?,?)")
        .run(
          revision,
          item.id,
          sha(files.get(`library/${item.file}`)),
          JSON.stringify({ article: item, sourceSha: sha(files.get(`library/${item.file}`)) }),
        )
  }
  const queue = async (kind = "publish-private", fields = {}) => {
    const response = await call({
      kind,
      articleId: metadata.id,
      privateVersion: 1,
      requestId: randomUUID(),
      tokenExpiresAt: Date.now() + 3600000,
      ...fields,
    })
    assert.equal(response.status, 202, await response.clone().text())
    return response.json()
  }
  return { sqlite, DB, env, files, state, fetcher, call, note, sync, queue }
}

test("durable publication survives closing browser and only reports completion after verified live projection", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  assert.equal(job.status, "queued")
  assert.equal(f.state.writes, 0)
  await runPendingPublications(f.env, f.DB, f.fetcher)
  const pending = await (await f.call(undefined, `personal/jobs/${job.id}`)).json()
  assert.equal(pending.status, "awaiting_sync")
  assert.equal(f.state.writes, 1)
  assert.equal(f.files.get("library/notes/private-note.md"), raw)
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).status, "ACTIVE")
  f.sync()
  const done = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(done.status, "completed")
  const archived = await getPersonalArticle(f.DB, metadata.id)
  assert.equal(archived.status, "PUBLISHED")
  assert.equal(archived.raw, raw)
  assert.equal(
    f.sqlite.prepare("SELECT token_cipher FROM publication_jobs").get().token_cipher,
    null,
  )
})

test("accepted Git ref update with lost response is acknowledged without duplicate commit", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  f.state.loseAck = true
  const failedAck = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(failedAck.status, "retry")
  assert.equal(f.state.writes, 1)
  assert.equal(f.files.get("library/notes/private-note.md"), raw)
  const retry = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(retry.status, "awaiting_sync")
  assert.equal(f.state.writes, 1)
  f.sync()
  const done = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(done.status, "completed")
  assert.equal(f.state.writes, 1)
})

test("private version changed before publish becomes conflict without touching public Git or discarding edit", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  await f.note(raw + "新修改\r\n", 1)
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "conflict")
  assert.equal(f.state.writes, 0)
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).raw, raw + "新修改\r\n")
})

test("new private edit after Git commit remains a private modification draft after public snapshot succeeds", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  await f.note(raw + "后续修改\r\n", 1)
  f.sync()
  const done = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(done.status, "completed")
  assert.match(done.error, /私密修改稿继续保留/)
  const privateCopy = await getPersonalArticle(f.DB, metadata.id)
  assert.equal(privateCopy.status, "ACTIVE")
  assert.equal(privateCopy.raw, raw + "后续修改\r\n")
  assert.equal(f.files.get("library/notes/private-note.md"), raw)
})

test("privatization requires exact saved private original and removes current Git source atomically", async () => {
  const f = fixture({ published: true })
  await f.note()
  f.sync()
  const job = await f.queue("privatize-public", {
    publicBaseline: { article: publicMetadata, sha: sha(raw) },
  })
  await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(f.state.writes, 1)
  assert.equal(f.files.has("library/notes/private-note.md"), false)
  assert.equal(JSON.parse(f.files.get("library/catalog.json")).articles.length, 0)
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).raw, raw)
  f.sync()
  const done = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(done.status, "completed")
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).status, "ACTIVE")
})

test("privatization keeps the user's explicitly saved private edit while checking the old public baseline", async () => {
  const f = fixture({ published: true })
  await f.note("用户修改后选择存为私密")
  const job = await f.queue("privatize-public", {
    publicBaseline: { article: publicMetadata, sha: sha(raw) },
  })
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "awaiting_sync")
  assert.equal(f.files.has("library/notes/private-note.md"), false)
  assert.equal(f.state.writes, 1)
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).raw, "用户修改后选择存为私密")
})

test("privatization lost acknowledgement deletes only once and retains original private text", async () => {
  const f = fixture({ published: true })
  await f.note()
  const job = await f.queue("privatize-public", {
    publicBaseline: { article: publicMetadata, sha: sha(raw) },
  })
  f.state.loseAck = true
  assert.equal((await runPublicationJob(f.env, f.DB, job.id, f.fetcher)).status, "retry")
  assert.equal(f.state.writes, 1)
  assert.equal((await runPublicationJob(f.env, f.DB, job.id, f.fetcher)).status, "awaiting_sync")
  assert.equal(f.state.writes, 1)
  f.sync()
  assert.equal((await runPublicationJob(f.env, f.DB, job.id, f.fetcher)).status, "completed")
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).raw, raw)
})

test("job APIs never disclose token plaintext or ciphertext and reject automation/unapproved origins", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  const row = f.sqlite.prepare("SELECT * FROM publication_jobs").get()
  assert(row.token_cipher)
  assert.notEqual(row.token_cipher, token)
  assert(!row.token_cipher.includes(token))
  for (const route of ["personal/jobs", `personal/jobs/${job.id}`]) {
    const response = await f.call(undefined, route)
    const body = await response.text()
    assert(!body.includes(token))
    assert(!body.includes(row.token_cipher))
    assert(!body.includes("token_cipher"))
    assert.equal(
      (await f.call(undefined, route, { "X-Howard-Sync-Key": "automation" })).status,
      403,
    )
    assert.equal(
      (await f.call(undefined, route, { Authorization: "Bearer other-user" })).status,
      403,
    )
    assert.equal((await f.call(undefined, route, { Origin: "https://evil.example" })).status, 403)
  }
  f.state.failNetwork = true
  const retry = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(retry.status, "retry")
  assert(!JSON.stringify(retry).includes("network-unavailable-token"))
})

test("job request UUID is idempotent and cannot be reused with a different publication input", async () => {
  const f = fixture()
  await f.note()
  const body = {
    kind: "publish-private",
    articleId: metadata.id,
    privateVersion: 1,
    requestId: randomUUID(),
  }
  const first = await (await f.call(body)).json()
  const second = await (await f.call(body)).json()
  assert.equal(first.id, second.id)
  assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM publication_jobs").get().count, 1)
  assert.equal((await f.call({ ...body, privateVersion: 2 })).status, 409)
})

test("expired execution token pauses job for explicit login and resumption preserves checkpoint", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  const originalCheckpoint = f.sqlite
    .prepare("SELECT checkpoint FROM publication_jobs")
    .get().checkpoint
  f.sqlite
    .prepare("UPDATE publication_jobs SET token_expires_at=? WHERE id=?")
    .run(Date.now() - 1, job.id)
  assert.equal((await runPublicationJob(f.env, f.DB, job.id, f.fetcher)).status, "awaiting_auth")
  assert.equal(
    f.sqlite.prepare("SELECT token_cipher FROM publication_jobs").get().token_cipher,
    null,
  )
  const resumed = await f.call(
    { tokenExpiresAt: Date.now() + 3600000 },
    `personal/jobs/${job.id}/resume`,
  )
  assert.equal(resumed.status, 202)
  assert.equal(
    f.sqlite.prepare("SELECT checkpoint FROM publication_jobs").get().checkpoint,
    originalCheckpoint,
  )
  f.sync()
  assert.equal((await runPublicationJob(f.env, f.DB, job.id, f.fetcher)).status, "completed")
  assert.equal(f.state.writes, 1)
})

test("execution lease prevents duplicated Git writes by another worker instance", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  f.sqlite
    .prepare("UPDATE publication_jobs SET lease_id='other-worker',lease_until=? WHERE id=?")
    .run(Date.now() + 60000, job.id)
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "queued")
  assert.equal(f.state.writes, 0)
  assert.equal(f.state.requests.length, 0)
})

test("publish-private refuses owner-only attachment links before Git writes", async () => {
  const f = fixture()
  await f.note(raw + "![private](/howard-notes/api/content/personal/files/private-image)")
  const job = await f.queue()
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "conflict")
  assert.equal(f.state.writes, 0)
  assert.equal(JSON.parse(f.files.get("library/catalog.json")).articles.length, 0)
})

test("a later commit that republishes a withdrawn article cannot falsely complete privatization", async () => {
  const f = fixture({ published: true })
  await f.note()
  const job = await f.queue("privatize-public", {
    publicBaseline: { article: publicMetadata, sha: sha(raw) },
  })
  await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  f.files.set("library/catalog.json", JSON.stringify({ version: 2, articles: [publicMetadata] }))
  f.files.set("library/notes/private-note.md", raw)
  f.state.head = "b".repeat(40)
  f.sync()
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "conflict")
  assert.match(result.error, /又被公开/)
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).status, "ACTIVE")
  assert.equal(
    f.sqlite.prepare("SELECT token_cipher FROM publication_jobs").get().token_cipher,
    null,
  )
})

test("same commit identity without the desired live source hash cannot complete a publication", async () => {
  const f = fixture()
  await f.note()
  const job = await f.queue()
  await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  f.sync()
  f.sqlite.prepare("UPDATE public_documents SET source_sha=?").run("c".repeat(40))
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "conflict")
  assert.equal((await getPersonalArticle(f.DB, metadata.id)).status, "ACTIVE")
  assert.equal(
    f.sqlite.prepare("SELECT token_cipher FROM publication_jobs").get().token_cipher,
    null,
  )
})

test("an unrelated private source cannot withdraw a different public article", async () => {
  const f = fixture({ published: true })
  await f.note()
  const other = { ...publicMetadata, id: "other-public", file: "notes/other-public.md" }
  f.files.set(
    "library/catalog.json",
    JSON.stringify({ version: 2, articles: [publicMetadata, other] }),
  )
  f.files.set("library/notes/other-public.md", raw)
  const job = await f.queue("privatize-public", {
    publicBaseline: { article: other, sha: sha(raw) },
  })
  const result = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(result.status, "conflict")
  assert.equal(f.state.writes, 0)
  assert(f.files.has("library/notes/other-public.md"))
})

test("public metadata allowlist excludes private provenance, recovery state and nested date source additions", async () => {
  const f = fixture()
  const privateFields = {
    source: { originalPrivatePath: "private-original-note", sourceHash: "private-source-hash" },
    privateBaseline: { raw: "private-recovery-text", version: 7 },
    _private: true,
    _version: 7,
    futureInternalField: "private-future-value",
    dateOrigin: {
      created: "frontmatter",
      modified: "git-history",
      customPrivatePath: "private-provenance-path",
    },
  }
  await f.note(raw, 0, privateFields)
  const job = await f.queue()
  const pending = await runPublicationJob(f.env, f.DB, job.id, f.fetcher)
  assert.equal(pending.status, "awaiting_sync")
  const catalog = JSON.parse(f.files.get("library/catalog.json"))
  const published = catalog.articles[0]
  assert.equal(published.published, true)
  for (const field of ["source", "privateBaseline", "_private", "_version", "futureInternalField"])
    assert.equal(published[field], undefined)
  assert.deepEqual(published.dateOrigin, { created: "frontmatter", modified: "git-history" })
  assert(!JSON.stringify(catalog).includes("private-provenance-path"))
  assert.equal(f.files.get("library/notes/private-note.md"), raw)
  const privateCopy = await getPersonalArticle(f.DB, metadata.id)
  assert.deepEqual(privateCopy.article.source, privateFields.source)
  assert.equal(privateCopy.article.privateBaseline.raw, "private-recovery-text")
})
