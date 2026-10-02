import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { cleanupMemories, memoriesResponse } from "./memories.mjs"
import { sessionResponse } from "./session.mjs"

const origin = "https://notes.example"
const prefix = "/howard-notes/"
const endpoint = origin + prefix + "api/content/"
const sourceOrigin = "http://source.example:5230"
const created = "2024-07-02T09:14:32.123+08:00"
const modified = "2025-08-31T04:55:11.456Z"
const original = "\uFEFF# 科学/笔记\r\n\r\n原文 **保持** 直接保留。 #科学/笔记\r\n"
const card = (sourceId, fields = {}) => ({
  sourceId: String(sourceId),
  content: original,
  created,
  modified,
  visibility: "PUBLIC",
  status: "NORMAL",
  pinned: false,
  tags: ["科学/笔记"],
  attachments: [],
  relations: [],
  raw: { id: sourceId, content: original, creatorId: 1, arbitrary: "source-metadata" },
  source: { id: sourceId, origin: sourceOrigin },
  ...fields,
})
function fixture() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(fs.readFileSync(new URL("memories-schema.sql", import.meta.url), "utf8"))
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
          queries.push({ sql, parameters: values.length })
          return statement.get(...values) || null
        },
        async all() {
          queries.push({ sql, parameters: values.length })
          return { results: statement.all(...values) }
        },
        async run() {
          queries.push({ sql, parameters: values.length })
          return { meta: { changes: statement.run(...values).changes } }
        },
      }
    },
    async batch(statements) {
      sqlite.exec("BEGIN")
      try {
        const results = await Promise.all(statements.map((statement) => statement.run()))
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  }
  const env = {
    DB,
    SITE_PREFIX: prefix,
    SESSION_SECRET: Buffer.alloc(32, 13).toString("base64url"),
    SYNC_SECRET: "test-only-import-secret",
    FALLBACK_ORIGIN: "https://backup.example",
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
  const call = (path = "memories", body = undefined, headers = {}, method) => {
    const request = new Request(endpoint + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return memoriesResponse(request, env, DB, path.split("?")[0], authorize)
  }
  const ownerHeaders = { Authorization: "Bearer test-owner", Origin: origin }
  const owner = (path, body, headers = {}, method) =>
    call(path, body, { ...ownerHeaders, ...headers }, method)
  const importCards = (memories) =>
    owner("memories/import", { sourceOrigin, memories }, { "X-Howard-Sync-Key": env.SYNC_SECRET })
  const fileBytes = Uint8Array.from([0, 1, 2, 120, 255, 128, 65, 66, 67, 9])
  const file = {
    id: "resource-test",
    name: "原始图片.png",
    mimeType: "image/png",
    size: fileBytes.length,
    sha256: createHash("sha256").update(fileBytes).digest("hex"),
    source: { originalId: 7, sourceUrl: sourceOrigin + "/private-resource" },
  }
  const importFile = async (value = file, bytes = fileBytes) => {
    let response
    for (let index = 0; index < 2; index++) {
      response = await owner(
        "memories/import/files",
        {
          file: value,
          chunk: {
            index,
            total: 2,
            data: Buffer.from(bytes.subarray(index * 5, (index + 1) * 5)).toString("base64"),
          },
        },
        { "X-Howard-Sync-Key": env.SYNC_SECRET },
      )
      assert.equal(response.status, 200, await response.clone().text())
    }
    return response
  }
  return {
    sqlite,
    queries,
    DB,
    env,
    call,
    owner,
    importCards,
    importFile,
    file,
    fileBytes,
    authorize,
    get authorizationCalls() {
      return authorizationCalls
    },
  }
}

test("memory import preserves all source bytes, timestamps, visibility and metadata without article tables", async () => {
  const f = fixture()
  const sources = [
    card(1, { pinned: true, relations: [{ memoId: 1, relatedMemoId: 2, type: "REFERENCE" }] }),
    card(2, { visibility: "PRIVATE", tags: ["private-only"] }),
    card(3, { visibility: "PROTECTED", status: "ARCHIVED" }),
  ]
  const response = await f.importCards(sources)
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(result.imported, 3)
  const publicList = await (await f.call()).json()
  assert.equal(publicList.total, 1)
  assert.equal(publicList.owner, false)
  assert.equal(publicList.memories[0].content, original)
  assert.equal(publicList.memories[0].created, created)
  assert.equal(publicList.memories[0].modified, modified)
  assert.equal(publicList.memories[0].pinned, true)
  assert.deepEqual(publicList.memories[0].relations, [])
  assert.equal("raw" in publicList.memories[0], false)
  assert.equal("source" in publicList.memories[0], false)
  const ownerList = await (await f.owner("memories?status=ALL")).json()
  assert.equal(ownerList.total, 3)
  for (const value of ownerList.memories) {
    const source = sources.find((item) => item.sourceId === String(value.raw.id))
    assert.equal(value.content, source.content)
    assert.equal(value.visibility, source.visibility)
    assert.equal(value.status, source.status)
    assert.deepEqual(value.raw, source.raw)
    assert.deepEqual(value.relations, source.relations)
  }
  assert.equal(
    f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'public_documents'").get(),
    undefined,
  )
})
test("imports are authorized with the automation key plus owner bearer and are idempotent", async () => {
  const f = fixture()
  const body = { sourceOrigin, memories: [card(1)] }
  assert.equal((await f.call("memories/import", body)).status, 403)
  assert.equal((await f.owner("memories/import", body)).status, 403)
  assert.equal(
    (await f.call("memories/import", body, { "X-Howard-Sync-Key": f.env.SYNC_SECRET })).status,
    403,
  )
  assert.equal(
    (await f.owner("memories/import", body, { "X-Howard-Sync-Key": "wrong" })).status,
    403,
  )
  const first = await (await f.importCards(body.memories)).json()
  const again = await (await f.importCards(body.memories)).json()
  assert.equal(first.ids[0].id, again.ids[0].id)
  assert.equal(again.imported, 0)
  assert.equal(again.unchanged, 1)
  const id = first.ids[0].id
  await f.owner("memories/" + id, { content: "owner updated #edited", version: 1 })
  const afterEdit = await (await f.importCards(body.memories)).json()
  assert.equal(afterEdit.unchanged, 1)
  assert.equal(
    (await (await f.owner("memories/" + id)).json()).memory.content,
    "owner updated #edited",
  )
})
test("visitors cannot discover private, protected, archived or trashed cards through list, search, tags or direct IDs", async () => {
  const f = fixture()
  const result = await (
    await f.importCards([
      card(1, { content: "public", tags: ["public"] }),
      card(2, { visibility: "PRIVATE", content: "secret", tags: ["secret"] }),
      card(3, { visibility: "PROTECTED", content: "secret", tags: ["secret"] }),
      card(4, { status: "ARCHIVED", content: "secret", tags: ["secret"] }),
      card(5, { status: "TRASH", content: "secret", tags: ["secret"] }),
    ])
  ).json()
  for (const query of ["?q=secret", "?tag=secret", "?status=ALL&q=secret", "?status=TRASH"]) {
    const data = await (await f.call("memories" + query)).json()
    assert.equal(data.total, query === "?status=TRASH" ? 1 : 0)
    assert.equal(JSON.stringify(data).includes('"secret"'), false)
  }
  assert.deepEqual((await (await f.call("memories/tags")).json()).tags, [
    { name: "public", count: 1 },
  ])
  for (const item of result.ids.slice(1))
    assert.equal((await f.call("memories/" + item.id)).status, 404)
})
test("memory browsing keeps 20 cards per page, full timeline, literal search, independent tags and ordering", async () => {
  const f = fixture()
  await f.importCards(
    Array.from({ length: 45 }, (_, i) =>
      card(i + 1, {
        content: i === 3 ? "only 10%_match" : "entry " + i,
        created: new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
        tags: [i < 22 ? "first" : "second"],
      }),
    ),
  )
  const page = await (await f.call("memories?page=2&sort=created-asc")).json()
  assert.equal(page.memories.length, 20)
  assert.equal(page.total, 45)
  assert.equal(page.memories[0].content, "entry 20")
  assert.equal((await (await f.call("memories?page=3")).json()).memories.length, 5)
  assert.equal((await (await f.call("memories?view=timeline")).json()).memories.length, 45)
  assert.equal(
    (await (await f.call("memories?q=" + encodeURIComponent("10%_match"))).json()).total,
    1,
  )
  assert.equal((await (await f.call("memories?tag=first")).json()).total, 22)
  assert.deepEqual((await (await f.call("memories/tags")).json()).tags, [
    { name: "second", count: 23 },
    { name: "first", count: 22 },
  ])
  assert.equal((await f.call("memories?sort=created%3BDROP+TABLE")).status, 400)
})
test("existing encrypted HttpOnly login enables memory creation and editing without exposing the token", async () => {
  const f = fixture()
  const session = await sessionResponse(
    new Request(endpoint + "session", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-owner",
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serverTime: 100, expiresAt: 3_600_100 }),
    }),
    f.env,
    f.authorize,
  )
  const cookie = session.headers.get("Set-Cookie").split(";")[0]
  const createdResponse = await f.call(
    "memories",
    { content: "记忆 #中文 与 #nested/topic" },
    { Cookie: cookie },
  )
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text())
  const createdCard = (await createdResponse.json()).memory
  assert.equal(createdCard.visibility, "PRIVATE")
  assert.deepEqual(createdCard.tags, ["中文", "nested/topic"])
  const edit = await f.call(
    "memories/" + createdCard.id,
    { content: "修改 #新的", version: 1 },
    { Cookie: cookie },
  )
  assert.equal(edit.status, 200)
  assert.equal((await edit.json()).memory.version, 2)
  const owner = await f.call("memories", undefined, { Cookie: cookie })
  assert.equal((await owner.clone().json()).owner, true)
  assert.equal((await owner.text()).includes("test-owner"), false)
  assert.equal((await f.call()).status, 200)
  assert.equal((await (await f.call()).json()).total, 0)
  assert.equal((await f.call("memories", { content: "no auth" })).status, 401)
})
test("cross-site cookies, unrelated owners, expiry and automation misuse cannot write or expose memories", async () => {
  const f = fixture()
  await f.importCards([card(1, { visibility: "PRIVATE" })])
  const expired = await f.call("memories", undefined, { Cookie: "howard_session=invalid" })
  assert.equal(expired.status, 200)
  assert.equal((await expired.json()).total, 0)
  assert.match(expired.headers.get("Set-Cookie"), /Max-Age=0/)
  assert.equal(
    (
      await f.owner("memories", undefined, {
        "Sec-Fetch-Site": "cross-site",
        Origin: "https://evil.example",
      })
    ).status,
    403,
  )
  assert.equal(
    (await f.call("memories", undefined, { Authorization: "Bearer other-user" })).status,
    403,
  )
  assert.equal(
    (
      await f.owner(
        "memories",
        { content: "automation misuse" },
        { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
      )
    ).status,
    403,
  )
  assert.equal((await f.owner("memories", undefined, {}, "DELETE")).status, 405)
})
test("edits detect stale versions and deletions retain cards for 30 days with exact source content restoration", async () => {
  const f = fixture()
  const imported = await (await f.importCards([card(1, { visibility: "PRIVATE" })])).json()
  const id = imported.ids[0].id
  assert.equal((await f.owner("memories/" + id, { content: "stale", version: 7 })).status, 409)
  const deleted = await (await f.owner(`memories/${id}/delete`, { version: 1 })).json()
  assert.equal(deleted.memory.status, "TRASH")
  assert.equal(
    Date.parse(deleted.memory.expiresAt) - Date.parse(deleted.memory.deletedAt),
    30 * 86_400_000,
  )
  assert.equal((await (await f.owner("memories?status=TRASH")).json()).total, 1)
  assert.equal((await (await f.owner("memories?status=ALL")).json()).total, 0)
  const restore = await f.owner(`memories/${id}/restore`, { version: 2 })
  assert.equal(restore.status, 200)
  const restored = (await restore.json()).memory
  assert.equal(restored.content, original)
  assert.equal(restored.created, created)
  assert.equal(restored.status, "NORMAL")
  assert.equal(restored.visibility, "PRIVATE")
  await f.owner(`memories/${id}/delete`, { version: 3 })
  const deletedAt = f.sqlite
    .prepare("SELECT deleted_at FROM memory_cards WHERE id=?")
    .get(id).deleted_at
  await cleanupMemories(f.DB, deletedAt + 30 * 86_400_000 - 1)
  assert.equal((await f.owner("memories/" + id)).status, 200)
  await cleanupMemories(f.DB, deletedAt + 30 * 86_400_000)
  assert.equal((await f.owner("memories/" + id)).status, 404)
})
test("attachment chunks preserve exact binary bytes and remain owner-only unless referenced by a public normal memory", async () => {
  const f = fixture()
  const complete = await f.importFile()
  assert.equal((await complete.json()).complete, true)
  assert.equal((await f.call("memories/files/resource-test")).status, 404)
  const imported = await (
    await f.importCards([
      card(1, {
        visibility: "PRIVATE",
        attachments: [
          {
            id: 7,
            fileId: f.file.id,
            name: f.file.name,
            mimeType: f.file.mimeType,
            size: f.file.size,
            sourceUrl: "private source",
            url: "private source",
          },
        ],
      }),
    ])
  ).json()
  assert.equal((await f.call("memories/files/resource-test")).status, 404)
  const privateFile = await f.owner("memories/files/resource-test")
  assert.equal(privateFile.status, 200)
  assert.deepEqual(new Uint8Array(await privateFile.arrayBuffer()), f.fileBytes)
  assert.equal(privateFile.headers.get("Cache-Control"), "private, no-store")
  const id = imported.ids[0].id
  await f.owner("memories/" + id, { visibility: "PUBLIC", version: 1 })
  const publicFile = await f.call("memories/files/resource-test")
  assert.equal(publicFile.status, 200)
  assert.deepEqual(new Uint8Array(await publicFile.arrayBuffer()), f.fileBytes)
  const memory = (await (await f.call("memories/" + id)).json()).memory
  assert.equal(memory.attachments[0].url, prefix + "api/content/memories/files/resource-test")
  assert.equal("sourceUrl" in memory.attachments[0], false)
  assert.equal(memory.attachments[0].sourcePath?.includes("source.example"), false)
  await f.owner(`memories/${id}/delete`, { version: 2 })
  assert.equal((await f.call("memories/files/resource-test")).status, 404)
  const head = await f.owner("memories/files/resource-test", undefined, {}, "HEAD")
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
})
test("attachment import detects corruption and active content is served as a sandboxed download", async () => {
  const f = fixture()
  const bad = await f.owner(
    "memories/import/files",
    {
      file: f.file,
      chunk: { index: 0, total: 1, data: Buffer.alloc(f.file.size, 3).toString("base64") },
    },
    { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
  )
  assert.equal(bad.status, 400)
  assert.equal((await f.call("memories/files/resource-test")).status, 404)
  const activeFile = { ...f.file, id: "resource-active", mimeType: "text/html", name: 'x"<.html' }
  await f.importFile(activeFile)
  await f.importCards([card(1, { attachments: [{ fileId: activeFile.id }] })])
  const response = await f.call("memories/files/resource-active")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream")
  assert.match(response.headers.get("Content-Disposition"), /^attachment;/)
  assert.match(response.headers.get("Content-Security-Policy"), /sandbox/)
})
test("a raced update cannot replace attachment references after the version check fails", async () => {
  const f = fixture()
  const imported = await (
    await f.importCards([card(1, { attachments: [{ fileId: "original-file" }] })])
  ).json()
  const id = imported.ids[0].id
  const batch = f.DB.batch
  f.DB.batch = async (statements) => {
    f.DB.batch = batch
    const row = f.sqlite.prepare("SELECT body FROM memory_cards WHERE id=?").get(id)
    const newer = JSON.parse(row.body)
    newer.attachments = [{ fileId: "concurrent-file" }]
    f.sqlite
      .prepare("UPDATE memory_cards SET body=?,version=2 WHERE id=?")
      .run(JSON.stringify(newer), id)
    f.sqlite.prepare("DELETE FROM memory_attachments WHERE memory_id=?").run(id)
    f.sqlite
      .prepare("INSERT INTO memory_attachments(memory_id,file_id) VALUES(?,?)")
      .run(id, "concurrent-file")
    return batch(statements)
  }
  const response = await f.owner("memories/" + id, {
    version: 1,
    content: "stale writer",
    attachments: [{ fileId: "stale-file" }],
  })
  assert.equal(response.status, 409)
  assert.equal(
    f.sqlite.prepare("SELECT file_id FROM memory_attachments WHERE memory_id=?").get(id).file_id,
    "concurrent-file",
  )
})

test("public resource matching exposes only a pathname, never host, query credentials or arbitrary source metadata", async () => {
  const f = fixture()
  await f.importCards([
    card(1, {
      attachments: [
        {
          fileId: "resource-test",
          name: "same-name.png",
          sourceUrl:
            "http://private-source.example:5230/file/7/same-name.png?token=do-not-expose#private",
          arbitrary: { secret: "never expose" },
        },
      ],
    }),
  ])
  const response = await f.call()
  const text = await response.clone().text()
  const attachment = (await response.json()).memories[0].attachments[0]
  assert.equal(attachment.sourcePath, "/file/7/same-name.png")
  for (const secret of [
    "private-source.example",
    "do-not-expose",
    "never expose",
    "sourceUrl",
    "arbitrary",
  ])
    assert.equal(text.includes(secret), false)
})

test("visibility and pin edits preserve independently assigned tags and source metadata", async () => {
  const f = fixture()
  const imported = await (await f.importCards([card(1, { tags: ["manual-tag"] })])).json()
  const id = imported.ids[0].id
  const response = await f.owner("memories/" + id, {
    visibility: "PRIVATE",
    pinned: true,
    version: 1,
  })
  const memory = (await response.json()).memory
  assert.deepEqual(memory.tags, ["manual-tag"])
  assert.equal(memory.pinned, true)
  assert.equal(memory.content, original)
  assert.equal(memory.raw.content, original)
})

test("cross-site image loads without credentials can read public files but cannot read private files or use a session", async () => {
  const f = fixture()
  await f.importFile()
  const imported = await (
    await f.importCards([card(1, { visibility: "PRIVATE", attachments: [{ fileId: f.file.id }] })])
  ).json()
  const anonymous = { "Sec-Fetch-Site": "cross-site" }
  assert.equal((await f.call("memories/files/resource-test", undefined, anonymous)).status, 404)
  assert.equal((await (await f.call("memories", undefined, anonymous)).json()).total, 0)
  await f.owner("memories/" + imported.ids[0].id, { visibility: "PUBLIC", version: 1 })
  const publicFile = await f.call("memories/files/resource-test", undefined, anonymous)
  assert.equal(publicFile.status, 200)
  assert.deepEqual(new Uint8Array(await publicFile.arrayBuffer()), f.fileBytes)
  assert.equal(
    (
      await f.call("memories/files/resource-test", undefined, {
        ...anonymous,
        Cookie: "howard_session=invalid",
      })
    ).status,
    403,
  )
  assert.equal((await f.call("memories", { content: "cross-site write" }, anonymous)).status, 403)
})

test("retrying a creation request reuses its ID, preserves later edits and rejects key reuse for different content", async () => {
  const f = fixture()
  const body = {
    requestId: "429d7f47-6a6e-4d0e-8314-5b086cbe627c",
    content: "first submission #retry",
    visibility: "PRIVATE",
  }
  const first = await f.owner("memories", body)
  assert.equal(first.status, 201)
  const original = (await first.json()).memory
  const second = await f.owner("memories", body)
  assert.equal(second.status, 200)
  const replay = await second.json()
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.memory, original)
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM memory_cards").get().n, 1)
  await f.owner("memories/" + original.id, { content: "newer edit", version: 1 })
  const afterEdit = await (await f.owner("memories", body)).json()
  assert.equal(afterEdit.memory.content, "newer edit")
  assert.equal(afterEdit.memory.version, 2)
  assert.equal((await f.owner("memories", { ...body, content: "unrelated new post" })).status, 409)
  assert.equal((await f.owner("memories", { ...body, requestId: "../../unsafe" })).status, 400)
  assert.equal((await f.owner("memories", { ...body, requestId: [body.requestId] })).status, 400)
})

test("a repeated delete with its initial version remains idempotent after a lost response", async () => {
  const f = fixture()
  const createdCard = (await (await f.owner("memories", { content: "delete once" })).json()).memory
  const path = `memories/${createdCard.id}/delete`
  const first = await f.owner(path, { version: 1 })
  const deleted = (await first.json()).memory
  const repeated = await f.owner(path, { version: 1 })
  assert.equal(repeated.status, 200)
  const replay = await repeated.json()
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.memory, deleted)
})

