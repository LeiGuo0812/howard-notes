import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import {
  exportMemos,
  readMemosExport,
  importMemosExport,
  FILE_CHUNK_BYTES,
} from "./import-memos.mjs"

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
const origin = "http://memos.example"
const username = "Howard",
  password = "test-only-password",
  cookie = "test-only-cookie"
const user = { name: "users/7", username, role: "HOST" }
const rawContent = "\uFEFF原文  \r\n#原始标签\r\n`code` 与 [链接](https://example.com)\r\n"
const memo = (id, status = "NORMAL") => ({
  name: `memos/${id}`,
  uid: `uid-${id}`,
  creator: user.name,
  rowStatus: status,
  content: id === 1 ? rawContent : `记忆卡 ${id} #独立标签`,
  createTime: "2023-01-02T03:04:05Z",
  updateTime: "2026-01-02T03:04:05.123Z",
  displayTime: "2024-06-01T00:00:00Z",
  visibility: id === 1 ? "PRIVATE" : id === 2 ? "PROTECTED" : "PUBLIC",
  property: { tags: id === 1 ? ["原始标签"] : ["独立标签"] },
  pinned: id === 1,
  ...(id === 3 || id === 4
    ? {
        parent: "memos/1",
        relations: [{ memo: `memos/${id}`, relatedMemo: "memos/1", type: "COMMENT" }],
      }
    : {}),
})
function sourceMock({
  count = 143,
  repeatToken = false,
  changedSecondPass = false,
  rejectLogin = false,
} = {}) {
  const normal = Array.from({ length: count }, (_, i) => memo(i + 1)),
    archived = [memo(501, "ARCHIVED"), memo(502, "ARCHIVED"), memo(503, "ARCHIVED")]
  const bytes = new Map([
    ["resources/1", Buffer.alloc(FILE_CHUNK_BYTES + 19, 173)],
    ["resources/2", Buffer.from([0, 255, 47, 92, 0, 13, 10])],
    ["resources/3", Buffer.from("孤儿附件原始内容")],
  ])
  const resources = [...bytes].map(([name, file], i) => ({
    name,
    uid: `r-${i + 1}`,
    filename: `资源 ${i + 1}.bin`,
    size: String(file.length),
    type: "application/octet-stream",
    createTime: "2020-01-01T00:00:00Z",
    ...(i === 2 ? {} : { memo: i === 0 ? "memos/1" : "memos/501" }),
    ...(i === 1 ? { externalLink: "https://storage.example/private-signed-file" } : {}),
  }))
  const requests = [],
    passes = { NORMAL: 0, ARCHIVED: 0 }
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input),
      headers = new Headers(options.headers)
    requests.push({ url, method: options.method || "GET", headers, body: options.body })
    if (url.pathname === "/api/v1/auth/signin") {
      assert.equal(JSON.parse(options.body).password, password)
      if (rejectLogin) return Response.json({ message: "never print " + password }, { status: 400 })
      return Response.json(user, {
        headers: { "Set-Cookie": `memos.access-token=${cookie}; HttpOnly; Path=/` },
      })
    }
    if (url.origin !== origin) {
      assert.equal(headers.get("Cookie"), null, "source cookie leaked to external file host")
      if (url.hostname === "storage.example")
        return new Response(null, {
          status: 302,
          headers: { Location: "https://cdn.example/full-file" },
        })
      if (url.hostname === "cdn.example") return new Response(bytes.get("resources/2"))
      throw Error("unexpected external request")
    }
    assert.equal(headers.get("Cookie"), `memos.access-token=${cookie}`)
    if (url.pathname === "/api/v1/auth/status") return Response.json(user)
    if (url.pathname === "/api/v1/workspace/profile")
      return Response.json({ version: "0.22.5", owner: user.name })
    if (url.pathname === "/api/v1/memos") {
      const filter = url.searchParams.get("filter")
      assert.match(filter, /creator == "users\/7"/)
      assert.match(filter, /include_comments == true/)
      const status = filter.includes('row_status == "ARCHIVED"') ? "ARCHIVED" : "NORMAL"
      const pageSize = Number(url.searchParams.get("pageSize")),
        token = url.searchParams.get("pageToken"),
        offset = repeatToken && token ? 0 : Number(token || 0)
      if (!token) passes[status]++
      const source = status === "NORMAL" ? normal : archived
      const page = structuredClone(source.slice(offset, offset + pageSize))
      if (changedSecondPass && status === "NORMAL" && passes.NORMAL > 1 && !token)
        page[0].content += "来源发生变化"
      return Response.json({
        memos: page,
        nextPageToken:
          offset + pageSize < source.length
            ? repeatToken
              ? "repeat"
              : String(offset + pageSize)
            : "",
      })
    }
    if (url.pathname === "/api/v1/resources") return Response.json({ resources })
    if (url.pathname.startsWith("/file/resources/")) {
      assert.equal(url.searchParams.has("thumbnail"), false)
      const name = url.pathname.split("/").slice(2, 4).join("/")
      return new Response(bytes.get(name))
    }
    const related = /^\/api\/v1\/(memos\/\d+)\/(resources|relations|comments|reactions)$/.exec(
      url.pathname,
    )
    if (related) {
      const [_, name, endpoint] = related
      if (endpoint === "resources")
        return Response.json({ resources: resources.filter((r) => r.memo === name) })
      if (endpoint === "relations")
        return Response.json({
          relations: [...normal, ...archived].find((m) => m.name === name).relations || [],
        })
      if (endpoint === "comments")
        return Response.json({
          memos:
            name === "memos/1"
              ? [
                  memo(3),
                  memo(4),
                  { ...memo(900), creator: "users/9", content: "另一位作者的评论" },
                ]
              : [],
        })
      return Response.json({
        reactions: name === "memos/1" ? [{ id: 1, reactionType: "👍", creator: user.name }] : [],
      })
    }
    if (url.pathname.endsWith("/setting"))
      return Response.json({ name: user.name, memoVisibility: "PRIVATE" })
    if (url.pathname.startsWith("/api/v1/workspace/settings/"))
      return Response.json({ name: url.pathname.split("/").pop(), setting: {} })
    if (url.pathname === "/api/v1/memos/-/properties")
      return Response.json({
        entities: normal.map((m) => ({ name: m.name, property: m.property })),
      })
    if (url.pathname === "/api/v1/memos/-/tags")
      return Response.json({ tagAmounts: { 独立标签: count - 1, 原始标签: 1 } })
    throw Error("unexpected source endpoint")
  }
  return { fetchImpl, requests, bytes, resources, normal, archived, passes }
}
async function exportedFixture(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-test-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = sourceMock(options),
    progress = []
  const result = await exportMemos({
    sourceOrigin: origin,
    username,
    password,
    outputDirectory: directory,
    fetchImpl: source.fetchImpl,
    onProgress: (value) => progress.push(value),
  })
  return { directory, source, result, progress }
}
async function allLocalFiles(directory) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await allLocalFiles(file)))
    else files.push(file)
  }
  return files
}

