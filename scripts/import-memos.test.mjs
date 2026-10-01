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
const memo = (id, status = "ACTIVE") => ({
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
  cookieTransport = "metadata",
  expectedPassword = password,
  failures = {},
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
  const pendingFailures = new Map(
    Object.entries(failures).map(([route, values]) => [route, [...values]]),
  )
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input),
      headers = new Headers(options.headers)
    requests.push({ url, method: options.method || "GET", headers, body: options.body })
    const failure = pendingFailures.get(url.pathname)?.shift()
    if (failure instanceof Error) throw failure
    if (typeof failure === "number")
      return Response.json({ message: "never print " + expectedPassword }, { status: failure })
    if (failure?.bodyError) {
      const response = new Response("partial bytes")
      response.arrayBuffer = async () => {
        throw failure.bodyError
      }
      return response
    }
    if (url.pathname === "/api/v1/auth/signin") {
      // The v0.22.5 gateway calls req.ParseForm and ignores JSON credentials.
      if (headers.get("Content-Type") !== "application/x-www-form-urlencoded")
        return Response.json({ message: "unmatched email and password" }, { status: 400 })
      assert.equal(options.method, "POST")
      assert.equal(url.search, "", "credentials must stay out of request URLs")
      const form = new URLSearchParams(options.body)
      assert.equal(form.get("username"), username)
      assert.equal(form.get("password"), expectedPassword)
      assert.equal(form.get("neverExpire"), "false")
      if (rejectLogin)
        return Response.json({ message: "never print " + expectedPassword }, { status: 400 })
      return Response.json(user, {
        headers: {
          [cookieTransport === "standard" ? "Set-Cookie" : "Grpc-Metadata-Set-Cookie"]:
            `memos.access-token=${cookie}; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly; Path=/`,
        },
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
    if (url.pathname === "/api/v1/auth/status") {
      assert.equal(options.method, "POST")
      assert.equal(headers.get("Content-Type"), "application/json")
      assert.deepEqual(JSON.parse(options.body), {})
      return Response.json(user)
    }
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
    password: options?.expectedPassword ?? password,
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
  assert.equal(first.status, "NORMAL")
  assert.equal(first.raw.memo.rowStatus, "ACTIVE")
  assert.equal(exported.cards.find((card) => card.sourceId === "memos/2").visibility, "PROTECTED")
  assert.equal(exported.cards.find((card) => card.sourceId === "memos/501").status, "ARCHIVED")
  assert.equal(
    exported.cards.some((card) => card.sourceId === "memos/900"),
    false,
  )
  const raw = JSON.parse(await fs.readFile(path.join(directory, exported.manifest.memos[0].file)))
  assert.equal(raw.comments.length, 3)
  assert.equal(raw.reactions.length, 1)
  assert.deepEqual(first.raw, raw, "owner import retains full source metadata")
  assert.equal(first.raw.comments[2].content, "另一位作者的评论")
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
  assert.deepEqual(
    progress.filter((value) => value.phase === "memo-metadata").map((value) => value.count),
    [20, 40, 60, 80, 100, 120, 140, 146],
  )
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
      assert.equal(body.file.source.origin, origin)
      assert.equal(
        body.file.source.memo,
        body.file.source.id === "resources/1" ? "memos/1" : "memos/501",
        "original owning memo must reach the file permission boundary",
      )
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
        assert.equal(card.raw.memo.name, card.sourceId)
        assert.equal(card.raw.memo.content, card.content)
        if (card.sourceId === "memos/1") {
          assert.equal(card.raw.comments.length, 3)
          assert.equal(card.raw.reactions[0].reactionType, "👍")
          assert.equal(card.raw.resources[0].name, "resources/1")
        }
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
  const progress = []
  const first = await importMemosExport({
    directory,
    apiBase: "https://target.example/api/content",
    token: "test-github-token",
    syncKey: "test-sync-key",
    fetchImpl,
    onProgress: (value) => progress.push(value),
  })
  assert.equal(first.imported, 146)
  assert.equal(first.verifiedCards, 146)
  assert.equal(first.files, 2)
  assert.equal(first.verifiedFiles, 2)
  assert.deepEqual(
    progress.filter((value) => value.phase === "verify-cards").map((value) => value.count),
    [20, 40, 60, 80, 100, 120, 140, 146],
  )
  assert.deepEqual(
    progress.filter((value) => value.phase === "verify-files").map((value) => value.count),
    [2],
  )
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
  assert.equal(
    [...cards.values()].find((card) => card.sourceId === "memos/1").raw.comments[2].creator,
    "users/9",
  )
  for (const tamperedField of ["raw", "source"]) {
    const alteredFetch = async (input, options) => {
      const response = await retryFetch(input, options)
      if (options.method !== "GET" || new URL(input).pathname.includes("/files/")) return response
      const result = await response.json()
      result.memory[tamperedField] = null
      return Response.json(result)
    }
    await assert.rejects(
      importMemosExport({
        directory,
        apiBase: "https://target.example/api/content",
        token: "test-github-token",
        syncKey: "test-sync-key",
        fetchImpl: alteredFetch,
      }),
      /原始元信息校验失败/,
    )
  }
})

test("pinned gateway rejects JSON signin and accepts form credentials without URL exposure", async (t) => {
  const source = sourceMock()
  const response = await source.fetchImpl(new URL("/api/v1/auth/signin", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, neverExpire: false }),
  })
  assert.equal(response.status, 400)
  const specialPassword = "  test-only +&=密码%?#  "
  const {
    directory,
    source: encoded,
    progress,
  } = await exportedFixture(t, {
    count: 5,
    expectedPassword: specialPassword,
  })
  assert.ok(encoded.requests.every((request) => !request.url.href.includes(specialPassword)))
  assert.equal(
    encoded.requests.filter((request) => request.url.pathname.includes("signin")).length,
    1,
  )
  for (const file of await allLocalFiles(directory))
    assert.equal((await fs.readFile(file)).toString("utf8").includes(specialPassword), false)
  assert.equal(JSON.stringify(progress).includes(specialPassword), false)
})