test("100-card imports and large attachment lists stay under D1 query and binding limits", async () => {
  const f = fixture()
  const memories = Array.from({ length: 100 }, (_, i) =>
    card(i + 1, { attachments: [{ fileId: `file-${i}-a` }, { fileId: `file-${i}-b` }] }),
  )
  const result = await f.importCards(memories)
  assert.equal(result.status, 200, await result.clone().text())
  assert.equal((await result.json()).imported, 100)
  assert.equal(f.queries.length, 4)
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM memory_attachments").get().n, 200)
  assert.ok(f.queries.every(({ parameters }) => parameters <= 100))
  f.queries.length = 0
  assert.equal((await (await f.importCards(memories)).json()).unchanged, 100)
  assert.equal(f.queries.length, 1)
  f.queries.length = 0
  const manyFiles = Array.from({ length: 1000 }, (_, i) => ({ fileId: `many-${i}` }))
  const created = await f.owner("memories", { content: "many resources", attachments: manyFiles })
  assert.equal(created.status, 201, await created.clone().text())
  assert.equal(f.queries.length, 5)
  assert.ok(f.queries.every(({ parameters }) => parameters <= 100))
})

test("Chinese literal searches longer than D1's 50-byte LIKE limit remain usable", async () => {
  const f = fixture()
  const phrase = "这是一段超过五十字节的中文搜索内容，应该完整匹配百分号%和下划线_"
  assert.ok(Buffer.byteLength(phrase) > 50)
  await f.importCards([
    card(1, { content: "前缀 " + phrase + " 后缀", tags: ["长标签：" + phrase] }),
    card(2, { visibility: "PRIVATE", content: phrase }),
  ])
  const result = await f.call("memories?q=" + encodeURIComponent(phrase))
  assert.equal(result.status, 200)
  assert.equal((await result.json()).total, 1)
  assert.ok(f.queries.every(({ sql }) => !/\bLIKE\b|\bGLOB\b/i.test(sql)))
})

