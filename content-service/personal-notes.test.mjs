import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import {
  personalNotesResponse,
  cleanupPersonalNotes,
  getPersonalArticle,
  markPersonalPublished,
  persistPersonalArticle,
} from "./personal-notes.mjs"
import { sessionResponse } from "./session.mjs"

const origin = "https://notes.example"
const endpoint = origin + "/howard-notes/api/content/"
const original = "\uFEFF# 中文原文\r\n\r\n' 引号与 \\ 路径 **原样保留**。\r\n"
const article = (id = "private-note", fields = {}) => ({
  id,
  file: `notes/private/${id}.md`,
  title: "私密中文笔记",
  category: "个人技术库",
  tags: ["中文", "技术/原文"],
  date: "2024-07-02",
  created: "2024-07-02",
  modified: "2025-08-31",
  published: false,
  featured: false,
  dateOrigin: { created: "source", modified: "source" },
  ...fields,
})
const digest = (value) => createHash("sha256").update(value).digest("hex")
function fixture() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(fs.readFileSync(new URL("personal-notes-schema.sql", import.meta.url), "utf8"))
  sqlite.exec(fs.readFileSync(new URL("memories-schema.sql", import.meta.url), "utf8"))
  sqlite.exec(fs.readFileSync(new URL("backups-schema.sql", import.meta.url), "utf8"))
  const queries = []
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
          queries.push(sql)
          return statement.get(...values) || null
        },
        async all() {
          queries.push(sql)
          return { results: statement.all(...values) }
        },
        async run() {
          queries.push(sql)
          return { meta: { changes: statement.run(...values).changes } }
        },
      }
    },
    async batch(statements) {
      sqlite.exec("BEGIN")
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  }
  const objects = new Map()
  let puts = 0
  const bucket = {
    async put(key, bytes, metadata) {
      puts++
      objects.set(key, { bytes: new Uint8Array(bytes).slice(), metadata })
    },
    async head(key) {
      const object = objects.get(key)
      return object ? { size: object.bytes.length } : null
    },
    async get(key, options) {
      const object = objects.get(key)
      if (!object) return null
      const range = options?.range
      const bytes = range
        ? object.bytes.slice(range.offset, range.offset + range.length)
        : object.bytes.slice()
      return { body: bytes, size: bytes.length }
    },
  }
  const env = {
    DB,
    SITE_PREFIX: "/howard-notes/",
    SESSION_SECRET: Buffer.alloc(32, 13).toString("base64url"),
    SYNC_SECRET: "test-only-import-secret",
    FALLBACK_ORIGIN: "https://backup.example",
    PERSONAL_FILES_BUCKET: bucket,
  }
  let authorizationCalls = 0
  const authorize = async (request) => {
    authorizationCalls++
    if (request.headers.get("Authorization") !== "Bearer test-owner") {
      const error = new Error("此账号没有维护权限。")
      error.status = 403
      throw error
    }
    return "test-owner"
  }
  const call = (path = "personal/articles", body, headers = {}, method) => {
    const request = new Request(endpoint + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return personalNotesResponse(request, env, DB, path.split("?")[0], authorize)
  }
  const ownerHeaders = { Authorization: "Bearer test-owner", Origin: origin }
  const owner = (path, body, headers = {}, method) =>
    call(path, body, { ...ownerHeaders, ...headers }, method)
  const save = (id = "private-note", version = 0, raw = original, fields = {}, extras = {}) =>
    owner("personal/articles", {
      article: article(id, fields),
      raw,
      version,
      requestId: randomUUID(),
      ...extras,
    })
  const upload = (id, bytes, name = "私密图片.png", mimeType = "image/png") =>
    owner("personal/files", {
      file: { id, name, mimeType, size: bytes.length, sha256: digest(bytes) },
    })
  const putFile = (id, bytes, headers = {}) =>
    personalNotesResponse(
      new Request(endpoint + `personal/files/${id}`, {
        method: "PUT",
        headers: { ...ownerHeaders, "Content-Type": "application/octet-stream", ...headers },
        body: bytes,
      }),
      env,
      DB,
      `personal/files/${id}`,
      authorize,
    )
  return {
    sqlite,
    DB,
    env,
    queries,
    authorize,
    call,
    owner,
    save,
    upload,
    putFile,
    bucket,
    objects,
    get puts() {
      return puts
    },
    get authorizationCalls() {
      return authorizationCalls
    },
  }
}
async function value(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text())
  return response.json()
}