test("standard HTTP Set-Cookie also authenticates POST auth/status returning direct User", async (t) => {
  const { source, result } = await exportedFixture(t, { count: 5, cookieTransport: "standard" })
  assert.equal(result.counts.normal, 5)
  const status = source.requests.find((request) => request.url.pathname === "/api/v1/auth/status")
  assert.equal(status.method, "POST")
  assert.equal(status.headers.get("Cookie"), `memos.access-token=${cookie}`)
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

test("readonly source GETs retry transient HTTP/network/body failures and keep external cookies isolated", async (t) => {
  const networkError = Object.assign(new TypeError("never print " + password), {
    cause: { code: "ECONNRESET" },
  })
  const { source, result } = await exportedFixture(t, {
    count: 5,
    failures: {
      "/api/v1/memos": [429, 503],
      "/api/v1/memos/1/resources": [networkError],
      [`/file/resources/1/${encodeURIComponent("资源 1.bin")}`]: [{ bodyError: networkError }],
      "/full-file": [502, 504],
    },
  })
  assert.equal(result.counts.normal, 5)
  assert.equal(
    source.requests.filter((request) => request.url.pathname === "/api/v1/memos").length,
    6,
  )
  assert.equal(
    source.requests.filter((request) => request.url.pathname === "/api/v1/memos/1/resources")
      .length,
    2,
  )
  const cdn = source.requests.filter((request) => request.url.hostname === "cdn.example")
  assert.equal(cdn.length, 3)
  assert.ok(cdn.every((request) => request.headers.get("Cookie") == null))
  assert.equal(
    source.requests.filter((request) => request.url.pathname === "/api/v1/auth/signin").length,
    1,
  )
})

test("retry is bounded to three GET attempts and final network errors expose only a safe phase/name/code", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-retry-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const error = Object.assign(
    new TypeError(`secret ${password} https://private.example?q=${password}`),
    { cause: { code: "ECONNRESET" } },
  )
  const source = sourceMock({ failures: { "/api/v1/memos": [error, error, error, error] } })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      fetchImpl: source.fetchImpl,
    }),
    (result) =>
      /memo-pages; TypeError\/ECONNRESET/.test(result.message) &&
      !result.message.includes(password) &&
      !result.message.includes("private.example"),
  )
  assert.equal(
    source.requests.filter((request) => request.url.pathname === "/api/v1/memos").length,
    3,
  )
})

