import { sessionResponse } from "./session.mjs"
import { validateCatalog } from "../scripts/lib/catalog.mjs"
import { validateSite, topicList } from "../scripts/lib/site-settings.mjs"

const encoder = new TextEncoder()
const MAX_ROW_BYTES = 1_900_000
const MAX_BODY_BYTES = 2_500_000
const SYNC_TTL = 30 * 60 * 1000
const SHA = /^[a-f0-9]{40}$/
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const json = (body, status = 200, extra = {}) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  })
class HttpError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
function dbSession(env) {
  return env.DB.withSession ? env.DB.withSession("first-primary") : env.DB
}
async function state(db) {
  return db.prepare("SELECT * FROM content_state WHERE id = 1").first()
}
async function payload(db, revision, name) {
  const row = await db
    .prepare("SELECT body FROM public_payloads WHERE revision = ? AND name = ?")
    .bind(revision, name)
    .first()
  return row ? JSON.parse(row.body) : null
}
const equalSecret = (a, b) => {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
async function github(fetcher, env, token, path) {
  const response = await fetcher(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Howard-Notes-Content",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    // Workers only support follow/manual. Keep credentials on the API origin
    // and let the non-OK response below reject any unexpected redirect.
    redirect: "manual",
  })
  if (!response.ok)
    throw new HttpError(
      response.status === 401
        ? "登录已过期，请重新登录后同步。"
        : "无法验证 GitHub 内容，请稍后重试。",
      response.status === 401 ? 401 : 502,
    )
  return response.json()
}
async function authorize(request, env, fetcher) {
  const token = /^Bearer ([^\s]+)$/.exec(request.headers.get("Authorization") || "")?.[1]
  if (!token) throw new HttpError("请先登录。", 401)
  const origin = request.headers.get("Origin")
  if (origin && origin !== new URL(request.url).origin && origin !== env.FALLBACK_ORIGIN)
    throw new HttpError("请求来源不正确。", 403)
  const automation = equalSecret(request.headers.get("X-Howard-Sync-Key"), env.SYNC_SECRET)
  if (!automation) {
    const [user, repo] = await Promise.all([
      github(fetcher, env, token, "/user"),
      github(fetcher, env, token, `/repos/${env.REPOSITORY}`),
    ])
    if (String(user.id) !== env.OWNER_ID || !repo.permissions?.push)
      throw new HttpError("此账号没有维护权限。", 403)
  }
  return token
}
async function bodyOf(request) {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    throw new HttpError("请求格式不正确。")
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES)
    throw new HttpError("同步分块过大。", 413)
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAX_BODY_BYTES) throw new HttpError("同步分块过大。", 413)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new HttpError("请求格式不正确。")
  }
}
function rowBody(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (encoder.encode(text).length > MAX_ROW_BYTES) throw new HttpError("文章或索引过大。", 413)
  return text
}
async function headCommit(fetcher, env, token) {
  return (await github(fetcher, env, token, `/repos/${env.REPOSITORY}/git/ref/heads/${env.BRANCH}`))
    .object.sha
}
async function canonical(fetcher, env, token, commit) {
  if (!SHA.test(commit || "")) throw new HttpError("提交标识不正确。")
  if ((await headCommit(fetcher, env, token)) !== commit)
    throw new HttpError("仓库已有更新，请同步最新内容。", 409)
  const gitCommit = await github(
    fetcher,
    env,
    token,
    `/repos/${env.REPOSITORY}/git/commits/${commit}`,
  )
  const tree = await github(
    fetcher,
    env,
    token,
    `/repos/${env.REPOSITORY}/git/trees/${gitCommit.tree.sha}?recursive=1`,
  )
  if (tree.truncated) throw new HttpError("仓库目录过大，无法验证完整内容。", 422)
  const entries = new Map(tree.tree.map((entry) => [entry.path, entry]))
  const readJson = async (path) => {
    const entry = entries.get(path)
    if (entry?.type !== "blob") throw new HttpError("仓库配置缺失。", 422)
    const blob = await github(
      fetcher,
      env,
      token,
      `/repos/${env.REPOSITORY}/git/blobs/${entry.sha}`,
    )
    try {
      return JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(blob.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
        ),
      )
    } catch {
      throw new HttpError("仓库配置格式不正确。", 422)
    }
  }
  const [catalog, settings] = await Promise.all([
    readJson("library/catalog.json"),
    readJson("library/site.json"),
  ])
  validateCatalog(catalog)
  validateSite(settings)
  const published = catalog.articles.filter((article) => article.published)
  const documents = published.map((article) => {
    const entry = entries.get(`library/${article.file}`)
    if (entry?.type !== "blob") throw new HttpError("公开文章的源文件缺失。", 422)
    return { id: article.id, file: article.file, sourceSha: entry.sha }
  })
  return { catalog: { ...catalog, articles: published }, settings, documents }
}
async function gitBlobSha(text) {
  const bytes = encoder.encode(text)
  const prefix = encoder.encode(`blob ${bytes.byteLength}\0`)
  const buffer = new Uint8Array(prefix.length + bytes.length)
  buffer.set(prefix)
  buffer.set(bytes, prefix.length)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", buffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
function validPath(path) {
  return (
    typeof path === "string" &&
    path.length < 500 &&
    !path.startsWith("/") &&
    !/[\\?#%\u0000-\u0020]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  )
}
function allowedRoutes(manifest, contentIndex, blogData) {
  const routes = new Set([
    "index",
    "404",
    "about",
    "topics/index",
    "tags/index",
    "notes/index",
    "collections/index",
  ])
  for (const doc of manifest.documents) routes.add(`notes/${doc.id}`)
  for (const topic of topicList(manifest.settings, manifest.catalog.articles))
    routes.add(`topics/${topic.id}`)
  for (const item of manifest.settings.collections) routes.add(`collections/${item.id}`)
  for (const tag of blogData?.tags || []) {
    if (!validPath(`tags/${tag.id}`)) throw new HttpError("标签网址不正确。")
    routes.add(`tags/${tag.id}`)
  }
  for (const slug of Object.keys(contentIndex || {})) {
    if (/^tags\//.test(slug) && validPath(slug)) routes.add(slug)
  }
  return routes
}
async function activeSync(db, syncId) {
  const session = await db
    .prepare("SELECT * FROM sync_session WHERE id = 1 AND sync_id = ? AND expires > ?")
    .bind(syncId || "", Date.now())
    .first()
  if (!session) throw new HttpError("同步已失效，请重新同步。", 409)
  return { ...session, manifest: JSON.parse(session.manifest) }
}
function insertStage(db, table, columns, values, syncId) {
  const names = columns.join(", ")
  const marks = columns.map(() => "?").join(", ")
  return db
    .prepare(
      `INSERT OR REPLACE INTO ${table} (${names}) SELECT ${marks} WHERE EXISTS (SELECT 1 FROM sync_session WHERE id = 1 AND sync_id = ? AND expires > ?)`,
    )
    .bind(...values, syncId, Date.now())
}
async function beginSync(request, env, db, fetcher, token, body) {
  const manifest = await canonical(fetcher, env, token, body.commit)
  const current = await state(db)
  if (current.commit_sha === body.commit && !body.force)
    return json({ status: "synchronized", commit: body.commit, revision: current.revision })
  const syncId = crypto.randomUUID()
  const revision = current.revision + 1
  const result = await db.batch([
    ...["public_documents", "public_pages", "public_payloads"].map((table) =>
      db
        .prepare(
          `DELETE FROM ${table} WHERE revision > ? AND EXISTS (SELECT 1 FROM content_state WHERE id = 1 AND revision = ?)`,
        )
        .bind(current.revision, current.revision),
    ),
    db
      .prepare(
        "INSERT OR REPLACE INTO sync_session (id,sync_id,revision,base_revision,commit_sha,manifest,expires) SELECT 1,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM content_state WHERE id = 1 AND revision = ?)",
      )
      .bind(
        syncId,
        revision,
        current.revision,
        body.commit,
        rowBody(manifest),
        Date.now() + SYNC_TTL,
        current.revision,
      ),
  ])
  if (!result.at(-1).meta.changes) throw new HttpError("公开内容已有更新，请重新同步。", 409)
  await db.batch([
    db
      .prepare(
        "INSERT OR REPLACE INTO public_documents (revision,id,source_sha,body) SELECT ?,d.id,d.source_sha,d.body FROM public_documents d WHERE d.revision = ? AND EXISTS (SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.id') = d.id AND json_extract(j.value,'$.sourceSha') = d.source_sha) AND EXISTS (SELECT 1 FROM sync_session WHERE sync_id = ?)",
      )
      .bind(revision, current.revision, JSON.stringify(manifest.documents), syncId),
    db
      .prepare(
        "INSERT OR REPLACE INTO public_pages (revision,path,body,page_hash) SELECT ?,path,body,page_hash FROM public_pages WHERE revision = ? AND EXISTS (SELECT 1 FROM sync_session WHERE sync_id = ?)",
      )
      .bind(revision, current.revision, syncId),
  ])
  const reusable = await db
    .prepare("SELECT id FROM public_documents WHERE revision = ?")
    .bind(revision)
    .all()
  return json({
    syncId,
    revision,
    reusableDocuments: reusable.results.map((doc) => doc.id),
    currentCommit: current.commit_sha,
    maxChunkItems: 20,
    maxChunkBytes: MAX_BODY_BYTES,
  })
}
async function chunkSync(db, body) {
  const session = await activeSync(db, body.syncId)
  const documents = body.documents || [],
    pages = body.pages || []
  if (!Array.isArray(documents) || !Array.isArray(pages) || documents.length + pages.length > 20)
    throw new HttpError("同步分块数量不正确。")
  const canonicalDocs = new Map(session.manifest.documents.map((doc) => [doc.id, doc]))
  const writes = []
  for (const doc of documents) {
    const canonicalDoc = canonicalDocs.get(doc.id)
    if (
      !canonicalDoc ||
      doc.file !== canonicalDoc.file ||
      typeof doc.source !== "string" ||
      doc.sourceSha !== canonicalDoc.sourceSha ||
      (await gitBlobSha(doc.source)) !== canonicalDoc.sourceSha
    )
      throw new HttpError("文章与 GitHub 当前公开版本不一致。", 409)
    writes.push(
      insertStage(
        db,
        "public_documents",
        ["revision", "id", "source_sha", "body"],
        [session.revision, doc.id, doc.sourceSha, rowBody(doc)],
        body.syncId,
      ),
    )
  }
  for (const page of pages) {
    if (
      !validPath(page.path) ||
      typeof page.html !== "string" ||
      !page.html.includes("<html") ||
      !page.html.includes("</html>")
    )
      throw new HttpError("页面格式不正确。")
    if (
      page.path.startsWith("notes/") &&
      page.path !== "notes/index" &&
      !canonicalDocs.has(page.path.slice(6))
    )
      throw new HttpError("未公开文章不能同步。", 403)
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(page.html)))
    const pageHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    writes.push(
      insertStage(
        db,
        "public_pages",
        ["revision", "path", "body", "page_hash"],
        [session.revision, page.path, rowBody(page.html), pageHash],
        body.syncId,
      ),
    )
  }
  for (const name of ["contentIndex", "blogData", "shell"]) {
    if (body[name] !== undefined) {
      if (!body[name] || typeof body[name] !== "object") throw new HttpError("索引格式不正确。")
      if (name === "contentIndex")
        for (const slug of Object.keys(body[name]))
          if (
            !validPath(slug) ||
            (slug.startsWith("notes/") &&
              slug !== "notes/index" &&
              !canonicalDocs.has(slug.slice(6)))
          )
            throw new HttpError("搜索索引含有未公开文章。", 403)
      if (
        name === "blogData" &&
        (body[name].articles || []).some((row) => !canonicalDocs.has(row.id))
      )
        throw new HttpError("首页索引含有未公开文章。", 403)
      writes.push(
        insertStage(
          db,
          "public_payloads",
          ["revision", "name", "body"],
          [session.revision, name, rowBody(body[name])],
          body.syncId,
        ),
      )
    }
  }
  if (!writes.length) throw new HttpError("空同步分块。")
  const result = await db.batch(writes)
  if (result.some((row) => !row.meta.changes)) throw new HttpError("同步已被更新任务替代。", 409)
  return json({ status: "staged", revision: session.revision })
}
async function finishSync(env, db, fetcher, token, body) {
  const session = await activeSync(db, body.syncId)
  if ((await headCommit(fetcher, env, token)) !== session.commit_sha)
    throw new HttpError("仓库已有更新，请同步最新内容。", 409)
  // Completeness only needs route keys, settings and tag IDs. Have SQLite read
  // those fields so a Free Worker never parses the full search-index text here.
  const [docs, pages, indexRows, blogMetadata, oldShell, newShell] = await Promise.all([
    db
      .prepare("SELECT id,source_sha FROM public_documents WHERE revision = ?")
      .bind(session.revision)
      .all(),
    db.prepare("SELECT path FROM public_pages WHERE revision = ?").bind(session.revision).all(),
    db
      .prepare(
        "SELECT j.key AS slug FROM public_payloads p LEFT JOIN json_each(p.body) j ON 1 = 1 WHERE p.revision = ? AND p.name = 'contentIndex'",
      )
      .bind(session.revision)
      .all(),
    db
      .prepare(
        "SELECT json_extract(body,'$.settings') AS settings,json_type(body,'$.settings') AS settings_type,json_extract(body,'$.tags') AS tags,json_type(body,'$.tags') AS tags_type FROM public_payloads WHERE revision = ? AND name = 'blogData'",
      )
      .bind(session.revision)
      .first(),
    db
      .prepare("SELECT body FROM public_payloads WHERE revision = ? AND name = 'shell'")
      .bind(session.base_revision)
      .first(),
    db
      .prepare("SELECT body FROM public_payloads WHERE revision = ? AND name = 'shell'")
      .bind(session.revision)
      .first(),
  ])
  const contentIndex = indexRows.results.length
    ? Object.fromEntries(
        indexRows.results.filter((row) => row.slug !== null).map((row) => [row.slug, null]),
      )
    : null
  const blogData = blogMetadata
    ? {
        settings:
          blogMetadata.settings_type === "object" ? JSON.parse(blogMetadata.settings) : null,
        tags: blogMetadata.tags_type === "array" ? JSON.parse(blogMetadata.tags) : [],
      }
    : null
  const actualDocs = new Map(docs.results.map((doc) => [doc.id, doc.source_sha]))
  if (
    actualDocs.size !== session.manifest.documents.length ||
    session.manifest.documents.some((doc) => actualDocs.get(doc.id) !== doc.sourceSha)
  )
    throw new HttpError("文章同步未完成，请重试。", 409)
  if (
    !contentIndex ||
    !blogData ||
    JSON.stringify(blogData.settings) !== JSON.stringify(session.manifest.settings)
  )
    throw new HttpError("页面设置或索引尚未同步完成。", 409)
  const expected = allowedRoutes(session.manifest, contentIndex, blogData)
  await db
    .prepare(
      "DELETE FROM public_pages WHERE revision = ? AND path NOT IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM sync_session WHERE sync_id = ?)",
    )
    .bind(session.revision, JSON.stringify([...expected]), body.syncId)
    .run()
  const actual = new Set(
    pages.results.filter((page) => expected.has(page.path)).map((page) => page.path),
  )
  if (actual.size !== expected.size || [...expected].some((path) => !actual.has(path)))
    throw new HttpError("公开页面同步未完成，请重试。", 409)
  const statements = [
    insertStage(
      db,
      "public_payloads",
      ["revision", "name", "body"],
      [session.revision, "catalog", rowBody(session.manifest.catalog)],
      body.syncId,
    ),
    insertStage(
      db,
      "public_payloads",
      ["revision", "name", "body"],
      [session.revision, "settings", rowBody(session.manifest.settings)],
      body.syncId,
    ),
  ]
  if (!newShell && oldShell)
    statements.push(
      insertStage(
        db,
        "public_payloads",
        ["revision", "name", "body"],
        // This is already validated JSON from the previous public revision.
        [session.revision, "shell", oldShell.body],
        body.syncId,
      ),
    )
  if (!newShell && !oldShell) throw new HttpError("网站资源模板缺失。", 409)
  statements.push(
    db
      .prepare(
        "UPDATE content_state SET revision = ?,commit_sha = ?,updated_at = ? WHERE id = 1 AND revision = ? AND EXISTS (SELECT 1 FROM sync_session WHERE id = 1 AND sync_id = ? AND expires > ?)",
      )
      .bind(
        session.revision,
        session.commit_sha,
        Date.now(),
        session.base_revision,
        body.syncId,
        Date.now(),
      ),
  )
  const result = await db.batch(statements)
  if (!result.at(-1).meta.changes) throw new HttpError("同步已被更新任务替代。", 409)
  await db.prepare("DELETE FROM sync_session WHERE sync_id = ?").bind(body.syncId).run()
  // Keep one previous snapshot briefly for in-flight requests, never indefinite history.
  await cleanup(db, session.revision)
  return json({ status: "synchronized", commit: session.commit_sha, revision: session.revision })
}
async function cleanup(db, activeRevision) {
  await db.batch(
    ["public_documents", "public_pages", "public_payloads"].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE revision < ?`).bind(Math.max(0, activeRevision - 1)),
    ),
  )
}
const escapeXml = (value) =>
  String(value ?? "").replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch],
  )
async function publicRead(request, env, db, path, current) {
  const origin = new URL(request.url).origin
  const base = origin + env.SITE_PREFIX.replace(/\/$/, "")
  if (path === "config")
    return json({
      version: 1,
      enabled: true,
      apiBase: env.SITE_PREFIX + "api/content",
      revision: current.revision,
      commit: current.commit_sha,
      updatedAt: current.updated_at,
    })
  if (path === "snapshot") {
    const rawPayload = async (name) =>
      (
        await db
          .prepare("SELECT body FROM public_payloads WHERE revision = ? AND name = ?")
          .bind(current.revision, name)
          .first()
      )?.body || "null"
    const [documents, catalog, settings, blogData, contentIndex, pages] = await Promise.all([
      db
        .prepare("SELECT body FROM public_documents WHERE revision = ? ORDER BY id")
        .bind(current.revision)
        .all(),
      rawPayload("catalog"),
      rawPayload("settings"),
      rawPayload("blogData"),
      rawPayload("contentIndex"),
      db
        .prepare("SELECT path,page_hash FROM public_pages WHERE revision = ?")
        .bind(current.revision)
        .all(),
    ])
    // Stored JSON has already been validated. Avoid reparsing and serializing every
    // Markdown/AST/HTML document on a Free Worker during maintenance synchronization.
    return new Response(
      `{"revision":${current.revision},"commit":${JSON.stringify(current.commit_sha)},"documents":[${documents.results.map((row) => row.body).join(",")}],"catalog":${catalog},"settings":${settings},"blogData":${blogData},"contentIndex":${contentIndex},"pageHashes":${JSON.stringify(Object.fromEntries(pages.results.map((page) => [page.path, page.page_hash])))}}`,
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  }
  if (["shell", "contentIndex", "blogData", "settings", "catalog"].includes(path)) {
    const value = await db
      .prepare("SELECT body FROM public_payloads WHERE revision = ? AND name = ?")
      .bind(current.revision, path)
      .first()
    return value
      ? new Response(value.body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-cache",
            ETag: `"${current.revision}-${path}"`,
            "X-Content-Type-Options": "nosniff",
          },
        })
      : json({ error: "内容尚未初始化。" }, 503)
  }
  if (path === "status") {
    return json({
      revision: current.revision,
      commit: current.commit_sha,
      updatedAt: current.updated_at,
    })
  }
  if (path === "index.xml") {
    const settings = await payload(db, current.revision, "settings")
    const blogData = await payload(db, current.revision, "blogData")
    const items = (blogData?.articles || [])
      .map(
        (article) =>
          `<item><title>${escapeXml(article.title)}</title><link>${base}/notes/${article.id}</link><guid isPermaLink="true">${base}/notes/${article.id}</guid><pubDate>${new Date(article.modified + "T00:00:00+08:00").toUTCString()}</pubDate><description>${escapeXml(article.excerpt)}</description></item>`,
      )
      .join("")
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(settings?.brand?.name)}</title><link>${base}/</link><description>${escapeXml(settings?.brand?.subtitle)}</description>${items}</channel></rss>`,
      {
        headers: {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      },
    )
  }
  if (path === "sitemap.xml") {
    const pages = await db
      .prepare("SELECT path FROM public_pages WHERE revision = ? AND path != '404' ORDER BY path")
      .bind(current.revision)
      .all()
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.results.map(({ path }) => `<url><loc>${escapeXml(base + "/" + (path === "index" ? "" : path))}</loc></url>`).join("")}</urlset>`,
      {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" },
      },
    )
  }
  return json({ error: "接口不存在。" }, 404)
}
export async function handle(request, env, ctx = {}, fetcher = fetch) {
  const url = new URL(request.url)
  const prefix = env.SITE_PREFIX || "/howard-notes/"
  const apiPrefix = prefix + "api/content/"
  if (url.pathname === apiPrefix + "session")
    return sessionResponse(request, env, (value) => authorize(value, env, fetcher))
  const origin = request.headers.get("Origin")
  const allowOrigin = origin === env.FALLBACK_ORIGIN || origin === url.origin ? origin : null
  const cors = { "Access-Control-Allow-Origin": allowOrigin || "*", Vary: "Origin" }
  if (request.method === "OPTIONS" && url.pathname.startsWith(apiPrefix)) {
    if (!allowOrigin) return json({ error: "请求来源不正确。" }, 403)
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Howard-Sync-Key",
        "Access-Control-Max-Age": "600",
      },
    })
  }
  try {
    const db = dbSession(env)
    if (url.pathname === "/health")
      return json({ status: "ready", service: "howard-notes-content" })
    if (url.pathname === "/" || url.pathname === prefix.slice(0, -1))
      return new Response(null, {
        status: 302,
        headers: { Location: prefix, "Cache-Control": "no-cache" },
      })
    const isApi = url.pathname.startsWith(apiPrefix)
    const route = isApi ? url.pathname.slice(apiPrefix.length) : url.pathname.slice(prefix.length)
    let response
    if (isApi && route.startsWith("sync/")) {
      if (request.method !== "POST") throw new HttpError("请求方法不正确。", 405)
      const token = await authorize(request, env, fetcher)
      const body = await bodyOf(request)
      if (route === "sync/begin") response = await beginSync(request, env, db, fetcher, token, body)
      else if (route === "sync/chunk") response = await chunkSync(db, body)
      else if (route === "sync/finish") response = await finishSync(env, db, fetcher, token, body)
      else throw new HttpError("接口不存在。", 404)
    } else if (isApi) {
      if (!["GET", "HEAD"].includes(request.method)) throw new HttpError("请求方法不正确。", 405)
      response = await publicRead(request, env, db, route, await state(db))
    } else {
      const current = await state(db)
      if (url.pathname === "/robots.txt" || route === "robots.txt")
        response = new Response(
          `User-agent: *\nAllow: /\nSitemap: ${url.origin}${prefix}sitemap.xml\n`,
          { headers: { "Content-Type": "text/plain", "Cache-Control": "no-cache" } },
        )
      else if (url.pathname === "/sitemap.xml" || ["sitemap.xml", "index.xml"].includes(route))
        response = await publicRead(
          request,
          env,
          db,
          url.pathname === "/sitemap.xml" ? "sitemap.xml" : route,
          current,
        )
      else if (route === "runtime-config.json")
        response = await publicRead(request, env, db, "config", current)
      else if (route === "static/contentIndex.json")
        response = await publicRead(request, env, db, "contentIndex", current)
      else if (
        url.pathname.startsWith(prefix) &&
        !/^(admin\/|maintenance-assets\/|static\/|assets\/)/.test(route) &&
        (!/\.[a-z0-9]{1,8}$/i.test(route.replace(/\.html$/, "")) ||
          /^(notes|topics|tags|collections)\//.test(route))
      ) {
        let path
        try {
          path =
            decodeURIComponent(route)
              .replace(/\.html$/, "")
              .replace(/\/$/, "") || "index"
        } catch {
          throw new HttpError("页面地址不正确。", 404)
        }
        if (!validPath(path)) throw new HttpError("页面地址不正确。", 404)
        if (["topics", "tags", "notes", "collections"].includes(path)) path += "/index"
        const page = await db
          .prepare("SELECT body FROM public_pages WHERE revision = ? AND path = ?")
          .bind(current.revision, path)
          .first()
        const alias = /^((?:notes|topics|tags|collections)\/.+)-p([1-9]\d*)$/.exec(path)
        if (!page && alias && Number(alias[2]) >= 2) {
          const target = await db
            .prepare("SELECT path FROM public_pages WHERE revision = ? AND path = ?")
            .bind(current.revision, alias[1])
            .first()
          if (target) {
            url.pathname = prefix + alias[1]
            url.searchParams.set("page", alias[2])
            return new Response(null, {
              status: 302,
              headers: { Location: url.href, "Cache-Control": "no-cache" },
            })
          }
        }
        const unavailable = page
          ? null
          : await db
              .prepare("SELECT body FROM public_pages WHERE revision = ? AND path = '404'")
              .bind(current.revision)
              .first()
        response = page
          ? new Response(
              page.body.replace(
                /data-runtime-revision="[^"]*"/,
                `data-runtime-revision="${current.revision}"`,
              ),
              {
                status: path === "404" ? 404 : 200,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-cache",
                  ETag: `"${current.revision}-${encodeURIComponent(path)}"`,
                  "X-Howard-Revision": String(current.revision),
                  "X-Howard-Commit": current.commit_sha,
                  "X-Content-Type-Options": "nosniff",
                },
              },
            )
          : new Response(
              unavailable?.body.replace(
                /data-runtime-revision="[^"]*"/,
                `data-runtime-revision="${current.revision}"`,
              ) ||
                '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>文章不存在 · Howard</title></head><body><main><h1>文章不存在或尚未公开</h1><a href="' +
                  prefix +
                  '">返回首页</a></main></body></html>',
              {
                status: 404,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              },
            )
      } else {
        if (!env.ASSETS) throw new HttpError("网站资源尚未部署。", 503)
        const assetURL = new URL(request.url)
        response = await env.ASSETS.fetch(new Request(assetURL, request))
      }
    }
    if (request.method === "HEAD") response = new Response(null, response)
    if (isApi) for (const [key, value] of Object.entries(cors)) response.headers.set(key, value)
    return response
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error("content-service", url.pathname, error?.name, error?.message, error?.stack)
    }
    return json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "内容服务暂时不可用；已保存的 GitHub 内容不会丢失。",
      },
      error instanceof HttpError ? error.status : 503,
      cors,
    )
  }
}
export default {
  fetch: handle,
  async scheduled(_event, env) {
    const db = dbSession(env)
    const current = await state(db)
    const sync = await db.prepare("SELECT * FROM sync_session WHERE id = 1").first()
    if (sync && sync.expires < Date.now()) {
      const cutoff = Date.now()
      await db.batch([
        ...["public_documents", "public_pages", "public_payloads"].map((table) =>
          db
            .prepare(
              `DELETE FROM ${table} WHERE revision > (SELECT revision FROM content_state WHERE id = 1) AND EXISTS (SELECT 1 FROM sync_session WHERE sync_id = ? AND expires < ?)`,
            )
            .bind(sync.sync_id, cutoff),
        ),
        db
          .prepare("DELETE FROM sync_session WHERE sync_id = ? AND expires < ?")
          .bind(sync.sync_id, cutoff),
      ])
    }
    await cleanup(db, current.revision)
  },
}