test("private article save preserves BOM, CRLF, original metadata and bytes without public tables", async () => {
  const f = fixture()
  const saved = await value(await f.save())
  assert.equal(saved.raw, original)
  assert.deepEqual(saved.article, article())
  assert.equal(saved.version, 1)
  assert.equal(saved.sha, "pv:1")
  assert.equal(saved.storage, "private")
  assert.equal(saved.status, "ACTIVE")
  const read = await value(await f.owner("personal/articles/private-note"))
  assert.equal(digest(read.raw), digest(original))
  assert.deepEqual(read.article, article())
  const list = await value(await f.owner("personal/articles?all=1"))
  assert.equal(list.total, 1)
  assert.equal(list.articles[0].raw, undefined)
  assert.deepEqual(list.articles[0].article, article())
  assert(
    f.queries.every(
      (sql) => !/(?:FROM|INTO|UPDATE)\s+(?:public_|content_index|catalog|rss)/i.test(sql),
    ),
  )
  assert(
    f.queries.some((sql) =>
      /SELECT id,version,status,article,source_hash,public_link,updated_at,deleted_at FROM personal_articles/.test(
        sql,
      ),
    ),
  )
})

test("owner authentication guards every private read, import, file, history and export", async () => {
  const f = fixture()
  await value(await f.save())
  for (const route of [
    "personal/articles",
    "personal/articles/private-note",
    "personal/articles/private-note/versions",
    "personal/articles/private-note/versions/1",
    "personal/drafts",
    "personal/files/resource-private",
    "personal/export",
  ]) {
    assert.equal((await f.call(route)).status, 401)
    assert.equal(
      (await f.call(route, undefined, { Authorization: "Bearer other-user" })).status,
      403,
    )
  }
  const importBody = { articles: [{ article: article("imported"), raw: original }] }
  assert.equal((await f.call("personal/articles/import", importBody)).status, 401)
  assert.equal(
    (
      await f.owner("personal/articles/import", importBody, {
        "X-Howard-Sync-Key": f.env.SYNC_SECRET,
      })
    ).status,
    403,
  )
  assert.equal(
    (await f.owner("personal/articles", undefined, { Origin: "https://evil.example" })).status,
    403,
  )
  assert.equal(
    (await f.owner("personal/articles", undefined, { "Sec-Fetch-Site": "cross-site" })).status,
    403,
  )
  assert.equal(
    (await f.owner("personal/export", undefined, { "X-Howard-Sync-Key": f.env.SYNC_SECRET }))
      .status,
    403,
  )
})

test("owner same-origin cookie can read private articles, expired cookie cannot", async () => {
  const f = fixture()
  await value(await f.save())
  const response = await sessionResponse(
    new Request(endpoint + "session", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-owner",
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serverTime: Date.now(), expiresAt: Date.now() + 60000 }),
    }),
    f.env,
    f.authorize,
  )
  assert.equal(response.status, 200)
  const cookie = response.headers.get("Set-Cookie").split(";")[0]
  assert.equal(
    (await f.call("personal/articles/private-note", undefined, { Cookie: cookie, Origin: origin }))
      .status,
    200,
  )
  assert.equal(
    (
      await f.call("personal/articles/private-note", undefined, {
        Cookie: "howard_session=invalid",
        Origin: origin,
      })
    ).status,
    401,
  )
  assert.equal(
    (
      await f.call("personal/articles/private-note", undefined, {
        Cookie: cookie,
        Origin: "https://evil.example",
      })
    ).status,
    403,
  )
})