test("signin and auth-status POSTs never retry, and source 400/401/403 responses never retry", async (t) => {
  for (const [route, failure] of [
    ["/api/v1/auth/signin", new TypeError("connection lost")],
    ["/api/v1/auth/status", 503],
    ["/api/v1/memos", 400],
    ["/api/v1/memos", 401],
    ["/api/v1/memos", 403],
  ]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-noretry-"))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const source = sourceMock({ failures: { [route]: [failure, failure] } })
    await assert.rejects(
      exportMemos({
        sourceOrigin: origin,
        username,
        password,
        outputDirectory: directory,
        fetchImpl: source.fetchImpl,
      }),
    )
    assert.equal(source.requests.filter((request) => request.url.pathname === route).length, 1)
  }
})

test("target idempotent import retries identical payloads after commit and verification GETs recover without duplicate data", async (t) => {
  const { directory } = await exportedFixture(t, { count: 5 })
  const files = new Map(),
    cards = new Map(),
    calls = []
  let interruptedFile = false,
    interruptedCards = false,
    interruptedCardRead = false,
    interruptedFileRead = false
  const fetchImpl = async (input, options) => {
    const url = new URL(input)
    const body = options.body && JSON.parse(options.body)
    calls.push({ route: url.pathname, body: options.body })
    if (url.pathname.endsWith("/import/files")) {
      let file = files.get(body.file.id)
      if (!file) files.set(body.file.id, (file = { chunks: new Map() }))
      file.chunks.set(body.chunk.index, Buffer.from(body.chunk.data, "base64"))
      const complete = file.chunks.size === body.chunk.total
      if (complete) {
        file.bytes = Buffer.concat(
          [...file.chunks].sort(([a], [b]) => a - b).map(([_, bytes]) => bytes),
        )
        assert.equal(sha(file.bytes), body.file.sha256)
      }
      if (!interruptedFile) {
        interruptedFile = true
        return Response.json({ message: "temporary internal response failure" }, { status: 500 })
      }
      return Response.json({ id: body.file.id, complete })
    }
    if (url.pathname.endsWith("/import")) {
      const ids = []
      let imported = 0,
        unchanged = 0
      for (const card of body.memories) {
        const id = "memos-" + sha(origin + "\0" + card.sourceId).slice(0, 32)
        if (cards.has(id)) unchanged++
        else imported++
        cards.set(id, { ...card, id })
        ids.push({ sourceId: card.sourceId, id })
      }
      if (!interruptedCards) {
        interruptedCards = true
        throw new TypeError("connection failed after server committed")
      }
      return Response.json({ imported, unchanged, ids })
    }
    if (url.pathname.includes("/files/")) {
      const response = new Response(files.get(url.pathname.split("/").pop()).bytes)
      if (!interruptedFileRead) {
        interruptedFileRead = true
        response.arrayBuffer = async () => {
          throw new TypeError("partial verification download")
        }
      }
      return response
    }
    if (!interruptedCardRead) {
      interruptedCardRead = true
      return Response.json({ message: "temporary unavailable" }, { status: 503 })
    }
    return Response.json({ memory: cards.get(url.pathname.split("/").pop()), owner: true })
  }
  const result = await importMemosExport({
    directory,
    apiBase: "https://target.example/api/content",
    token: "test-github-token",
    syncKey: "test-sync-key",
    fetchImpl,
  })
  assert.equal(cards.size, 8)
  assert.equal(files.size, 2)
  assert.equal(
    [...files.values()].reduce((total, file) => total + file.chunks.size, 0),
    3,
  )
  assert.equal(result.unchanged, 8)
  assert.equal(result.verifiedCards, 8)
  assert.equal(result.verifiedFiles, 2)
  const cardWrites = calls.filter((call) => call.route.endsWith("/import"))
  assert.equal(cardWrites.length, 2)
  assert.equal(cardWrites[0].body, cardWrites[1].body)
  const fileWrites = calls.filter((call) => call.route.endsWith("/import/files"))
  assert.equal(fileWrites.length, 4)
  assert.equal(fileWrites[0].body, fileWrites[1].body)
})