test("export exhausts NORMAL and ARCHIVED pagination including own comments, preserving source bytes and orphan files", async (t) => {
  const { directory, source, result, progress } = await exportedFixture(t)
  assert.deepEqual(result.counts, {
    normal: 143,
    archived: 3,
    comments: 2,
    relatedComments: 3,
    resources: 3,
    orphanResources: 1,
  })
  assert.deepEqual(source.passes, { NORMAL: 2, ARCHIVED: 2 })
  assert.equal(source.requests.filter((r) => r.url.pathname === "/api/v1/memos").length, 6)
  const exported = await readMemosExport(directory)
  assert.equal(exported.cards.length, 146)
  assert.equal(
    exported.resources.length,
    2,
    "orphan remains in local dump without orphan target uploads",
  )
  const first = exported.cards.find((card) => card.sourceId === "memos/1")
  assert.equal(first.content, rawContent)
  assert.equal(first.visibility, "PRIVATE")
  assert.equal(first.modified, "2026-01-02T03:04:05.123Z")
  assert.equal(exported.cards.find((card) => card.sourceId === "memos/2").visibility, "PROTECTED")
  assert.equal(exported.cards.find((card) => card.sourceId === "memos/501").status, "ARCHIVED")
  assert.equal(
    exported.cards.some((card) => card.sourceId === "memos/900"),
    false,
  )
  const raw = JSON.parse(await fs.readFile(path.join(directory, exported.manifest.memos[0].file)))
  assert.equal(raw.comments.length, 3)
  assert.equal(raw.reactions.length, 1)
  assert.deepEqual(
    await fs.readFile(path.join(directory, exported.manifest.memos[0].contentFile)),
    Buffer.from(rawContent),
  )
  for (const resource of exported.manifest.resources)
    assert.deepEqual(
      await fs.readFile(path.join(directory, resource.file)),
      source.bytes.get(resource.sourceId),
    )
  for (const file of await allLocalFiles(directory)) {
    const text = (await fs.readFile(file)).toString("utf8")
    assert.equal(text.includes(password), false)
    assert.equal(text.includes(cookie), false)
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  }
  assert.equal(JSON.stringify(progress).includes(rawContent), false)
  assert.equal(source.requests.filter((r) => r.url.hostname === "storage.example").length, 1)
})