test("private writes require explicit versions and keep private/public identity stable", async () => {
  const f = fixture()
  await value(await f.save())
  assert.equal((await f.save("private-note", 0, "lost edit")).status, 409)
  const saved = await value(await f.save("private-note", 1, original + "新增\r\n"))
  assert.equal(saved.version, 2)
  assert.equal(saved.article.id, "private-note")
  assert.equal(saved.article.file, "notes/private/private-note.md")
  assert.equal((await f.save("private-note", 1, "stale device")).status, 409)
  assert.equal((await f.save("second", 0, "collision", { file: article().file })).status, 409)
  assert.equal((await f.save("public-flag", 0, original, { published: true })).status, 400)
  assert.equal((await f.save("bad-path", 0, original, { file: "notes/../bad.md" })).status, 400)
  assert.equal(
    (await f.save("bad-hash", 0, original, {}, { sourceHash: "0".repeat(64) })).status,
    409,
  )
})

test("request retries do not duplicate revisions and reused operation keys cannot overwrite", async () => {
  const f = fixture()
  const body = { article: article(), raw: original, version: 0, requestId: randomUUID() }
  const first = await value(await f.owner("personal/articles", body))
  const second = await value(await f.owner("personal/articles", body))
  assert.equal(second.replayed, true)
  assert.equal(second.raw, original)
  assert.equal(second.version, first.version)
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM personal_article_versions").get().count,
    1,
  )
  assert.equal((await f.owner("personal/articles", { ...body, raw: "different" })).status, 409)
  const receipt = JSON.parse(
    f.sqlite.prepare("SELECT response FROM personal_requests").get().response,
  )
  assert.equal(receipt.raw, undefined)
})

test("private import verifies exact source bytes, retries safely and refuses to overwrite later edits", async () => {
  const f = fixture()
  const entry = { article: article(), raw: original, sourceHash: digest(original) }
  const first = await value(await f.owner("personal/articles/import", { articles: [entry] }))
  assert.equal(first.imported, 1)
  const again = await value(await f.owner("personal/articles/import", { articles: [entry] }))
  assert.equal(again.imported, 0)
  assert.equal(again.articles[0].raw, original)
  const updated = await value(await f.save("private-note", 1, original + "网页新增\r\n"))
  assert.equal(updated.version, 2)
  assert.equal((await f.owner("personal/articles/import", { articles: [entry] })).status, 409)
  const read = await getPersonalArticle(f.DB, "private-note")
  assert.equal(read.raw, original + "网页新增\r\n")
})

test("a full import batch stays under the Free Worker D1 query budget even with many attachments", async () => {
  const f = fixture()
  const attachments = Array.from({ length: 120 }, (_, index) => ({
    fileId: `private-file-${index}`,
  }))
  const articles = Array.from({ length: 3 }, (_, index) => ({
    article: article(`import-${index}`, { attachments }),
    raw: original,
  }))
  const result = await value(await f.owner("personal/articles/import", { articles }))
  assert.equal(result.imported, 3)
  assert(f.queries.length <= 50)
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM personal_attachments").get().count,
    360,
  )
  assert.equal(
    (
      await f.owner("personal/articles/import", {
        articles: [...articles, { article: article("too-many"), raw: original }],
      })
    ).status,
    400,
  )
})

test("publication finalizer preserves original private source, hides published shadow and detects new edits", async () => {
  const f = fixture()
  const saved = await value(await f.save())
  const publicLink = {
    id: "private-note",
    file: article().file,
    sha: "a".repeat(40),
    article: { ...article(), published: true },
  }
  const published = await markPersonalPublished(f.DB, saved.article.id, saved.version, publicLink)
  assert.equal(published.status, "PUBLISHED")
  assert.equal(published.version, 2)
  assert.equal(published.raw, original)
  assert.deepEqual(published.article, article())
  assert.equal((await value(await f.owner("personal/articles"))).total, 0)
  const replay = await markPersonalPublished(f.DB, saved.article.id, saved.version, publicLink)
  assert.equal(replay.version, 2)
  const edit = await value(await f.save("private-note", 2, original + "私密修改\r\n"))
  assert.equal(edit.status, "ACTIVE")
  assert.deepEqual(edit.publicLink, publicLink)
  await assert.rejects(
    markPersonalPublished(f.DB, "private-note", 2, { ...publicLink, sha: "b".repeat(40) }),
    { status: 409 },
  )
  const read = await getPersonalArticle(f.DB, "private-note")
  assert.equal(read.raw, original + "私密修改\r\n")
  assert.equal(read.status, "ACTIVE")
})