test("target authorization refusal is never retried even on idempotent import endpoints", async (t) => {
  const { directory } = await exportedFixture(t, { count: 5 })
  let calls = 0
  await assert.rejects(
    importMemosExport({
      directory,
      apiBase: "https://target.example/api/content",
      token: "test-github-token",
      syncKey: "test-sync-key",
      fetchImpl: async () => {
        calls++
        return Response.json({ message: "private response body" }, { status: 403 })
      },
    }),
    /HTTP 403.*upload-file/,
  )
  assert.equal(calls, 1)
})

async function interruptedExport(t, { legacyPaths = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-memos-checkpoint-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = sourceMock({ count: 5, failures: { "/full-file": [503, 503, 503] } })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      fetchImpl: source.fetchImpl,
    }),
    /HTTP 503/,
  )
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json")))
  assert.equal(manifest.complete, false)
  assert.equal(manifest.memos.length, 8)
  assert.equal(manifest.resources.length, 1)
  assert.equal(manifest.counts.resources, 1)
  if (legacyPaths) {
    for (const entry of manifest.memos) {
      const key = sha(entry.sourceId).slice(0, 24)
      const file = `memos/${key}/memo.json`,
        contentFile = `memos/${key}/content.md`
      await fs.rename(path.join(directory, entry.file), path.join(directory, file))
      await fs.rename(path.join(directory, entry.contentFile), path.join(directory, contentFile))
      entry.file = file
      entry.contentFile = contentFile
    }
    for (const entry of manifest.resources) {
      const metadataFile = `resources/${sha(entry.sourceId).slice(0, 24)}.json`
      await fs.rename(path.join(directory, entry.metadataFile), path.join(directory, metadataFile))
      entry.metadataFile = metadataFile
    }
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest))
  }
  return { directory, manifest }
}

