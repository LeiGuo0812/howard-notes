import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import fs from "node:fs"
import worker, { handle } from "./worker.mjs"
import { topicList } from "../scripts/lib/site-settings.mjs"

const origin = "https://howard.example.test"
const base = "/howard-notes/"
const source = "\uFEFF# 测试\r\n\r\n原始内容与换行保持不变。\r\n"
const sha = createHash("sha1")
  .update(`blob ${Buffer.byteLength(source)}\0`)
  .update(source)
  .digest("hex")
function fixture() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(fs.readFileSync(new URL("schema.sql", import.meta.url), "utf8"))
  sqlite.exec(fs.readFileSync(new URL("memories-schema.sql", import.meta.url), "utf8"))
  sqlite.exec(fs.readFileSync(new URL("personal-notes-schema.sql", import.meta.url), "utf8"))
  sqlite.exec(fs.readFileSync(new URL("publication-jobs-schema.sql", import.meta.url), "utf8"))
  const sqlQueries = []
  const DB = {
    prepare(sql) {
      sqlQueries.push(sql)
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
        const result = await Promise.all(statements.map((statement) => statement.run()))
        sqlite.exec("COMMIT")
        return result
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
    withSession() {
      return this
    },
  }
  const env = {
    DB,
    SITE_PREFIX: base,
    OWNER_ID: "50766698",
    REPOSITORY: "LeiGuo0812/howard-notes",
    BRANCH: "main",
    FALLBACK_ORIGIN: "https://leiguo0812.github.io",
  }
  const settings = JSON.parse(
    fs.readFileSync(new URL("../library/site.json", import.meta.url), "utf8"),
  )
  const article = {
    id: "test-note",
    file: "notes/test.md",
    title: "测试文章",
    category: settings.topics[0].category,
    published: true,
    date: "2026-10-01",
    tags: [],
  }
  const catalog = {
    version: 2,
    articles: [
      article,
      {
        ...article,
        id: "private-note",
        file: "notes/private.md",
        title: "PRIVATE-NOT-EXPOSED",
        published: false,
      },
    ],
  }
  let commit = "a".repeat(40),
    userId = 50766698,
    push = true
  const gitRequests = []
  const gitStatuses = new Map()
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname
    gitRequests.push({ url, options })
    if (gitStatuses.has(path))
      return Response.json(
        {},
        {
          status: gitStatuses.get(path),
          headers: { Location: "https://untrusted.example.test/redirect" },
        },
      )
    if (path === "/user") return Response.json({ id: userId })
    if (path === "/repos/LeiGuo0812/howard-notes") return Response.json({ permissions: { push } })
    if (path.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: commit } })
    if (path.includes("/git/commits/")) return Response.json({ tree: { sha: "t".repeat(40) } })
    if (path.includes("/git/trees/"))
      return Response.json({
        tree: [
          { path: "library/catalog.json", type: "blob", sha: "catalog" },
          { path: "library/site.json", type: "blob", sha: "site" },
          ...catalog.articles.map((a) => ({
            path: `library/${a.file}`,
            type: "blob",
            sha: a.id === "private-note" ? "private" : sha,
          })),
        ],
      })
    if (path.endsWith("/git/blobs/catalog"))
      return Response.json({ content: Buffer.from(JSON.stringify(catalog)).toString("base64") })
    if (path.endsWith("/git/blobs/site"))
      return Response.json({ content: Buffer.from(JSON.stringify(settings)).toString("base64") })
    throw new Error(`Unexpected Git endpoint ${path}`)
  }
  const call = (path, body, headers = {}) =>
    handle(
      new Request(
        origin + base + "api/content/" + path,
        body
          ? {
              method: "POST",
              headers: {
                Authorization: "Bearer test-not-secret",
                "Content-Type": "application/json",
                Origin: origin,
                ...headers,
              },
              body: JSON.stringify(body),
            }
          : { headers },
      ),
      env,
      {},
      fetcher,
    )
  const documents = () =>
    catalog.articles
      .filter((a) => a.published)
      .map((a) => ({
        id: a.id,
        file: a.file,
        source,
        sourceSha: sha,
        html: "<h1>测试</h1>",
        toc: [],
        text: "测试",
        links: [],
        created: a.date,
        modified: a.date,
      }))
  const pages = () =>
    [
      "index",
      "404",
      "about",
      "topics/index",
      "tags/index",
      "notes/index",
      "collections/index",
      "memory/index",
      ...topicList(
        settings,
        catalog.articles.filter((a) => a.published),
      ).map((a) => "topics/" + a.id),
      ...settings.collections.map((a) => a.id).map((id) => "collections/" + id),
      ...catalog.articles.filter((a) => a.published).map((a) => "notes/" + a.id),
    ].map((path) => ({ path, html: `<!doctype html><html><body>${path}</body></html>` }))
  const metadata = () => ({
    contentIndex: Object.fromEntries(
      documents().map((a) => [
        "notes/" + a.id,
        { title: article.title, content: a.text, links: [], tags: [] },
      ]),
    ),
    blogData: {
      settings,
      articles: documents().map((a) => ({
        id: a.id,
        title: article.title,
        modified: article.date,
        excerpt: "测试",
      })),
    },
    shell: { head: "<meta charset=utf-8>", postscript: "<script></script>" },
  })
  const start = async () => {
    const response = await call("sync/begin", { commit })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  const upload = async (sync) => {
    for (const item of [
      ...(documents().length ? [{ documents: documents() }] : []),
      ...Array.from({ length: Math.ceil(pages().length / 20) }, (_, i) => ({
        pages: pages().slice(i * 20, (i + 1) * 20),
      })),
      metadata(),
    ]) {
      const response = await call("sync/chunk", { syncId: sync.syncId, ...item })
      assert.equal(response.status, 200, await response.clone().text())
    }
  }
  const publish = async () => {
    const sync = await start()
    await upload(sync)
    const response = await call("sync/finish", { syncId: sync.syncId })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  return {
    env,
    sqlite,
    catalog,
    settings,
    article,
    call,
    documents,
    pages,
    start,
    upload,
    publish,
    metadata,
    gitRequests,
    sqlQueries,
    setGitStatus(path, status) {
      gitStatuses.set(path, status)
    },
    setCommit(value) {
      commit = value
    },
    setUser(value) {
      userId = value
    },
    setPush(value) {
      push = value
    },
  }
}
test("only the maintainer with repository write access may stage public content", async () => {
  const f = fixture()
  const missing = await handle(
    new Request(origin + base + "api/content/sync/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    f.env,
  )
  assert.equal(missing.status, 401)
  f.setUser(123)
  assert.equal((await f.call("sync/begin", { commit: "a".repeat(40) })).status, 403)
  f.setUser(50766698)
  f.setPush(false)
  assert.equal((await f.call("sync/begin", { commit: "a".repeat(40) })).status, 403)
})

test("integrated memory routes enforce the GitHub owner and repository permission for writes", async () => {
  const f = fixture()
  const body = { content: "isolated memory #memory-tag", visibility: "PRIVATE" }
  f.setUser(123)
  assert.equal((await f.call("memories", body)).status, 403)
  f.setUser(50766698)
  f.setPush(false)
  assert.equal((await f.call("memories", body)).status, 403)
  f.setPush(true)
  const created = await f.call("memories", body)
  assert.equal(created.status, 201, await created.clone().text())
  const id = (await created.json()).memory.id
  assert.equal((await f.call("memories/" + id)).status, 404)
  const publicList = await (await f.call("memories")).json()
  assert.equal(publicList.total, 0)
  assert.deepEqual(publicList.tags, [])
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM public_documents").get().n, 0)
})

test("integrated memory cookie authorization stays same-origin while the backup site can use its owner bearer", async () => {
  const f = fixture()
  f.env.SESSION_SECRET = Buffer.alloc(32, 19).toString("base64url")
  const session = await f.call("session", { serverTime: 100, expiresAt: 3_600_100 })
  assert.equal(session.status, 200)
  const cookie = session.headers.get("Set-Cookie").split(";")[0]
  const created = await f.call("memories", {
    content: "private-session-content",
    visibility: "PRIVATE",
  })
  const id = (await created.json()).memory.id
  const fromCookie = await f.call("memories/" + id, undefined, { Cookie: cookie, Origin: origin })
  assert.equal(fromCookie.status, 200)
  assert.equal((await fromCookie.clone().json()).owner, true)
  assert.equal((await fromCookie.text()).includes("test-not-secret"), false)
  const crossSite = await f.call("memories/" + id, undefined, {
    Cookie: cookie,
    Origin: "https://evil.example",
    "Sec-Fetch-Site": "cross-site",
  })
  assert.equal(crossSite.status, 403)
  const backupCookie = await f.call("memories/" + id, undefined, {
    Cookie: cookie,
    Origin: f.env.FALLBACK_ORIGIN,
    "Sec-Fetch-Site": "cross-site",
  })
  assert.equal(backupCookie.status, 404)
  const backupBearer = await f.call("memories/" + id, undefined, {
    Authorization: "Bearer test-not-secret",
    Origin: f.env.FALLBACK_ORIGIN,
    "Sec-Fetch-Site": "cross-site",
  })
  assert.equal(backupBearer.status, 200)
  assert.equal(backupBearer.headers.get("Access-Control-Allow-Origin"), f.env.FALLBACK_ORIGIN)
  assert.equal(backupBearer.headers.get("Cache-Control"), "private, no-store")
  f.setUser(123)
  assert.equal(
    (
      await f.call("memories/" + id, undefined, {
        Authorization: "Bearer test-not-secret",
        Origin: f.env.FALLBACK_ORIGIN,
      })
    ).status,
    403,
  )
})

test("memory content and tags never enter the article snapshot, search projection or RSS", async () => {
  const f = fixture()
  await f.publish()
  const before = await (await f.call("snapshot")).json()
  await f.call("memories", {
    content: "MEMORY-PRIVATE-ONLY #memory-private",
    visibility: "PRIVATE",
  })
  await f.call("memories", { content: "MEMORY-PUBLIC-ONLY #memory-public", visibility: "PUBLIC" })
  const snapshot = await (await f.call("snapshot")).json()
  assert.deepEqual(snapshot, before)
  for (const path of ["snapshot", "contentIndex", "blogData", "catalog", "index.xml"])
    assert.equal((await (await f.call(path)).text()).includes("MEMORY-"), false)
  const memories = await (await f.call("memories")).json()
  assert.equal(memories.total, 1)
  assert.deepEqual(memories.tags, [{ name: "memory-public", count: 1 }])
  const status = await (await f.call("status")).json()
  assert.equal(status.revision, before.revision)
  assert.equal(status.commit, before.commit)
})

test("memory automation import requires its own key and cannot borrow that key for ordinary writes", async () => {
  const f = fixture()
  f.env.SYNC_SECRET = "test-import-key"
  const body = {
    sourceOrigin: "http://source.example:5230",
    memories: [
      {
        sourceId: "1",
        content: "imported-private",
        created: "2024-01-01T00:00:00Z",
        modified: "2025-01-01T00:00:00Z",
        visibility: "PRIVATE",
        status: "NORMAL",
      },
    ],
  }
  assert.equal((await f.call("memories/import", body)).status, 403)
  assert.equal(
    (await f.call("memories/import", body, { "X-Howard-Sync-Key": "incorrect" })).status,
    403,
  )
  const imported = await f.call("memories/import", body, { "X-Howard-Sync-Key": f.env.SYNC_SECRET })
  assert.equal(imported.status, 200, await imported.clone().text())
  assert.equal(
    (
      await f.call(
        "memories",
        { content: "automation-through-normal-api" },
        { "X-Howard-Sync-Key": f.env.SYNC_SECRET },
      )
    ).status,
    403,
  )
  assert.equal((await (await f.call("memories")).json()).total, 0)
  const owner = await (
    await f.call("memories", undefined, { Authorization: "Bearer test-not-secret", Origin: origin })
  ).json()
  assert.equal(owner.total, 1)
})
test("only the canonical current branch commit may begin or finish a synchronization", async () => {
  const f = fixture()
  assert.equal((await f.call("sync/begin", { commit: "b".repeat(40) })).status, 409)
  const s = await f.start()
  await f.upload(s)
  f.setCommit("b".repeat(40))
  assert.equal((await f.call("sync/finish", { syncId: s.syncId })).status, 409)
  assert.equal((await (await f.call("status")).json()).revision, 0)
})
test("partial uploads remain invisible and an atomic finish exposes complete new note routes", async () => {
  const f = fixture()
  const s = await f.start()
  await f.call("sync/chunk", { syncId: s.syncId, documents: f.documents() })
  assert.equal((await f.call("sync/finish", { syncId: s.syncId })).status, 409)
  assert.equal((await (await f.call("snapshot")).json()).documents.length, 0)
  await f.upload(s)
  assert.equal((await f.call("sync/finish", { syncId: s.syncId })).status, 200)
  const page = await handle(new Request(origin + base + "notes/test-note"), f.env)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /notes\/test-note/)
  assert.equal(page.headers.get("X-Howard-Revision"), "1")
  const snapshot = await (await f.call("snapshot")).json()
  assert.equal(snapshot.documents[0].source, source)
  assert.equal(snapshot.catalog.articles.length, 1)
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-NOT-EXPOSED"))
})
test("source hash mismatch, private source, private route and private index are rejected", async () => {
  const f = fixture()
  const s = await f.start()
  const doc = f.documents()[0]
  for (const item of [
    { documents: [{ ...doc, source: "modified secretly" }] },
    { documents: [{ ...doc, id: "private-note" }] },
    { pages: [{ path: "notes/private-note", html: "<html></html>" }] },
    { contentIndex: { "notes/private-note": { content: "secret" } } },
  ])
    assert.ok(
      [403, 409].includes((await f.call("sync/chunk", { syncId: s.syncId, ...item })).status),
    )
})
test("superseded and expired stages cannot modify the new synchronization", async () => {
  const f = fixture()
  const old = await f.start()
  const current = await f.start()
  assert.equal(
    (await f.call("sync/chunk", { syncId: old.syncId, documents: f.documents() })).status,
    409,
  )
  f.sqlite.exec("UPDATE sync_session SET expires=1")
  assert.equal(
    (await f.call("sync/chunk", { syncId: current.syncId, documents: f.documents() })).status,
    409,
  )
})
test("unpublishing removes public routes, snapshots, lists and search in the same revision", async () => {
  const f = fixture()
  await f.publish()
  f.catalog.articles[0].published = false
  f.setCommit("b".repeat(40))
  await f.publish()
  assert.equal((await handle(new Request(origin + base + "notes/test-note"), f.env)).status, 404)
  assert.equal((await (await f.call("snapshot")).json()).documents.length, 0)
  assert.deepEqual(await (await f.call("contentIndex")).json(), {})
  assert.equal((await (await f.call("status")).json()).revision, 2)
})
test("existing synchronized commits are idempotent and retries do not create a new revision", async () => {
  const f = fixture()
  await f.publish()
  const s = await f.start()
  assert.equal(s.status, "synchronized")
  assert.equal(s.revision, 1)
  assert.equal(s.syncId, undefined)
})

test("incremental synchronization reuses canonical docs and unchanged pages without uploading them", async () => {
  const f = fixture()
  await f.publish()
  const old = await (await f.call("snapshot")).json()
  assert.match(old.pageHashes.index, /^[a-f0-9]{64}$/)
  f.setCommit("b".repeat(40))
  const next = await f.start()
  assert.deepEqual(next.reusableDocuments, ["test-note"])
  assert.equal((await f.call("sync/chunk", { syncId: next.syncId, ...f.metadata() })).status, 200)
  assert.equal((await f.call("sync/finish", { syncId: next.syncId })).status, 200)
  const page = await handle(new Request(origin + base + "notes/test-note"), f.env)
  assert.equal(page.status, 200)
  assert.equal(page.headers.get("X-Howard-Revision"), "2")
})
test("data storage is bounded to current, previous and one staging version; expired stages are cleared", async () => {
  const f = fixture()
  for (const c of ["a", "b", "c", "d"]) {
    f.setCommit(c.repeat(40))
    await f.publish()
  }
  assert.deepEqual(
    f.sqlite
      .prepare("SELECT DISTINCT revision FROM public_pages ORDER BY revision")
      .all()
      .map((r) => r.revision),
    [3, 4],
  )
  f.setCommit("e".repeat(40))
  const s = await f.start()
  await f.upload(s)
  f.sqlite.exec("UPDATE sync_session SET expires=1")
  await worker.scheduled({}, f.env)
  for (const table of ["public_documents", "public_pages", "public_payloads"]) {
    assert.equal(
      f.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE revision=5`).get().n,
      0,
      table,
    )
    assert.deepEqual(
      f.sqlite
        .prepare(`SELECT DISTINCT revision FROM ${table} ORDER BY revision`)
        .all()
        .map((row) => row.revision),
      [3, 4],
      table,
    )
  }
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM sync_session").get().n, 0)
  assert.equal((await (await f.call("status")).json()).revision, 4)
})
test("sitemap and RSS are generated from the current public snapshot", async () => {
  const f = fixture()
  await f.publish()
  for (const path of ["sitemap.xml", "index.xml"]) {
    const response = await handle(new Request(origin + base + path), f.env)
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /test-note/)
    assert.ok(!text.includes("private-note"))
    assert.ok(text.includes(origin))
  }
})
test("CORS and cross-site POSTs allow the known site and reject unrelated origins", async () => {
  const f = fixture()
  assert.equal(
    (await f.call("sync/begin", { commit: "a".repeat(40) }, { Origin: "https://attacker.test" }))
      .status,
    403,
  )
  const preflight = await handle(
    new Request(origin + base + "api/content/sync/begin", {
      method: "OPTIONS",
      headers: { Origin: f.env.FALLBACK_ORIGIN },
    }),
    f.env,
  )
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), f.env.FALLBACK_ORIGIN)
})

test("Unicode, nested and dotted tag routes are served from the active public revision", async () => {
  const f = fixture()
  const sync = await f.start()
  await f.upload(sync)
  const tags = ["机器学习", "工具/v1.2", "node.js"]
  const metadata = f.metadata()
  const response = await f.call("sync/chunk", {
    syncId: sync.syncId,
    pages: tags.map((id) => ({ path: `tags/${id}`, html: `<html><body>标签 ${id}</body></html>` })),
    contentIndex: {
      ...metadata.contentIndex,
      ...Object.fromEntries(tags.map((id) => [`tags/${id}`, { title: id, content: "" }])),
    },
    blogData: { ...metadata.blogData, tags: tags.map((id) => ({ id, title: id })) },
  })
  assert.equal(response.status, 200, await response.text())
  assert.equal((await f.call("sync/finish", { syncId: sync.syncId })).status, 200)
  let assetReads = 0
  f.env.ASSETS = {
    fetch() {
      assetReads++
      throw new Error("Tag route reached static assets")
    },
  }
  for (const id of tags) {
    for (const suffix of ["", "/", ".html"]) {
      const page = await handle(
        new Request(origin + base + `tags/${encodeURI(id)}${suffix}`),
        f.env,
      )
      assert.equal(page.status, 200, id + suffix)
      assert.match(await page.text(), new RegExp(id.replaceAll(".", "\\.")))
      assert.equal(page.headers.get("ETag"), `"1-${encodeURIComponent(`tags/${id}`)}"`)
      assert.equal(page.headers.get("X-Howard-Revision"), "1")
    }
  }
  assert.equal(assetReads, 0)
})

test("legacy p10 pagination preserves query parameters while exact article -pN routes take precedence", async () => {
  const f = fixture()
  f.catalog.articles.push({ ...f.article, id: "test-note-p10", file: "notes/test-p10.md" })
  await f.publish()
  const redirect = await handle(
    new Request(origin + base + "notes/index-p10.html?sort=title&search=hello&page=2"),
    f.env,
  )
  assert.equal(redirect.status, 302)
  const target = new URL(redirect.headers.get("Location"))
  assert.equal(target.pathname, base + "notes/index")
  assert.equal(target.searchParams.get("page"), "10")
  assert.equal(target.searchParams.get("sort"), "title")
  assert.equal(target.searchParams.get("search"), "hello")
  for (const suffix of ["", ".html"]) {
    const exact = await handle(new Request(origin + base + "notes/test-note-p10" + suffix), f.env)
    assert.equal(exact.status, 200)
    assert.equal(exact.headers.get("Location"), null)
    assert.match(await exact.text(), /notes\/test-note-p10/)
  }
  for (const path of ["tags/missing-p10", "notes/index-p1", "notes/index-p0", "notes/index-p01"])
    assert.equal((await handle(new Request(origin + base + path), f.env)).status, 404, path)
})

test("stored 404 templates retain HTTP 404 for direct, missing and HEAD routes and stay out of sitemaps", async () => {
  const f = fixture()
  await f.publish()
  for (const path of ["404", "404.html", "notes/missing", "tags/missing"]) {
    const response = await handle(new Request(origin + base + path), f.env)
    assert.equal(response.status, 404, path)
    assert.match(await response.text(), /<body>404<\/body>/)
  }
  const head = await handle(new Request(origin + base + "notes/missing", { method: "HEAD" }), f.env)
  assert.equal(head.status, 404)
  assert.equal(await head.text(), "")
  for (const path of ["/sitemap.xml", base + "sitemap.xml"]) {
    const sitemap = await handle(new Request(origin + path), f.env)
    assert.equal(sitemap.status, 200)
    const text = await sitemap.text()
    assert.ok(text.includes(`<loc>${origin}${base}notes/test-note</loc>`))
    assert.ok(!text.includes(`<loc>${origin}${base}404</loc>`))
  }
})

test("public payload ETags support weak, list and wildcard revalidation without reading the stored body", async () => {
  const f = fixture()
  await f.publish()
  for (const path of ["shell", "contentIndex", "blogData", "settings", "catalog"]) {
    const first = await f.call(path)
    assert.equal(first.status, 200)
    assert.ok((await first.text()).length > 0)
    const etag = first.headers.get("ETag")
    for (const condition of [etag, "W/" + etag, '"older", W/' + etag, "*"]) {
      for (const method of ["GET", "HEAD"]) {
        f.sqlQueries.length = 0
        const response = await handle(
          new Request(origin + base + "api/content/" + path, {
            method,
            headers: { "If-None-Match": condition, Origin: f.env.FALLBACK_ORIGIN },
          }),
          f.env,
        )
        assert.equal(response.status, 304, path + " " + condition + " " + method)
        assert.equal(await response.text(), "")
        assert.equal(response.headers.get("ETag"), etag)
        assert.equal(response.headers.get("Cache-Control"), "no-cache")
        assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
        assert.equal(response.headers.get("Access-Control-Allow-Origin"), f.env.FALLBACK_ORIGIN)
        assert.ok(f.sqlQueries.some((sql) => /SELECT 1 AS present FROM public_payloads/.test(sql)))
        assert.ok(!f.sqlQueries.some((sql) => /SELECT body FROM public_payloads/.test(sql)))
      }
    }
    f.sqlQueries.length = 0
    const head = await handle(
      new Request(origin + base + "api/content/" + path, { method: "HEAD" }),
      f.env,
    )
    assert.equal(head.status, 200)
    assert.equal(await head.text(), "")
    assert.equal(head.headers.get("ETag"), etag)
    assert.ok(!f.sqlQueries.some((sql) => /SELECT body FROM public_payloads/.test(sql)))
  }
})

test("public article and module page ETags avoid body reads while preserving revision and commit headers", async () => {
  const f = fixture()
  await f.publish()
  for (const path of ["", "notes/", "notes/test-note", "memory/"]) {
    const first = await handle(new Request(origin + base + path), f.env)
    assert.equal(first.status, 200)
    const etag = first.headers.get("ETag")
    for (const method of ["GET", "HEAD"]) {
      for (const condition of [etag, "W/" + etag, '"older", W/' + etag, "*"]) {
        f.sqlQueries.length = 0
        const response = await handle(
          new Request(origin + base + path, { method, headers: { "If-None-Match": condition } }),
          f.env,
        )
        assert.equal(response.status, 304, path + " " + method)
        assert.equal(await response.text(), "")
        assert.equal(response.headers.get("ETag"), etag)
        assert.equal(response.headers.get("X-Howard-Revision"), "1")
        assert.equal(response.headers.get("X-Howard-Commit"), "a".repeat(40))
        assert.equal(response.headers.get("Cache-Control"), "no-cache")
        assert.ok(f.sqlQueries.some((sql) => /SELECT path FROM public_pages/.test(sql)))
        assert.ok(!f.sqlQueries.some((sql) => /SELECT body FROM public_pages/.test(sql)))
      }
    }
    f.sqlQueries.length = 0
    const head = await handle(new Request(origin + base + path, { method: "HEAD" }), f.env)
    assert.equal(head.status, 200)
    assert.equal(await head.text(), "")
    assert.equal(head.headers.get("ETag"), etag)
    assert.ok(!f.sqlQueries.some((sql) => /SELECT body FROM public_pages/.test(sql)))
  }
})

test("ETags reject stale revisions and never convert missing, 404 or private resources to 304", async () => {
  const f = fixture()
  await f.publish()
  const index = await f.call("contentIndex")
  const priorTag = index.headers.get("ETag")
  const page = await handle(new Request(origin + base + "notes/test-note"), f.env)
  const priorPageTag = page.headers.get("ETag")
  f.setCommit("b".repeat(40))
  f.settings.brand.name = "Changed brand"
  await f.publish()
  const freshIndex = await f.call("contentIndex", undefined, { "If-None-Match": priorTag })
  assert.equal(freshIndex.status, 200)
  assert.notEqual(freshIndex.headers.get("ETag"), priorTag)
  assert.ok((await freshIndex.text()).length > 0)
  const freshPage = await handle(
    new Request(origin + base + "notes/test-note", { headers: { "If-None-Match": priorPageTag } }),
    f.env,
  )
  assert.equal(freshPage.status, 200)
  assert.notEqual(freshPage.headers.get("ETag"), priorPageTag)
  assert.equal(freshPage.headers.get("X-Howard-Revision"), "2")
  for (const path of ["404", "404.html", "notes/missing", "notes/private-note"]) {
    for (const method of ["GET", "HEAD"]) {
      for (const condition of ["*", `"2-${encodeURIComponent(path)}"`]) {
        const response = await handle(
          new Request(origin + base + path, { method, headers: { "If-None-Match": condition } }),
          f.env,
        )
        assert.equal(response.status, 404, path + " " + method)
      }
    }
  }
  const empty = fixture()
  const unavailable = await empty.call("contentIndex", undefined, { "If-None-Match": "*" })
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get("Cache-Control"), "no-store")
  const privateResponse = await f.call("memories/missing-private-card", undefined, {
    "If-None-Match": "*",
  })
  assert.equal(privateResponse.status, 404)
  assert.equal(privateResponse.headers.get("ETag"), null)
  assert.equal(privateResponse.headers.get("Cache-Control"), "private, no-store")
  const session = await f.call("session", undefined, { "If-None-Match": "*" })
  assert.notEqual(session.status, 304)
  assert.equal(session.headers.get("ETag"), null)
  assert.equal(session.headers.get("Cache-Control"), "no-store")
})

test("automation sync keys require a bearer token and trusted origin and cannot bypass canonical Git verification", async () => {
  const f = fixture()
  f.env.SYNC_SECRET = "fixture-automation-secret"
  f.setUser(123)
  f.setPush(false)
  const body = { commit: "a".repeat(40) }
  for (const key of ["", "wrong-key", "fixture-automation-secrex"])
    assert.equal((await f.call("sync/begin", body, { "X-Howard-Sync-Key": key })).status, 403)
  const headers = { "X-Howard-Sync-Key": f.env.SYNC_SECRET }
  assert.equal((await f.call("sync/begin", body, { ...headers, Authorization: "" })).status, 401)
  assert.equal(
    (await f.call("sync/begin", body, { ...headers, Origin: "https://attacker.test" })).status,
    403,
  )
  f.gitRequests.length = 0
  const allowed = await f.call("sync/begin", body, headers)
  assert.equal(allowed.status, 200, await allowed.clone().text())
  assert.ok(f.gitRequests.length >= 5)
  assert.ok(
    f.gitRequests.every(
      ({ url }) => !["/user", "/repos/LeiGuo0812/howard-notes"].includes(new URL(url).pathname),
    ),
  )
  assert.ok(f.gitRequests.some(({ url }) => new URL(url).pathname.endsWith("/git/ref/heads/main")))
  assert.equal((await f.call("sync/begin", { commit: "b".repeat(40) }, headers)).status, 409)
  f.setGitStatus("/repos/LeiGuo0812/howard-notes/git/ref/heads/main", 401)
  assert.equal((await f.call("sync/begin", body, headers)).status, 401)
  delete f.env.SYNC_SECRET
  assert.equal((await f.call("sync/begin", body, headers)).status, 403)
})

test("Git requests use Workers-compatible manual redirects and reject redirected authorization or canonical reads", async () => {
  const f = fixture()
  await f.start()
  assert.ok(f.gitRequests.length > 0)
  assert.ok(f.gitRequests.every(({ options }) => options.redirect === "manual"))
  for (const endpoint of ["/user", "/repos/LeiGuo0812/howard-notes/git/ref/heads/main"]) {
    const redirected = fixture()
    redirected.setGitStatus(endpoint, 302)
    assert.equal((await redirected.call("sync/begin", { commit: "a".repeat(40) })).status, 502)
    assert.ok(
      redirected.gitRequests.every(({ url }) => new URL(url).origin === "https://api.github.com"),
    )
    assert.equal(redirected.sqlite.prepare("SELECT count(*) AS n FROM sync_session").get().n, 0)
  }
})

test("cron cannot delete a replacement stage created after it read an expired synchronization", async () => {
  const f = fixture()
  await f.publish()
  f.setCommit("b".repeat(40))
  const expired = await f.start()
  await f.upload(expired)
  f.sqlite.exec("UPDATE sync_session SET expires=1")
  const batch = f.env.DB.batch.bind(f.env.DB)
  let replacement
  let injected = false
  f.env.DB.batch = async (statements) => {
    if (!injected) {
      injected = true
      f.setCommit("c".repeat(40))
      replacement = await f.start()
      await f.upload(replacement)
    }
    return batch(statements)
  }
  await worker.scheduled({}, f.env)
  assert.notEqual(replacement.syncId, expired.syncId)
  assert.equal(
    f.sqlite.prepare("SELECT sync_id FROM sync_session").get().sync_id,
    replacement.syncId,
  )
  for (const table of ["public_documents", "public_pages", "public_payloads"])
    assert.ok(
      f.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE revision=2`).get().n > 0,
      table,
    )
  assert.equal((await (await f.call("status")).json()).revision, 1)
  assert.equal((await f.call("sync/finish", { syncId: replacement.syncId })).status, 200)
  assert.equal((await (await f.call("status")).json()).revision, 2)
})

test("cron rechecks expiry before cleanup and preserves a renewed synchronization", async () => {
  const f = fixture()
  await f.publish()
  f.setCommit("b".repeat(40))
  const stage = await f.start()
  await f.upload(stage)
  f.sqlite.exec("UPDATE sync_session SET expires=1")
  const batch = f.env.DB.batch.bind(f.env.DB)
  let renewed = false
  f.env.DB.batch = async (statements) => {
    if (!renewed) {
      renewed = true
      f.sqlite.prepare("UPDATE sync_session SET expires=?").run(Date.now() + 60000)
    }
    return batch(statements)
  }
  await worker.scheduled({}, f.env)
  assert.equal(f.sqlite.prepare("SELECT sync_id FROM sync_session").get().sync_id, stage.syncId)
  assert.equal((await f.call("sync/finish", { syncId: stage.syncId })).status, 200)
  assert.equal((await (await f.call("status")).json()).revision, 2)
})