test("server private-capture helper applies identical raw and optimistic version guards", async () => {
  const f = fixture()
  const captured = await persistPersonalArticle(f.DB, {
    article: article(),
    raw: original,
    version: 0,
    requestId: randomUUID(),
    publicLink: { sha: "source" },
  })
  assert.equal(captured.raw, original)
  await assert.rejects(
    persistPersonalArticle(f.DB, {
      article: article(),
      raw: "older public copy",
      version: 0,
      requestId: randomUUID(),
    }),
    { status: 409 },
  )
  assert.equal((await getPersonalArticle(f.DB, "private-note")).raw, original)
})

test("all private article states use 30-day trash, exact restore and guarded permanent deletion", async () => {
  const f = fixture()
  const saved = await value(await f.save())
  const body = { version: saved.version, requestId: randomUUID() }
  const removed = await value(await f.owner("personal/articles/private-note/delete", body))
  assert.equal(removed.status, "TRASH")
  assert.equal(removed.version, 2)
  assert.equal(removed.raw, original)
  const repeated = await value(await f.owner("personal/articles/private-note/delete", body))
  assert.equal(repeated.version, 2)
  assert.equal((await value(await f.owner("personal/articles"))).total, 0)
  assert.equal((await value(await f.owner("personal/articles?status=TRASH"))).total, 1)
  assert.equal((await f.save("private-note", 2, "cannot edit trash")).status, 409)
  const restored = await value(
    await f.owner("personal/articles/private-note/restore", {
      version: 2,
      requestId: randomUUID(),
    }),
  )
  assert.equal(restored.status, "ACTIVE")
  assert.equal(restored.raw, original)
  assert.deepEqual(restored.article, article())
  assert.equal(
    (await f.owner("personal/articles/private-note/purge", { version: 3, requestId: randomUUID() }))
      .status,
    409,
  )
  await value(
    await f.owner("personal/articles/private-note/delete", { version: 3, requestId: randomUUID() }),
  )
  const purge = { version: 4, requestId: randomUUID() }
  assert.equal(
    (await value(await f.owner("personal/articles/private-note/purge", purge))).purged,
    true,
  )
  assert.equal(
    (await value(await f.owner("personal/articles/private-note/purge", purge))).replayed,
    true,
  )
  assert.equal((await f.owner("personal/articles/private-note")).status, 404)
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM personal_article_versions").get().count,
    0,
  )
})

test("trash expiry rejects restoration and scheduled cleanup removes records and history after 30 days", async () => {
  const f = fixture()
  await value(await f.save())
  await value(
    await f.owner("personal/articles/private-note/delete", { version: 1, requestId: randomUUID() }),
  )
  const cutoff = Date.now() - 30 * 86400000 - 1
  f.sqlite
    .prepare("UPDATE personal_articles SET deleted_at=? WHERE id=?")
    .run(cutoff, "private-note")
  assert.equal(
    (
      await f.owner("personal/articles/private-note/restore", {
        version: 2,
        requestId: randomUUID(),
      })
    ).status,
    409,
  )
  await cleanupPersonalNotes(f.DB)
  assert.equal((await f.owner("personal/articles/private-note")).status, 404)
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM personal_article_versions").get().count,
    0,
  )
})