test("incomplete exports checkpoint atomically and resume revalidates all source pages while reusing hashed bytes", async (t) => {
  const { directory, manifest } = await interruptedExport(t, { legacyPaths: true })
  const interruptedAgain = sourceMock({
    count: 5,
    failures: { "/api/v1/memos/1/resources": [503, 503, 503] },
  })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      fetchImpl: interruptedAgain.fetchImpl,
      resume: true,
    }),
    /HTTP 503/,
  )
  const afterFailure = JSON.parse(await fs.readFile(path.join(directory, "manifest.json")))
  assert.equal(
    afterFailure.memos.length,
    8,
    "an early resume failure must retain unprocessed memo caches",
  )
  assert.equal(
    afterFailure.resources.length,
    1,
    "an early resume failure must retain downloaded file mappings",
  )
  const source = sourceMock({ count: 5 }),
    progress = []
  await exportMemos({
    sourceOrigin: origin,
    username,
    password,
    outputDirectory: directory,
    fetchImpl: source.fetchImpl,
    resume: true,
    onProgress: (value) => progress.push(value),
  })
  const exported = await readMemosExport(directory)
  assert.equal(exported.manifest.complete, true)
  assert.equal(exported.cards.length, 8)
  assert.equal(exported.manifest.resources.length, 3)
  assert.deepEqual(source.passes, { NORMAL: 2, ARCHIVED: 2 })
  assert.equal(
    source.requests.filter((request) => request.url.pathname.startsWith("/file/resources/1/"))
      .length,
    0,
  )
  assert.equal(source.requests.filter((request) => request.url.pathname === "/full-file").length, 1)
  assert.equal(
    source.requests.filter((request) => request.url.pathname === "/api/v1/memos/1/comments").length,
    1,
  )
  assert.equal(progress.find((value) => value.phase === "memo-metadata").reused, 8)
  assert.equal(progress.filter((value) => value.phase === "resource-files").at(-1).reused, 1)
  assert.equal(
    new Set(exported.manifest.responses.map((response) => response.file)).size,
    exported.manifest.responses.length,
  )
  assert.ok(exported.manifest.responses.length > manifest.responses.length)
  assert.equal(
    (await allLocalFiles(directory)).some((file) => file.endsWith(".pending")),
    false,
  )
  for (const file of await allLocalFiles(directory))
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
})

test("resume rejects modified cached memo or attachment bytes before making any source request", async (t) => {
  for (const kind of ["memo", "resource"]) {
    const { directory, manifest } = await interruptedExport(t)
    const file = kind === "memo" ? manifest.memos[0].contentFile : manifest.resources[0].file
    await fs.appendFile(path.join(directory, file), "changed")
    let requests = 0
    await assert.rejects(
      exportMemos({
        sourceOrigin: origin,
        username,
        password,
        outputDirectory: directory,
        resume: true,
        fetchImpl: async () => {
          requests++
        },
      }),
      /缓存.*校验失败/,
    )
    assert.equal(requests, 0)
    assert.equal(
      JSON.parse(await fs.readFile(path.join(directory, "manifest.json"))).complete,
      false,
    )
  }
})

test("resume refreshes changed source metadata, redownloads changed resources and removes deleted memos", async (t) => {
  const { directory, manifest } = await interruptedExport(t)
  const source = sourceMock({ count: 4 })
  source.resources[0].filename = "renamed.bin"
  await exportMemos({
    sourceOrigin: origin,
    username,
    password,
    outputDirectory: directory,
    resume: true,
    fetchImpl: source.fetchImpl,
  })
  const exported = await readMemosExport(directory)
  assert.equal(exported.cards.length, 7)
  assert.equal(
    exported.cards.some((card) => card.sourceId === "memos/5"),
    false,
  )
  assert.equal(
    source.requests.filter((request) => request.url.pathname === "/file/resources/1/renamed.bin")
      .length,
    1,
  )
  assert.equal(
    exported.resources.find((resource) => resource.sourceId === "resources/1").resource.filename,
    "renamed.bin",
  )
  // Old checkpoint files stay valid even when newer source metadata is written.
  const oldMetadata = JSON.parse(
    await fs.readFile(path.join(directory, manifest.resources[0].metadataFile)),
  )
  assert.equal(oldMetadata.filename, "资源 1.bin")
  assert.equal(
    exported.cards.find((card) => card.sourceId === "memos/1").raw.resources[0].filename,
    "renamed.bin",
  )
})

test("resume never marks complete when the second fresh source pass changes", async (t) => {
  const { directory } = await interruptedExport(t)
  const source = sourceMock({ count: 5, changedSecondPass: true })
  await assert.rejects(
    exportMemos({
      sourceOrigin: origin,
      username,
      password,
      outputDirectory: directory,
      resume: true,
      fetchImpl: source.fetchImpl,
    }),
    /来源记录发生变化/,
  )
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json")))
  assert.equal(manifest.complete, false)
  assert.equal(manifest.resources.length, 3)
  await assert.rejects(readMemosExport(directory), /未完成/)
})