test("native and fallback chunk decoders reject malformed and noncanonical base64 before D1 writes", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(Uint8Array, "fromBase64")
  const native = Uint8Array.fromBase64
  const malformed = [
    "-w==",
    "_w==",
    "AA$=",
    "AAAA!!!!", // alphabet and URL-safe alphabet
    "Zg==\r\n  ",
    " Zg==   ",
    "    ",
    "Zm9v\t\n\r ", // ignored whitespace
    "Zg",
    "Zg=",
    "Zg===",
    "Z=g=",
    "Zg==AAAA",
    "A===",
    "====", // padding
    "Zh==",
    "Zm9=", // nonzero overflow bits encode the same bytes loosely
  ]
  for (const mode of ["native", "fallback"])
    await t.test(mode, { skip: mode === "native" && typeof native !== "function" }, async () => {
      let strictCalls = 0
      Object.defineProperty(Uint8Array, "fromBase64", {
        configurable: true,
        value:
          mode === "native"
            ? function (value, options) {
                if (options) {
                  assert.deepEqual(options, { lastChunkHandling: "strict" })
                  strictCalls++
                }
                return native.call(Uint8Array, value, options)
              }
            : undefined,
      })
      try {
        const f = fixture()
        for (const data of [...malformed, null, 17]) {
          f.queries.length = 0
          const response = await f.owner(
            "memories/import/files",
            {
              file: f.file,
              chunk: { index: 0, total: 1, data },
            },
            { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
          )
          assert.equal(response.status, 400)
          assert.equal(f.queries.length, 0)
        }
        for (const [index, data] of [
          "",
          "Zg==",
          "Zm8=",
          "Zm9v",
          "AAECAwQF",
          Buffer.alloc(600 * 1024, 197).toString("base64"),
        ].entries()) {
          const bytes = Buffer.from(data, "base64")
          const file = {
            ...f.file,
            id: `${mode}-canonical-${index}`,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          }
          const before = strictCalls
          const response = await f.owner(
            "memories/import/files",
            {
              file,
              chunk: { index: 0, total: 1, data },
            },
            { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
          )
          assert.equal(response.status, 200, await response.clone().text())
          assert.equal((await response.json()).complete, true)
          if (mode === "native") assert.equal(strictCalls - before, 1)
        }
        f.queries.length = 0
        const before = strictCalls
        const overLimit = await f.owner(
          "memories/import/files",
          {
            file: f.file,
            chunk: { index: 0, total: 1, data: Buffer.alloc(600 * 1024 + 1).toString("base64") },
          },
          { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
        )
        assert.equal(overLimit.status, 413)
        assert.equal(f.queries.length, 0)
        assert.equal(strictCalls, before)
        const oversizedFile = await f.owner(
          "memories/import/files",
          {
            file: { ...f.file, size: 100 * 1024 * 1024 + 1 },
            chunk: { index: 0, total: 1, data: "Zg==" },
          },
          { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
        )
        assert.equal(oversizedFile.status, 400)
        assert.equal(f.queries.length, 0)
      } finally {
        if (descriptor) Object.defineProperty(Uint8Array, "fromBase64", descriptor)
        else delete Uint8Array.fromBase64
      }
    })
})

test("multi-megabyte attachment checksums and reads fetch one encoded chunk per D1 page", async () => {
  const f = fixture()
  const chunkSize = 600 * 1024
  const bytes = Buffer.alloc(chunkSize * 6 + 42, 197)
  const file = {
    ...f.file,
    id: "medium-pages",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  f.sqlite
    .prepare(
      "INSERT INTO memory_files(id,name,mime_type,size,sha256,total_chunks,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(file.id, file.name, file.mimeType, file.size, file.sha256, 7, Date.now())
  const insert = f.sqlite.prepare(
    "INSERT INTO memory_file_chunks(file_id,chunk_index,size,data) VALUES(?,?,?,?)",
  )
  for (let index = 0; index < 6; index++)
    insert.run(
      file.id,
      index,
      chunkSize,
      bytes.subarray(index * chunkSize, (index + 1) * chunkSize).toString("base64"),
    )
  const pages = []
  const prepare = f.DB.prepare.bind(f.DB)
  f.DB.prepare = (sql) => {
    const statement = prepare(sql),
      all = statement.all.bind(statement)
    statement.all = async () => {
      const result = await all()
      if (/SELECT chunk_index,size,data/.test(sql))
        pages.push(result.results.map((row) => row.data.length))
      return result
    }
    return statement
  }
  const complete = await f.owner(
    "memories/import/files",
    {
      file,
      chunk: { index: 6, total: 7, data: bytes.subarray(chunkSize * 6).toString("base64") },
    },
    { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
  )
  assert.equal(complete.status, 200, await complete.clone().text())
  assert.equal((await complete.json()).complete, true)
  assert.ok(f.queries.length <= 50)
  assert.equal(pages.length, 7)
  assert.ok(pages.every((page) => page.length === 1 && page[0] <= 819200))
  await f.importCards([card(1, { attachments: [{ fileId: file.id }] })])
  f.queries.length = 0
  pages.length = 0
  const full = await f.call("memories/files/" + file.id)
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)
  assert.ok(f.queries.length <= 50)
  assert.equal(pages.length, 7)
  assert.ok(pages.every((page) => page.length === 1))
  const first = chunkSize - 10,
    last = chunkSize + 16
  const range = await f.call("memories/files/" + file.id, undefined, {
    Range: `bytes=${first}-${last}`,
  })
  assert.equal(range.status, 206)
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(first, last + 1))
  f.queries.length = 0
  const head = await f.call("memories/files/" + file.id, undefined, {}, "HEAD")
  assert.equal(head.status, 200)
  assert.equal(head.headers.get("Content-Length"), String(bytes.length))
  assert.equal(await head.text(), "")
  assert.equal(f.queries.length, 1)
})

test("1,000-chunk attachments use bounded D1 reads, native streaming SHA validation and range responses", async () => {
  const f = fixture()
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256)
  const file = {
    id: "many-chunks",
    name: "binary.dat",
    mimeType: "application/octet-stream",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  f.sqlite
    .prepare(
      "INSERT INTO memory_files(id,name,mime_type,size,sha256,total_chunks,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(file.id, file.name, file.mimeType, file.size, file.sha256, 1000, Date.now())
  const insert = f.sqlite.prepare(
    "INSERT INTO memory_file_chunks(file_id,chunk_index,size,data) VALUES(?,?,?,?)",
  )
  for (let index = 0; index < 999; index++)
    insert.run(file.id, index, 1, Buffer.from(bytes.subarray(index, index + 1)).toString("base64"))
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "DigestStream")
  let writes = 0
  Object.defineProperty(crypto, "DigestStream", {
    configurable: true,
    value: class extends WritableStream {
      constructor(algorithm) {
        assert.equal(algorithm, "SHA-256")
        const hash = createHash("sha256")
        let resolve, reject
        const digest = new Promise((res, rej) => {
          resolve = res
          reject = rej
        })
        super({
          write(value) {
            writes++
            hash.update(value)
          },
          close() {
            const value = hash.digest()
            resolve(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
          },
          abort(reason) {
            reject(reason)
          },
        })
        this.digest = digest
      }
    },
  })
  try {
    const complete = await f.owner(
      "memories/import/files",
      {
        file,
        chunk: {
          index: 999,
          total: 1000,
          data: Buffer.from(bytes.subarray(999)).toString("base64"),
        },
      },
      { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
    )
    assert.equal(complete.status, 200, await complete.clone().text())
    assert.equal((await complete.json()).complete, true)
    assert.equal(writes, 1000)
    assert.equal(f.queries.length, 45)
  } finally {
    if (descriptor) Object.defineProperty(crypto, "DigestStream", descriptor)
    else delete crypto.DigestStream
  }
  await f.importCards([card(1, { attachments: [{ fileId: file.id }] })])
  f.queries.length = 0
  const full = await f.call("memories/files/" + file.id)
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes)
  assert.equal(f.queries.length, 41)
  f.queries.length = 0
  const ranged = await f.call("memories/files/" + file.id, undefined, { Range: "bytes=550-599" })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get("Content-Range"), "bytes 550-599/1000")
  assert.equal(ranged.headers.get("Content-Length"), "50")
  assert.deepEqual(new Uint8Array(await ranged.arrayBuffer()), bytes.subarray(550, 600))
  assert.equal(f.queries.length, 4)
  const tail = await f.call("memories/files/" + file.id, undefined, { Range: "bytes=-3" })
  assert.equal(tail.status, 206)
  assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), bytes.subarray(997))
  assert.equal(
    (await f.call("memories/files/" + file.id, undefined, { Range: "bytes=1000-" })).status,
    416,
  )
  assert.equal(
    (await f.call("memories/files/" + file.id, undefined, { Range: "bytes=0-2,4-8" })).status,
    416,
  )
  assert.equal(
    (await f.call("memories/files/" + file.id, undefined, { Range: "bytes=-" })).status,
    416,
  )
})

test("a public cross-card reference cannot publish a file belonging to a private source memory", async () => {
  const f = fixture()
  await f.importFile({
    ...f.file,
    source: { origin: sourceOrigin, id: "resources/7", memo: "memos/1" },
  })
  const imported = await (
    await f.importCards([
      card("memos/1", { visibility: "PRIVATE", attachments: [{ fileId: f.file.id }] }),
      card("memos/2", { visibility: "PUBLIC", attachments: [{ fileId: f.file.id }] }),
    ])
  ).json()
  const id = imported.ids[0].id
  const filePath = "memories/files/" + f.file.id
  f.queries.length = 0
  assert.equal((await f.call(filePath)).status, 404)
  assert.equal(f.queries.length, 1, "visibility checks stay in the existing file SELECT")
  assert.deepEqual(new Uint8Array(await (await f.owner(filePath)).arrayBuffer()), f.fileBytes)
  let version = 1
  const edit = async (fields, expected) => {
    const saved = await f.owner("memories/" + id, { ...fields, version: version++ })
    assert.equal(saved.status, 200)
    assert.equal((await f.call(filePath)).status, expected)
  }
  await edit({ visibility: "PUBLIC" }, 200)
  await edit({ visibility: "PROTECTED" }, 404)
  await edit({ visibility: "PRIVATE" }, 404)
  await edit({ visibility: "PUBLIC", status: "ARCHIVED" }, 404)
  await edit({ status: "NORMAL" }, 200)
  assert.equal((await f.owner(`memories/${id}/delete`, { version: version++ })).status, 200)
  assert.equal((await f.call(filePath)).status, 404)
  assert.equal((await f.owner(filePath)).status, 200)
  assert.equal((await f.owner(`memories/${id}/restore`, { version: version++ })).status, 200)
  assert.equal((await f.call(filePath)).status, 200)
})

test("missing or mismatched source owners fail closed and retried completed files retain upgraded provenance", async () => {
  const f = fixture()
  const filePath = "memories/files/" + f.file.id
  await f.importFile({ ...f.file, source: { origin: sourceOrigin, id: "resources/7" } })
  await f.importCards([card("memos/2", { attachments: [{ fileId: f.file.id }] })])
  assert.equal(
    (await f.call(filePath)).status,
    200,
    "files without a source owner retain ordinary public-reference behavior",
  )
  const protectedFile = {
    ...f.file,
    source: { origin: sourceOrigin, id: "resources/7", memo: "memos/1" },
  }
  await f.importFile(protectedFile)
  assert.equal(
    (await f.call(filePath)).status,
    404,
    "an owner not imported into the target cannot be inferred public",
  )
  assert.equal((await f.owner(filePath)).status, 200)
  await f.importCards([card("memos/1", { visibility: "PUBLIC" })])
  assert.equal((await f.call(filePath)).status, 200)
  await f.importFile({
    ...protectedFile,
    source: { ...protectedFile.source, origin: "https://different-source.example" },
  })
  assert.equal((await f.call(filePath)).status, 404, "source IDs are scoped to their source origin")
  await f.importFile({ ...f.file, source: { id: "resources/7" } })
  assert.equal(
    (await f.call(filePath)).status,
    404,
    "an older importer cannot erase a known source ownership guard",
  )
  const metadata = JSON.parse(
    f.sqlite.prepare("SELECT metadata FROM memory_files WHERE id=?").get(f.file.id).metadata,
  )
  assert.equal(metadata.memo, "memos/1")
  assert.equal(metadata.origin, "https://different-source.example")
})

test("migrated attachments redirect without chunk reads and preserve private authorization", async () => {
  const f = fixture()
  await f.importFile()
  await f.importCards([card(1, { visibility: "PRIVATE", attachments: [{ fileId: f.file.id }] })])
  const storage = {
    provider: "github",
    repository: "owner/repo",
    commit: "b".repeat(40),
    sha256: f.file.sha256,
    path: `img/memory/${f.file.sha256}.png`,
    size: f.file.size,
  }
  f.sqlite
    .prepare("UPDATE memory_files SET metadata=json_set(metadata,'$.storage',json(?))")
    .run(JSON.stringify(storage))
  const path = "memories/files/" + f.file.id
  assert.equal((await f.call(path)).status, 404)
  for (const method of ["GET", "HEAD"]) {
    f.queries.length = 0
    const response = await f.owner(path, undefined, {}, method)
    assert.equal(response.status, 302)
    assert.equal(
      response.headers.get("Location"),
      `https://raw.githubusercontent.com/owner/repo/${storage.commit}/${storage.path}`,
    )
    assert.equal(
      f.queries.some((q) => q.sql.includes("FROM memory_file_chunks")),
      false,
    )
  }
  f.sqlite
    .prepare("UPDATE memory_files SET metadata=json_set(metadata,'$.storage.commit','main')")
    .run()
  assert.equal((await f.owner(path)).status, 200)
})