test("bounded history can restore prior original as a new revision and retains newer conflict guard", async () => {
  const f = fixture()
  await value(await f.save())
  for (let version = 1; version <= 24; version++)
    await value(await f.save("private-note", version, original + `版本${version}\r\n`))
  const history = await value(await f.owner("personal/articles/private-note/versions"))
  assert.equal(history.versions.length, 20)
  assert.equal(history.versions[0].version, 25)
  assert.equal(history.versions.at(-1).version, 6)
  assert.equal(
    (
      await f.owner("personal/articles/private-note/versions/1/restore", {
        version: 25,
        requestId: randomUUID(),
      })
    ).status,
    404,
  )
  const restoreBody = { version: 25, requestId: randomUUID() }
  const restored = await value(
    await f.owner("personal/articles/private-note/versions/6/restore", {
      ...restoreBody,
    }),
  )
  assert.equal(restored.version, 26)
  assert.equal(restored.raw, original + "版本5\r\n")
  const replay = await value(
    await f.owner("personal/articles/private-note/versions/6/restore", restoreBody),
  )
  assert.equal(replay.version, 26)
  assert.equal(replay.replayed, true)
  assert.equal(replay.raw, restored.raw)
  assert.equal(
    (
      await f.owner("personal/articles/private-note/versions/7/restore", {
        version: 25,
        requestId: randomUUID(),
      })
    ).status,
    409,
  )
})