test("import sends full hashed chunks before cards, batches at 100, verifies all cards/files and is idempotent", async (t) => {
  const { directory } = await exportedFixture(t)
  const files = new Map(),
    cards = new Map(),
    calls = [],
    cardBatchSizes = []
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input),
      headers = new Headers(options.headers),
      body = options.body && JSON.parse(options.body)
    assert.equal(headers.get("Authorization"), "Bearer test-github-token")
    calls.push({ path: url.pathname, method: options.method, body })
    if (body) assert.equal(headers.get("X-Howard-Sync-Key"), "test-sync-key")
    else assert.equal(headers.get("X-Howard-Sync-Key"), null)
    if (url.pathname.endsWith("/import/files")) {
      assert.equal(cards.size, 0, "files must be imported before cards on initial run")
      let file = files.get(body.file.id)
      if (!file) files.set(body.file.id, (file = { metadata: body.file, chunks: new Map() }))
      const bytes = Buffer.from(body.chunk.data, "base64")
      assert.ok(bytes.length <= FILE_CHUNK_BYTES)
      file.chunks.set(body.chunk.index, bytes)
      const complete = file.chunks.size === body.chunk.total
      if (complete) {
        file.bytes = Buffer.concat(
          [...file.chunks].sort(([a], [b]) => a - b).map(([_, bytes]) => bytes),
        )
        assert.equal(sha(file.bytes), body.file.sha256)
        assert.equal(file.bytes.length, body.file.size)
      }
      return Response.json({ id: body.file.id, complete })
    }
    if (url.pathname.endsWith("/import")) {
      cardBatchSizes.push(body.memories.length)
      assert.equal(body.sourceOrigin, origin)
      const ids = []
      let imported = 0,
        unchanged = 0
      for (const card of body.memories) {
        assert.equal(card.raw, undefined)
        const id = "memos-" + sha(origin + "\0" + card.sourceId).slice(0, 32)
        if (cards.has(id)) unchanged++
        else imported++
        cards.set(id, { ...card, id })
        ids.push({ sourceId: card.sourceId, id })
      }
      return Response.json({ ids, imported, unchanged })
    }
    if (url.pathname.includes("/files/"))
      return new Response(files.get(url.pathname.split("/").pop()).bytes)
    return Response.json({ memory: cards.get(url.pathname.split("/").pop()), owner: true })
  }
  const first = await importMemosExport({
    directory,
    apiBase: "https://target.example/api/content",
    token: "test-github-token",
    syncKey: "test-sync-key",
    fetchImpl,
  })
  assert.equal(first.imported, 146)
  assert.equal(first.verifiedCards, 146)
  assert.equal(first.files, 2)
  assert.equal(first.verifiedFiles, 2)
  assert.deepEqual(cardBatchSizes, [100, 46])
  assert.deepEqual(
    calls
      .filter((c) => c.path.endsWith("/import/files"))
      .map((c) => Buffer.from(c.body.chunk.data, "base64").length),
    [FILE_CHUNK_BYTES, 19, 7],
  )
  const retryFetch = async (input, options = {}) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/import/files")) {
      const body = JSON.parse(options.body)
      return Response.json({ id: body.file.id, complete: true, unchanged: true })
    }
    return fetchImpl(input, options)
  }
  const repeated = await importMemosExport({
    directory,
    apiBase: "https://target.example/api/content",
    token: "test-github-token",
    syncKey: "test-sync-key",
    fetchImpl: retryFetch,
  })
  assert.equal(repeated.imported, 0)
  assert.equal(repeated.unchanged, 146)
  assert.equal(cards.size, 146)
})

test("repeated page tokens fail export and an incomplete dump cannot cause target writes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-repeat-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = sourceMock({ repeatToken: true })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      fetchImpl: source.fetchImpl,
    }),
    /分页令牌|重复记录/,
  )
  let writes = 0
  await assert.rejects(
    importMemosExport({
      directory,
      apiBase: "https://target.example/api",
      token: "x",
      syncKey: "y",
      fetchImpl: async () => {
        writes++
        throw Error()
      },
    }),
    /未完成/,
  )
  assert.equal(writes, 0)
})

test("the second pagination pass detects changes instead of claiming complete export", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-change-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = sourceMock({ changedSecondPass: true })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      fetchImpl: source.fetchImpl,
    }),
    /来源记录发生变化/,
  )
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, "manifest.json"))).complete, false)
})

test("tampering with source Markdown is rejected before target mutation", async (t) => {
  const { directory } = await exportedFixture(t)
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json")))
  await fs.appendFile(path.join(directory, manifest.memos[0].contentFile), "changed")
  let calls = 0
  await assert.rejects(
    importMemosExport({
      directory,
      apiBase: "https://target.example/api",
      token: "x",
      syncKey: "y",
      fetchImpl: async () => {
        calls++
      },
    }),
    /原文或元信息校验失败/,
  )
  assert.equal(calls, 0)
})

test("a rejected login is attempted once and error messages do not expose the source response or password", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-auth-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = sourceMock({ rejectLogin: true })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      fetchImpl: source.fetchImpl,
    }),
    (error) => error.message.includes("HTTP 400") && !error.message.includes(password),
  )
  assert.equal(source.requests.length, 1)
})