test("owner-only historical preview preserves the old original and does not change the current revision or backup epoch", async () => {
  const f = fixture()
  const publicLink = {
    id: "old-public-note",
    sha: "a".repeat(40),
    baseline: { title: "旧公开标题" },
  }
  await value(await f.save("private-note", 0, original, { title: "历史标题" }, { publicLink }))
  const current = await value(
    await f.save("private-note", 1, "# 更新后的原文\n", { title: "当前标题" }),
  )
  const before = {
    article: f.sqlite.prepare("SELECT * FROM personal_articles").all(),
    versions: f.sqlite.prepare("SELECT * FROM personal_article_versions ORDER BY version").all(),
    epoch: f.sqlite.prepare("SELECT generation FROM backups_epoch WHERE id=1").get(),
  }
  f.queries.length = 0
  const response = await f.owner("personal/articles/private-note/versions/1")
  const preview = await value(response)
  assert.equal(preview.version, 1)
  assert.equal(preview.raw, original)
  assert.equal(digest(preview.raw), digest(original))
  assert.deepEqual(preview.article, article("private-note", { title: "历史标题" }))
  assert.deepEqual(preview.publicLink, publicLink)
  assert.ok(Number.isFinite(Date.parse(preview.savedAt)))
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.deepEqual(Object.keys(preview).sort(), [
    "article",
    "publicLink",
    "raw",
    "savedAt",
    "version",
  ])
  assert.ok(f.queries.every((sql) => /^SELECT\b/i.test(sql)))
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM personal_articles").all(), before.article)
  assert.deepEqual(
    f.sqlite.prepare("SELECT * FROM personal_article_versions ORDER BY version").all(),
    before.versions,
  )
  assert.deepEqual(
    f.sqlite.prepare("SELECT generation FROM backups_epoch WHERE id=1").get(),
    before.epoch,
  )
  assert.equal((await value(await f.owner("personal/articles/private-note"))).raw, current.raw)
  assert.equal(
    (
      await f.owner("personal/articles/private-note/versions/1", undefined, {
        "X-Howard-Sync-Key": f.env.SYNC_SECRET,
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await f.owner("personal/articles/private-note/versions/1", undefined, {
        Origin: "https://untrusted.example",
      })
    ).status,
    403,
  )
})

test("historical preview rejects missing/pruned versions and cannot trigger restore through a GET", async () => {
  const f = fixture()
  await value(await f.save())
  assert.equal((await f.owner("personal/articles/private-note/versions/2")).status, 404)
  assert.equal((await f.owner("personal/articles/missing-note/versions/1")).status, 404)
  assert.equal(
    (await f.owner("personal/articles/private-note/versions/9007199254740992")).status,
    400,
  )
  assert.equal((await f.owner("personal/articles/private-note/versions/1/restore")).status, 405)
  assert.equal(
    (
      await f.owner("personal/articles/private-note/versions/1", {
        version: 1,
        requestId: randomUUID(),
      })
    ).status,
    405,
  )
  f.sqlite
    .prepare("DELETE FROM personal_article_versions WHERE article_id=? AND version=?")
    .run("private-note", 1)
  assert.equal((await f.owner("personal/articles/private-note/versions/1")).status, 404)
  const current = await value(await f.owner("personal/articles/private-note"))
  assert.equal(current.version, 1)
  assert.equal(current.raw, original)
})

test("article history byte budget is based on UTF-8 bytes and retains at least two recent originals", async () => {
  const f = fixture()
  const large = "中文".repeat(200000)
  await value(await f.save("large-note", 0, large))
  for (let version = 1; version < 12; version++)
    await value(await f.save("large-note", version, large + version))
  const result = f.sqlite
    .prepare(
      "SELECT count(*) AS count,sum(length(CAST(raw AS BLOB))+length(CAST(article AS BLOB))) AS bytes FROM personal_article_versions WHERE article_id=?",
    )
    .get("large-note")
  assert(result.count >= 2 && result.count < 12)
  assert(result.bytes <= 8388608)
})

test("durable recovery drafts preserve public baseline and private/memory records across devices", async () => {
  const f = fixture()
  const recovery = {
    id: "private-note",
    raw: original,
    article: article(),
    openedSha: "abc123",
    savedForm: "original-form",
    form: { title: "恢复标题", body: original + "未发布改动" },
    baseline: { sha: "abc123", raw: original },
    kind: "article",
  }
  const body = { record: recovery, version: 0, requestId: randomUUID() }
  const first = await value(await f.owner("personal/drafts/article:private-note", body))
  assert.deepEqual(first.record, recovery)
  const retry = await value(await f.owner("personal/drafts/article:private-note", body))
  assert.equal(retry.replayed, true)
  assert.equal(retry.version, 1)
  assert.deepEqual(retry.record, recovery)
  const read = await value(await f.owner("personal/drafts/article:private-note"))
  assert.deepEqual(read.record.baseline, recovery.baseline)
  assert.deepEqual(read.record.form, recovery.form)
  assert.equal(
    (
      await f.owner("personal/drafts/article:private-note", {
        record: { ...recovery, form: { body: "stale edit" } },
        version: 0,
        requestId: randomUUID(),
      })
    ).status,
    409,
  )
  const memory = {
    memoryId: "memory-123",
    kind: "memory",
    content: original,
    baseline: { version: 7, content: original, visibility: "PRIVATE" },
  }
  await value(
    await f.owner("personal/drafts/memory:memory-123", {
      record: memory,
      version: 0,
      requestId: randomUUID(),
    }),
  )
  const list = await value(await f.owner("personal/drafts?all=1"))
  assert.equal(list.total, 2)
  assert(list.drafts.every((draft) => draft.record === undefined))
  assert.equal(list.drafts.find((draft) => draft.kind === "article").title, "恢复标题")
  assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM personal_articles").get().count, 0)
  assert.equal(
    JSON.parse(f.sqlite.prepare("SELECT response FROM personal_requests LIMIT 1").get().response)
      .record,
    undefined,
  )
})

test("draft history stays bounded and all draft records can be deleted, restored, or purged", async () => {
  const f = fixture()
  for (let version = 0; version < 9; version++)
    await value(
      await f.owner("personal/drafts/new-note", {
        record: { raw: original + version },
        version,
        requestId: randomUUID(),
      }),
    )
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM personal_draft_versions").get().count,
    5,
  )
  const deleted = await value(
    await f.owner("personal/drafts/new-note/delete", { version: 9, requestId: randomUUID() }),
  )
  assert.equal(deleted.status, "TRASH")
  assert.equal((await value(await f.owner("personal/drafts"))).total, 0)
  const restored = await value(
    await f.owner("personal/drafts/new-note/restore", { version: 10, requestId: randomUUID() }),
  )
  assert.equal(restored.status, "ACTIVE")
  assert.equal((await value(await f.owner("personal/drafts/new-note"))).record.raw, original + "8")
  await value(
    await f.owner("personal/drafts/new-note/delete", { version: 11, requestId: randomUUID() }),
  )
  await value(
    await f.owner("personal/drafts/new-note/purge", { version: 12, requestId: randomUUID() }),
  )
  assert.equal((await f.owner("personal/drafts/new-note")).status, 404)
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM personal_draft_versions").get().count,
    0,
  )
})

test("private attachment original bytes live only in R2 and file reads always require owner auth", async () => {
  const f = fixture()
  const bytes = Uint8Array.from([137, 80, 78, 71, 0, 1, 2, 255, 42])
  const registered = await value(await f.upload("private-image", bytes))
  assert.equal(registered.file.complete, false)
  assert.equal(registered.file.storage.private, true)
  assert.equal(registered.file.objectKey, `personal-files/${digest(bytes)}`)
  assert.equal((await f.owner("personal/files/private-image")).status, 404)
  const uploaded = await value(await f.putFile("private-image", bytes))
  assert.equal(uploaded.file.complete, true)
  assert.equal(f.puts, 1)
  const again = await value(await f.putFile("private-image", bytes))
  assert.equal(again.replayed, true)
  assert.equal(f.puts, 1)
  assert.equal((await f.call("personal/files/private-image")).status, 401)
  const read = await f.owner("personal/files/private-image")
  assert.equal(read.status, 200)
  assert.equal(read.headers.get("Content-Type"), "image/png")
  assert.equal(read.headers.get("Cache-Control"), "private, no-store")
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), bytes)
  assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM personal_files").get().count, 1)
  assert.equal(
    f.sqlite
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='personal_file_chunks'")
      .get().count,
    0,
  )
})

test("private attachments reject changed file IDs/content and untrusted active MIME is download-only", async () => {
  const f = fixture()
  const bytes = new TextEncoder().encode("<svg onload='alert(1)'></svg>")
  await value(await f.upload("private-svg", bytes, "测试.svg", "image/svg+xml"))
  assert.equal((await f.putFile("private-svg", Uint8Array.from([0, 1, 2]))).status, 409)
  assert.equal(f.objects.size, 0)
  await value(await f.putFile("private-svg", bytes))
  assert.equal(
    (await f.upload("private-svg", Uint8Array.from([7]), "测试.svg", "image/svg+xml")).status,
    409,
  )
  const read = await f.owner("personal/files/private-svg")
  assert.equal(read.headers.get("Content-Type"), "application/octet-stream")
  assert(read.headers.get("Content-Disposition").startsWith("attachment;"))
  assert.equal(read.headers.get("Content-Security-Policy"), "default-src 'none'; sandbox")
  const row = f.sqlite.prepare("SELECT * FROM personal_files").get()
  assert.equal(row.size, bytes.length)
  assert.equal(row.sha256, digest(bytes))
  assert.equal(
    (
      await f.owner("personal/files", {
        file: {
          id: "large",
          name: "too-large.png",
          mimeType: "image/png",
          size: 21 * 1024 * 1024,
          sha256: "0".repeat(64),
        },
      })
    ).status,
    400,
  )
})

test("private R2 attachment byte-range and HEAD behavior stay authenticated", async () => {
  const f = fixture()
  const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  await value(await f.upload("private-range", bytes))
  await value(await f.putFile("private-range", bytes))
  const read = await f.owner("personal/files/private-range", undefined, { Range: "bytes=2-5" })
  assert.equal(read.status, 206)
  assert.equal(read.headers.get("Content-Range"), "bytes 2-5/10")
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), bytes.slice(2, 6))
  const suffix = await f.owner("personal/files/private-range", undefined, { Range: "bytes=-3" })
  assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), bytes.slice(7))
  const head = await f.owner("personal/files/private-range", undefined, {}, "HEAD")
  assert.equal(head.status, 200)
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal(head.headers.get("Content-Length"), "10")
  assert.equal(
    (await f.owner("personal/files/private-range", undefined, { Range: "bytes=11-12" })).status,
    416,
  )
  assert.equal((await f.call("personal/files/private-range", undefined, {}, "HEAD")).status, 401)
})

test("cleanup retains unreferenced private R2 originals because raw drafts may reference them", async () => {
  const f = fixture()
  const bytes = Uint8Array.from([1, 2, 3])
  await value(await f.upload("private-retained", bytes))
  await value(await f.putFile("private-retained", bytes))
  await cleanupPersonalNotes(f.DB, Date.now() + 100 * 86400000)
  assert.equal(f.objects.size, 1)
  assert.equal((await f.owner("personal/files/private-retained")).status, 200)
})

test("safe export is authenticated, paginated and contains canonical originals without session credentials", async () => {
  const f = fixture()
  for (let index = 0; index < 12; index++) await value(await f.save(`note-${index}`))
  const first = await value(await f.owner("personal/export?type=articles"))
  assert.equal(first.records.length, 10)
  assert.equal(first.total, 12)
  assert.equal(first.nextPage, 2)
  const second = await value(await f.owner("personal/export?type=articles&page=2"))
  assert.equal(second.records.length, 2)
  assert.equal(second.nextPage, null)
  assert.equal(first.records[0].raw, original)
  assert(Number.isSafeInteger(first.generation))
  const serialized = JSON.stringify(first)
  assert(!serialized.includes("test-owner"))
  assert(!serialized.includes("SESSION_SECRET"))
  assert.equal((await f.owner("personal/export?type=personal_requests")).status, 400)
  assert.equal((await f.owner("personal/articles?page=-1")).status, 400)
  assert.equal((await f.owner("personal/export?page=NaN")).status, 400)
})

test("private export pins the complete cross-page/types snapshot epoch and fails on concurrent changes", async () => {
  const f = fixture()
  await value(await f.save())
  const initial = await value(await f.owner("personal/export?type=articles"))
  const versions = await value(
    await f.owner(`personal/export?type=versions&generation=${initial.generation}`),
  )
  assert.equal(versions.generation, initial.generation)
  await value(await f.save("another-note"))
  assert.equal(
    (await f.owner(`personal/export?type=articles&page=2&generation=${initial.generation}`)).status,
    409,
  )
  assert.equal((await f.owner("personal/export?generation=NaN")).status, 400)
  const prepare = f.DB.prepare.bind(f.DB)
  let mutate = true
  f.DB.prepare = (sql) => {
    const statement = prepare(sql)
    const all = statement.all.bind(statement)
    if (/SELECT \* FROM personal_articles ORDER BY/.test(sql))
      statement.all = async () => {
        const result = await all()
        if (mutate) {
          mutate = false
          f.sqlite.prepare("UPDATE personal_articles SET raw=?").run("concurrent edit")
        }
        return result
      }
    return statement
  }
  assert.equal((await f.owner("personal/export?type=articles")).status, 409)
})

test("private export refuses a missing epoch row or missing canonical mutation trigger", async () => {
  const f = fixture()
  f.sqlite.exec("DROP TRIGGER backup_epoch_personal_articles_update")
  assert.equal((await f.owner("personal/export")).status, 503)
  f.sqlite.exec("DELETE FROM backups_epoch")
  assert.equal((await f.owner("personal/export?type=drafts")).status, 503)
})

test("private service does not leak underlying errors, enforce request size and HTTP methods", async () => {
  const f = fixture()
  assert.equal((await f.owner("personal/unknown")).status, 404)
  assert.equal((await f.owner("personal/articles", { value: "x" }, {}, "DELETE")).status, 405)
  const huge = await f.owner("personal/drafts/large", {
    record: { raw: "x".repeat(2000000) },
    version: 0,
    requestId: randomUUID(),
  })
  assert.equal(huge.status, 413)
  const broken = {
    prepare() {
      throw new Error("sensitive SQL/token detail")
    },
  }
  const response = await personalNotesResponse(
    new Request(endpoint + "personal/articles", {
      headers: { Authorization: "Bearer test-owner", Origin: origin },
    }),
    f.env,
    broken,
    "personal/articles",
    f.authorize,
  )
  assert.equal(response.status, 503)
  assert(!(await response.text().then((text) => text.includes("sensitive"))))
})
