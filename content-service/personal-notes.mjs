import { validateCatalog } from "../scripts/lib/catalog.mjs"
import { sessionResponse } from "./session.mjs"

const DAY = 86_400_000
const MAX_BODY_BYTES = 2_000_000
const MAX_RAW_BYTES = 1_500_000
const MAX_RECORD_BYTES = 1_800_000
const MAX_PRIVATE_FILE_BYTES = 20 * 1024 * 1024
const encoder = new TextEncoder()
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const editorPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/
const requestPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const hashPattern = /^[a-f0-9]{64}$/
class PersonalError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const json = (body, status = 200, extra = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  })
const hash = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function recordText(value, limit = MAX_RECORD_BYTES) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PersonalError("保存内容格式不正确。")
  const encoded = JSON.stringify(value)
  if (encoder.encode(encoded).length > limit) throw new PersonalError("保存内容过大。", 413)
  return encoded
}
function articleValue(article, raw) {
  try {
    validateCatalog({ version: 2, articles: [article] })
  } catch (error) {
    throw new PersonalError(error.message)
  }
  // A flag in the public repository is not a privacy boundary. This API only
  // stores private originals; publishing belongs to the durable publication job.
  if (article.published) throw new PersonalError("请使用发布任务将文章公开。")
  if (typeof raw !== "string") throw new PersonalError("请提供完整 Markdown 原文。")
  if (encoder.encode(raw).length > MAX_RAW_BYTES) throw new PersonalError("文章原文过大。", 413)
  return { article: recordText(article, 150_000), raw }
}
function linkText(value) {
  return value == null ? null : recordText(value, 150_000)
}
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0
function requireVersion(value, expected) {
  if (!validVersion(value) || value !== expected)
    throw new PersonalError("内容已在另一端更新，请先保留当前编辑并载入最新版本。", 409)
}
async function ownerOf(request, env, authorize) {
  const url = new URL(request.url)
  const origin = request.headers.get("Origin")
  if (
    (origin && origin !== url.origin && origin !== env.FALLBACK_ORIGIN) ||
    (request.headers.get("Sec-Fetch-Site") === "cross-site" && origin !== env.FALLBACK_ORIGIN)
  )
    throw new PersonalError("请求来源不正确。", 403)
  if (request.headers.has("X-Howard-Sync-Key"))
    throw new PersonalError("此接口需要维护账号登录。", 403)
  if (request.headers.has("Authorization")) {
    await authorize(request)
    return
  }
  if (request.headers.has("Cookie") && env.SESSION_SECRET) {
    const response = await sessionResponse(
      new Request(request.url, { method: "GET", headers: request.headers }),
      env,
      authorize,
    )
    const credentials = await response.json()
    if (response.ok && credentials?.token) return
    if (response.status >= 500) throw new PersonalError("暂时无法验证登录，请稍后重试。", 503)
  }
  throw new PersonalError("请先登录。", 401)
}
async function bodyOf(request) {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    throw new PersonalError("请求格式不正确。")
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES)
    throw new PersonalError("请求过大。", 413)
  const bytes = await boundedBytes(request, MAX_BODY_BYTES)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new PersonalError("请求格式不正确。")
  }
}
async function boundedBytes(request, limit) {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const parts = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new PersonalError("请求过大。", 413)
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}
function noteOf(row, full = true) {
  if (!row) return null
  return {
    article: JSON.parse(row.article),
    ...(full ? { raw: row.raw } : {}),
    version: row.version,
    sha: `pv:${row.version}`,
    status: row.status,
    storage: "private",
    publicLink: row.public_link ? JSON.parse(row.public_link) : null,
    sourceHash: row.source_hash,
    savedAt: new Date(row.updated_at).toISOString(),
    ...(row.deleted_at ? { deletedAt: new Date(row.deleted_at).toISOString() } : {}),
  }
}
function draftOf(row, full = true) {
  const value = JSON.parse(row.record)
  return {
    editorId: row.editor_id,
    version: row.version,
    status: row.status,
    savedAt: new Date(row.updated_at).toISOString(),
    ...(row.deleted_at ? { deletedAt: new Date(row.deleted_at).toISOString() } : {}),
    ...(full
      ? { record: value }
      : {
          title: value.form?.title || value.article?.title || value.title || "恢复稿",
          id: value.id || value.memoryId || null,
          kind: value.kind || (row.editor_id.startsWith("memory") ? "memory" : "article"),
        }),
  }
}
function fileOf(row, env) {
  return {
    id: row.id,
    fileId: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    sha256: row.sha256,
    complete: Boolean(row.complete),
    objectKey: row.object_key,
    metadata: JSON.parse(row.metadata),
    url: `${env.SITE_PREFIX || "/howard-notes/"}api/content/personal/files/${row.id}`,
    storage: { provider: "r2", key: row.object_key, private: true },
  }
}
export async function getPersonalArticle(db, id) {
  return noteOf(await db.prepare("SELECT * FROM personal_articles WHERE id=?").bind(id).first())
}
async function requestOf(db, body, operation) {
  if (!requestPattern.test(body.requestId || "")) throw new PersonalError("请提供有效的操作编号。")
  const fingerprint = await hash(encoder.encode(JSON.stringify({ operation, body })))
  const prior = await db
    .prepare("SELECT * FROM personal_requests WHERE request_id=?")
    .bind(body.requestId)
    .first()
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new PersonalError("操作编号已被其他内容使用。", 409)
    return { replay: JSON.parse(prior.response), fingerprint }
  }
  return { fingerprint }
}
function receipt(db, requestId, fingerprint, response, table, column, id) {
  // Recovery bodies live in their canonical table and bounded history, not in
  // every retry receipt. This avoids retaining another full copy per keystroke.
  const { raw: _raw, record: _record, ...compact } = response
  return db
    .prepare(
      `INSERT OR IGNORE INTO personal_requests(request_id,fingerprint,response,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${column}=? AND last_request_id=?)`,
    )
    .bind(requestId, fingerprint, JSON.stringify(compact), Date.now(), id, requestId)
}
async function resultOf(db, requestId, fingerprint) {
  const result = await db
    .prepare("SELECT fingerprint,response FROM personal_requests WHERE request_id=?")
    .bind(requestId)
    .first()
  if (!result) throw new PersonalError("内容已有更新，请保留当前编辑并重新载入。", 409)
  if (result.fingerprint !== fingerprint) throw new PersonalError("操作编号已被其他内容使用。", 409)
  return JSON.parse(result.response)
}
function historyStatement(db, id, requestId) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO personal_article_versions(article_id,version,article,raw,public_link,saved_at) SELECT id,version,article,raw,public_link,updated_at FROM personal_articles WHERE id=? AND last_request_id=?",
    )
    .bind(id, requestId)
}
async function trimArticleHistory(db, id) {
  // Store at least two recoverable originals, at most twenty, and cap the
  // remaining history at 8 MiB per article rather than growing without bound.
  await db
    .prepare(
      "DELETE FROM personal_article_versions WHERE article_id=? AND version IN (SELECT version FROM (SELECT version,ROW_NUMBER() OVER (ORDER BY version DESC) AS position,SUM(length(CAST(article AS BLOB))+length(CAST(raw AS BLOB))) OVER (ORDER BY version DESC) AS bytes FROM personal_article_versions WHERE article_id=?) WHERE position>20 OR (position>2 AND bytes>8388608))",
    )
    .bind(id, id)
    .run()
}
function attachmentStatements(db, id, article, requestId) {
  const attachments = article.attachments ?? []
  if (!Array.isArray(attachments) || attachments.length > 1000)
    throw new PersonalError("附件格式不正确。")
  const ids = [...new Set(attachments.map((value) => value?.fileId).filter(Boolean))]
  if (ids.some((value) => !editorPattern.test(value))) throw new PersonalError("附件编号不正确。")
  return [
    db
      .prepare(
        "DELETE FROM personal_attachments WHERE article_id=? AND EXISTS (SELECT 1 FROM personal_articles WHERE id=? AND last_request_id=?)",
      )
      .bind(id, id, requestId),
    db
      .prepare(
        "INSERT OR IGNORE INTO personal_attachments(article_id,file_id) SELECT a.id,j.value FROM personal_articles a,json_each(?) j WHERE a.id=? AND a.last_request_id=?",
      )
      .bind(JSON.stringify(ids), id, requestId),
  ]
}
async function saveArticle(db, body, routeId = null, imported = false, requestContext = null) {
  const operation = imported ? "import" : `save:${routeId || body.article?.id}`
  const request = await requestOf(
    db,
    requestContext?.body || body,
    requestContext?.operation || operation,
  )
  if (request.replay) return { ...request.replay, raw: body.raw, replayed: true }
  const value = articleValue(body.article, body.raw)
  const id = body.article.id
  if (routeId && routeId !== id) throw new PersonalError("文章编号不一致。")
  const prior = await db.prepare("SELECT * FROM personal_articles WHERE id=?").bind(id).first()
  const sourceHash = await hash(encoder.encode(body.raw))
  if (body.sourceHash != null && body.sourceHash !== sourceHash)
    throw new PersonalError("原文字节校验失败。", 409)
  if (imported && prior) {
    if (
      prior.source_hash === sourceHash &&
      prior.raw === body.raw &&
      same(JSON.parse(prior.article), body.article)
    )
      return { ...noteOf(prior), imported: false, replayed: true }
    throw new PersonalError("已有文章与导入原文不同，未覆盖网页内容。", 409)
  }
  if (!imported) requireVersion(body.version, prior?.version || 0)
  if (prior?.status === "TRASH") throw new PersonalError("请先从回收站恢复文章。", 409)
  const duplicate = await db
    .prepare("SELECT id FROM personal_articles WHERE file=? AND id<>?")
    .bind(body.article.file, id)
    .first()
  if (duplicate) throw new PersonalError("已有文章使用此原文路径。", 409)
  const publicLink =
    body.publicLink === undefined ? prior?.public_link || null : linkText(body.publicLink)
  const now = Date.now()
  const next = {
    id,
    version: (prior?.version || 0) + 1,
    status: "ACTIVE",
    article: value.article,
    raw: value.raw,
    source_hash: imported ? sourceHash : prior?.source_hash || null,
    public_link: publicLink,
    updated_at: now,
  }
  const response = { ...noteOf(next), status: "ACTIVE", saved: true, imported }
  const write = prior
    ? db
        .prepare(
          "UPDATE personal_articles SET file=?,version=version+1,status='ACTIVE',article=?,raw=?,public_link=?,updated_at=?,last_request_id=? WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
        )
        .bind(
          body.article.file,
          value.article,
          value.raw,
          publicLink,
          now,
          body.requestId,
          id,
          prior.version,
          body.requestId,
        )
    : db
        .prepare(
          "INSERT OR IGNORE INTO personal_articles(id,file,version,status,article,raw,source_hash,public_link,created_at,updated_at,last_request_id) SELECT ?,?,1,'ACTIVE',?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
        )
        .bind(
          id,
          body.article.file,
          value.article,
          value.raw,
          next.source_hash,
          publicLink,
          now,
          now,
          body.requestId,
          body.requestId,
        )
  await db.batch([
    write,
    historyStatement(db, id, body.requestId),
    ...attachmentStatements(db, id, body.article, body.requestId),
    receipt(db, body.requestId, request.fingerprint, response, "personal_articles", "id", id),
  ])
  const result = await resultOf(db, body.requestId, request.fingerprint)
  await trimArticleHistory(db, id)
  return { ...result, raw: body.raw }
}
// Server-side publication jobs use the identical validation/version path. This
// helper does not grant HTTP access or bypass the fixed-owner authentication.
export const persistPersonalArticle = saveArticle
async function articleAction(db, id, action, body) {
  const request = await requestOf(db, body, `${action}:${id}`)
  if (request.replay) return { ...request.replay, replayed: true }
  const row = await db.prepare("SELECT * FROM personal_articles WHERE id=?").bind(id).first()
  if (!row) throw new PersonalError("文章不存在。", 404)
  requireVersion(body.version, row.version)
  if (action === "purge") {
    if (row.status !== "TRASH") throw new PersonalError("请先将文章移入回收站。", 409)
    const response = { id, purged: true }
    await db.batch([
      db
        .prepare(
          "UPDATE personal_articles SET last_request_id=? WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
        )
        .bind(body.requestId, id, row.version, body.requestId),
      receipt(db, body.requestId, request.fingerprint, response, "personal_articles", "id", id),
      ...["personal_article_versions", "personal_attachments"].map((table) =>
        db
          .prepare(
            `DELETE FROM ${table} WHERE article_id=? AND EXISTS (SELECT 1 FROM personal_articles WHERE id=? AND last_request_id=?)`,
          )
          .bind(id, id, body.requestId),
      ),
      db
        .prepare("DELETE FROM personal_articles WHERE id=? AND last_request_id=?")
        .bind(id, body.requestId),
    ])
    return resultOf(db, body.requestId, request.fingerprint)
  }
  if (action === "restore" && (row.status !== "TRASH" || row.deleted_at <= Date.now() - 30 * DAY))
    throw new PersonalError("文章已过保留期或不在回收站。", 409)
  if (action === "delete" && row.status === "TRASH")
    return { ...noteOf(row), deleted: true, replayed: true }
  const now = Date.now()
  const status = action === "delete" ? "TRASH" : row.previous_status || "ACTIVE"
  const next = {
    ...row,
    status,
    version: row.version + 1,
    updated_at: now,
    deleted_at: action === "delete" ? now : null,
    previous_status: action === "delete" ? row.status : null,
  }
  const response = { ...noteOf(next), [action === "delete" ? "deleted" : "restored"]: true }
  await db.batch([
    db
      .prepare(
        "UPDATE personal_articles SET version=version+1,status=?,updated_at=?,deleted_at=?,previous_status=?,last_request_id=? WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
      )
      .bind(
        status,
        now,
        next.deleted_at,
        next.previous_status,
        body.requestId,
        id,
        row.version,
        body.requestId,
      ),
    historyStatement(db, id, body.requestId),
    receipt(db, body.requestId, request.fingerprint, response, "personal_articles", "id", id),
  ])
  const result = await resultOf(db, body.requestId, request.fingerprint)
  await trimArticleHistory(db, id)
  return { ...result, raw: row.raw }
}
export async function markPersonalPublished(db, id, expectedVersion, publicLink) {
  const row = await db.prepare("SELECT * FROM personal_articles WHERE id=?").bind(id).first()
  if (!row) throw new PersonalError("私密发布源不存在。", 404)
  const link = linkText(publicLink)
  if (row.status === "PUBLISHED" && row.public_link === link) return noteOf(row)
  requireVersion(expectedVersion, row.version)
  if (row.status === "TRASH") throw new PersonalError("回收站文章不能发布。", 409)
  const now = Date.now()
  const requestId = crypto.randomUUID()
  const result = await db.batch([
    db
      .prepare(
        "UPDATE personal_articles SET status='PUBLISHED',public_link=?,version=version+1,updated_at=?,last_request_id=? WHERE id=? AND version=?",
      )
      .bind(link, now, requestId, id, expectedVersion),
    historyStatement(db, id, requestId),
  ])
  if (!result[0].meta.changes)
    throw new PersonalError("发布期间私密稿已有更新，请核对新版本。", 409)
  await trimArticleHistory(db, id)
  return getPersonalArticle(db, id)
}
export const finalizePersonalNotePublication = markPersonalPublished

async function saveDraft(db, id, body) {
  const request = await requestOf(db, body, `draft-save:${id}`)
  if (request.replay) return { ...request.replay, record: body.record, replayed: true }
  const text = recordText(body.record)
  const prior = await db.prepare("SELECT * FROM personal_drafts WHERE editor_id=?").bind(id).first()
  requireVersion(body.version, prior?.version || 0)
  if (prior?.status === "TRASH") throw new PersonalError("请先恢复此草稿。", 409)
  const now = Date.now()
  const next = {
    editor_id: id,
    version: (prior?.version || 0) + 1,
    status: "ACTIVE",
    record: text,
    updated_at: now,
  }
  const response = { ...draftOf(next), saved: true }
  await db.batch([
    prior
      ? db
          .prepare(
            "UPDATE personal_drafts SET record=?,version=version+1,updated_at=?,last_request_id=? WHERE editor_id=? AND version=? AND NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
          )
          .bind(text, now, body.requestId, id, prior.version, body.requestId)
      : db
          .prepare(
            "INSERT OR IGNORE INTO personal_drafts(editor_id,version,record,status,updated_at,last_request_id) SELECT ?,1,?,'ACTIVE',?,? WHERE NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
          )
          .bind(id, text, now, body.requestId, body.requestId),
    db
      .prepare(
        "INSERT OR IGNORE INTO personal_draft_versions(editor_id,version,record,saved_at) SELECT editor_id,version,record,updated_at FROM personal_drafts WHERE editor_id=? AND last_request_id=?",
      )
      .bind(id, body.requestId),
    receipt(db, body.requestId, request.fingerprint, response, "personal_drafts", "editor_id", id),
  ])
  const result = await resultOf(db, body.requestId, request.fingerprint)
  await db
    .prepare(
      "DELETE FROM personal_draft_versions WHERE editor_id=? AND version IN (SELECT version FROM (SELECT version,ROW_NUMBER() OVER (ORDER BY version DESC) AS position,SUM(length(CAST(record AS BLOB))) OVER (ORDER BY version DESC) AS bytes FROM personal_draft_versions WHERE editor_id=?) WHERE position>5 OR (position>2 AND bytes>4194304))",
    )
    .bind(id, id)
    .run()
  return { ...result, record: body.record }
}
async function draftAction(db, id, action, body) {
  const request = await requestOf(db, body, `draft-${action}:${id}`)
  if (request.replay) return { ...request.replay, replayed: true }
  const row = await db.prepare("SELECT * FROM personal_drafts WHERE editor_id=?").bind(id).first()
  if (!row) throw new PersonalError("恢复稿不存在。", 404)
  requireVersion(body.version, row.version)
  if (action === "restore" && (row.status !== "TRASH" || row.deleted_at <= Date.now() - 30 * DAY))
    throw new PersonalError("草稿已过保留期或不在回收站。", 409)
  if (action === "delete" && row.status === "TRASH")
    return { ...draftOf(row), deleted: true, replayed: true }
  if (action === "purge" && row.status !== "TRASH") throw new PersonalError("请先删除此草稿。", 409)
  const now = Date.now()
  const next = {
    ...row,
    version: row.version + 1,
    status: action === "restore" ? "ACTIVE" : "TRASH",
    updated_at: now,
    deleted_at: action === "restore" ? null : now,
  }
  const response =
    action === "purge"
      ? { editorId: id, purged: true }
      : { ...draftOf(next), [action === "restore" ? "restored" : "deleted"]: true }
  const statements = [
    db
      .prepare(
        "UPDATE personal_drafts SET version=version+1,status=?,updated_at=?,deleted_at=?,last_request_id=? WHERE editor_id=? AND version=? AND NOT EXISTS (SELECT 1 FROM personal_requests WHERE request_id=?)",
      )
      .bind(next.status, now, next.deleted_at, body.requestId, id, row.version, body.requestId),
    receipt(db, body.requestId, request.fingerprint, response, "personal_drafts", "editor_id", id),
  ]
  if (action === "purge")
    statements.push(
      db
        .prepare(
          "DELETE FROM personal_draft_versions WHERE editor_id=? AND EXISTS (SELECT 1 FROM personal_drafts WHERE editor_id=? AND last_request_id=?)",
        )
        .bind(id, id, body.requestId),
      db
        .prepare("DELETE FROM personal_drafts WHERE editor_id=? AND last_request_id=?")
        .bind(id, body.requestId),
    )
  await db.batch(statements)
  return resultOf(db, body.requestId, request.fingerprint)
}

async function reserveFile(db, env, body) {
  const file = body.file
  if (
    !file ||
    !editorPattern.test(file.id || "") ||
    typeof file.name !== "string" ||
    !file.name ||
    file.name.length > 250 ||
    /[\u0000-\u001f]/.test(file.name) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_PRIVATE_FILE_BYTES ||
    !hashPattern.test(file.sha256 || "") ||
    typeof file.mimeType !== "string" ||
    file.mimeType.length > 150 ||
    !/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType)
  )
    throw new PersonalError("私密附件信息不正确或文件超过 20 MiB。")
  if (!env.PERSONAL_FILES_BUCKET) throw new PersonalError("私密附件存储尚未配置。", 503)
  const objectKey = `personal-files/${file.sha256}`
  const metadata = recordText(
    { ...(file.metadata || {}), storage: { provider: "r2", key: objectKey } },
    50_000,
  )
  const prior = await db.prepare("SELECT * FROM personal_files WHERE id=?").bind(file.id).first()
  if (prior) {
    if (
      prior.sha256 !== file.sha256 ||
      prior.size !== file.size ||
      prior.name !== file.name ||
      prior.mime_type !== file.mimeType
    )
      throw new PersonalError("附件编号已有不同文件，未覆盖原文件。", 409)
    return { file: fileOf(prior, env), replayed: true }
  }
  await db
    .prepare(
      "INSERT OR IGNORE INTO personal_files(id,name,mime_type,size,sha256,object_key,complete,created_at,metadata) VALUES(?,?,?,?,?,?,0,?,?)",
    )
    .bind(
      file.id,
      file.name,
      file.mimeType,
      file.size,
      file.sha256,
      objectKey,
      Date.now(),
      metadata,
    )
    .run()
  const stored = await db.prepare("SELECT * FROM personal_files WHERE id=?").bind(file.id).first()
  if (stored.sha256 !== file.sha256 || stored.size !== file.size)
    throw new PersonalError("附件编号已有不同文件。", 409)
  return { file: fileOf(stored, env) }
}
async function writeFile(request, env, db, id) {
  const row = await db.prepare("SELECT * FROM personal_files WHERE id=?").bind(id).first()
  if (!row) throw new PersonalError("请先登记附件。", 404)
  if (!env.PERSONAL_FILES_BUCKET) throw new PersonalError("私密附件存储尚未配置。", 503)
  if (Number(request.headers.get("Content-Length")) > MAX_PRIVATE_FILE_BYTES)
    throw new PersonalError("私密附件超过 20 MiB。", 413)
  const bytes = await boundedBytes(request, MAX_PRIVATE_FILE_BYTES)
  if (bytes.byteLength !== row.size || (await hash(bytes)) !== row.sha256)
    throw new PersonalError("附件内容校验失败，未修改原文件。", 409)
  if (!row.complete) {
    await env.PERSONAL_FILES_BUCKET.put(row.object_key, bytes, {
      httpMetadata: { contentType: row.mime_type },
      customMetadata: { sha256: row.sha256 },
    })
    await db
      .prepare("UPDATE personal_files SET complete=1 WHERE id=? AND sha256=? AND size=?")
      .bind(id, row.sha256, row.size)
      .run()
  }
  return json({
    file: fileOf({ ...row, complete: 1 }, env),
    saved: true,
    replayed: Boolean(row.complete),
  })
}
async function readFile(request, env, db, id) {
  const row = await db
    .prepare("SELECT * FROM personal_files WHERE id=? AND complete=1")
    .bind(id)
    .first()
  if (!row) throw new PersonalError("附件不存在。", 404)
  if (!env.PERSONAL_FILES_BUCKET) throw new PersonalError("私密附件存储暂不可用。", 503)
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Length": String(row.size),
    "Accept-Ranges": "bytes",
    ETag: `"${row.sha256}"`,
    "Content-Type": /^image\/(png|jpeg|gif|webp|avif)$/.test(row.mime_type)
      ? row.mime_type
      : "application/octet-stream",
    "Content-Disposition": `${/^image\/(png|jpeg|gif|webp|avif)$/.test(row.mime_type) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name).replaceAll("'", "%27")}`,
  }
  const range = request.headers.get("Range")
  let offset = 0,
    length = row.size,
    status = 200
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const start = match?.[1] ? Number(match[1]) : Math.max(0, row.size - Number(match?.[2]))
    const end = match?.[1]
      ? match[2]
        ? Math.min(row.size - 1, Number(match[2]))
        : row.size - 1
      : row.size - 1
    if (
      !match ||
      (!match[1] && !Number(match[2])) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= row.size ||
      end < start
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${row.size}` },
      })
    offset = start
    length = end - start + 1
    status = 206
    headers["Content-Range"] = `bytes ${start}-${end}/${row.size}`
    headers["Content-Length"] = String(length)
  }
  if (request.method === "HEAD") {
    const object = await env.PERSONAL_FILES_BUCKET.head(row.object_key)
    if (!object || object.size !== row.size)
      throw new PersonalError("附件存储缺失，请从备份恢复。", 503)
    return new Response(null, { status, headers })
  }
  const object = await env.PERSONAL_FILES_BUCKET.get(
    row.object_key,
    range ? { range: { offset, length } } : undefined,
  )
  if (!object) throw new PersonalError("附件存储缺失，请从备份恢复。", 503)
  return new Response(object.body, { status, headers })
}

function pageOf(url) {
  const page = Number(url.searchParams.get("page") || 1)
  const pageSize =
    url.searchParams.get("all") === "1" ? 5000 : Number(url.searchParams.get("pageSize") || 20)
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 5000
  )
    throw new PersonalError("分页参数不正确。")
  return { page, pageSize }
}
async function listArticles(db, url) {
  const status = url.searchParams.get("status") || "ACTIVE"
  if (!["ACTIVE", "PUBLISHED", "TRASH", "ALL"].includes(status))
    throw new PersonalError("文章状态不正确。")
  const { page, pageSize } = pageOf(url)
  const search = url.searchParams.get("q") || ""
  if (search.length > 250) throw new PersonalError("搜索文字过长。")
  const clauses = status === "ALL" ? [] : ["status=?"]
  const values = status === "ALL" ? [] : [status]
  if (search) {
    clauses.push("(instr(lower(article),lower(?))>0 OR instr(lower(raw),lower(?))>0)")
    values.push(search, search)
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""
  const count = await db
    .prepare("SELECT count(*) AS total FROM personal_articles" + where)
    .bind(...values)
    .first()
  const rows = await db
    .prepare(
      "SELECT id,version,status,article,source_hash,public_link,updated_at,deleted_at FROM personal_articles" +
        where +
        " ORDER BY updated_at DESC,id LIMIT ? OFFSET ?",
    )
    .bind(...values, pageSize, (page - 1) * pageSize)
    .all()
  return json({
    articles: rows.results.map((row) => noteOf(row, false)),
    total: count.total,
    page,
    pageSize,
    owner: true,
  })
}
async function listDrafts(db, url) {
  const status = url.searchParams.get("status") || "ACTIVE"
  if (!["ACTIVE", "TRASH"].includes(status)) throw new PersonalError("草稿状态不正确。")
  const { page, pageSize } = pageOf(url)
  const rows = await db
    .prepare(
      "SELECT editor_id,version,status,updated_at,deleted_at,json_object('form',json_object('title',json_extract(record,'$.form.title')),'article',json_object('title',json_extract(record,'$.article.title')),'title',json_extract(record,'$.title'),'id',json_extract(record,'$.id'),'memoryId',json_extract(record,'$.memoryId'),'kind',json_extract(record,'$.kind')) AS record FROM personal_drafts WHERE status=? ORDER BY updated_at DESC,editor_id LIMIT ? OFFSET ?",
    )
    .bind(status, pageSize, (page - 1) * pageSize)
    .all()
  const count = await db
    .prepare("SELECT count(*) AS total FROM personal_drafts WHERE status=?")
    .bind(status)
    .first()
  return json({
    drafts: rows.results.map((row) => draftOf(row, false)),
    total: count.total,
    page,
    pageSize,
    owner: true,
  })
}
async function exportPersonal(db, url) {
  // Pagination keeps exports small enough for a Worker. The caller combines
  // pages, and downloads private files independently with the same owner auth.
  const type = url.searchParams.get("type") || "articles"
  const tables = {
    articles: ["personal_articles", "id", null],
    drafts: ["personal_drafts", "editor_id", null],
    versions: ["personal_article_versions", "article_id", "version"],
    draftVersions: ["personal_draft_versions", "editor_id", "version"],
    files: ["personal_files", "id", null],
    attachments: ["personal_attachments", "article_id", "file_id"],
  }
  const tuple = tables[type]
  if (!tuple) throw new PersonalError("导出类型不正确。")
  const [table, key, secondary] = tuple
  const generationOf = async () => {
    try {
      const row = await db.prepare("SELECT generation FROM backups_epoch WHERE id=1").first()
      if (!Number.isSafeInteger(row?.generation) || row.generation < 0) throw new Error()
      return row.generation
    } catch {
      throw new PersonalError("导出备份保护尚未配置。", 503)
    }
  }
  const generation = await generationOf()
  const guards = await db
    .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?)")
    .bind(
      ...["insert", "update", "delete"].map((operation) => `backup_epoch_${table}_${operation}`),
    )
    .first()
  if (guards.count !== 3) throw new PersonalError("导出备份保护尚未配置。", 503)
  if (url.searchParams.has("generation")) {
    const requested = url.searchParams.get("generation")
    if (!/^\d+$/.test(requested) || !Number.isSafeInteger(Number(requested)))
      throw new PersonalError("导出版本不正确。")
    if (Number(requested) !== generation)
      throw new PersonalError("导出期间内容已有更新，请重新开始导出。", 409)
  }
  const page = Number(url.searchParams.get("page") || 1)
  const limit = 10
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new PersonalError("导出分页不正确。")
  const rows = await db
    .prepare(
      `SELECT * FROM ${table} ORDER BY ${key}${secondary ? "," + secondary : ""} LIMIT ? OFFSET ?`,
    )
    .bind(limit, (page - 1) * limit)
    .all()
  const count = await db.prepare(`SELECT count(*) AS total FROM ${table}`).first()
  if ((await generationOf()) !== generation)
    throw new PersonalError("导出期间内容已有更新，请重新开始导出。", 409)
  return json({
    format: "personal-notes-v1",
    type,
    generation,
    records: rows.results,
    page,
    pageSize: limit,
    total: count.total,
    nextPage: page * limit < count.total ? page + 1 : null,
  })
}
export async function cleanupPersonalNotes(db, now = Date.now()) {
  const cutoff = now - 30 * DAY
  await db.batch([
    ...["personal_article_versions", "personal_attachments"].map((table) =>
      db
        .prepare(
          `DELETE FROM ${table} WHERE article_id IN (SELECT id FROM personal_articles WHERE status='TRASH' AND deleted_at<=?)`,
        )
        .bind(cutoff),
    ),
    db.prepare("DELETE FROM personal_articles WHERE status='TRASH' AND deleted_at<=?").bind(cutoff),
    db
      .prepare(
        "DELETE FROM personal_draft_versions WHERE editor_id IN (SELECT editor_id FROM personal_drafts WHERE status='TRASH' AND deleted_at<=?)",
      )
      .bind(cutoff),
    db.prepare("DELETE FROM personal_drafts WHERE status='TRASH' AND deleted_at<=?").bind(cutoff),
    db.prepare("DELETE FROM personal_requests WHERE created_at<=?").bind(now - 90 * DAY),
    db.prepare(
      "DELETE FROM personal_requests WHERE request_id IN (SELECT request_id FROM (SELECT request_id,ROW_NUMBER() OVER (ORDER BY created_at DESC,request_id DESC) AS position,SUM(length(CAST(response AS BLOB))) OVER (ORDER BY created_at DESC,request_id DESC) AS bytes FROM personal_requests) WHERE position>10000 OR (position>100 AND bytes>16777216))",
    ),
  ])
  // Private R2 objects are intentionally not deleted automatically. Draft raw
  // text can reference files absent from catalogue metadata; backup retention
  // must also finish before an explicit attachment garbage-collection pass.
}
export async function personalNotesResponse(request, env, db, path, authorize) {
  try {
    const url = new URL(request.url)
    let suffix
    try {
      suffix = path
        .replace(/^personal\/?/, "")
        .split("/")
        .map((part) => {
          const decoded = decodeURIComponent(part)
          if (decoded.includes("/")) throw new Error()
          return decoded
        })
        .join("/")
    } catch {
      throw new PersonalError("接口路径不正确。")
    }
    const importing = suffix === "articles/import"
    await ownerOf(request, env, authorize)
    const writing = !["GET", "HEAD"].includes(request.method)
    if (suffix === "export" && !writing) return await exportPersonal(db, url)
    if (suffix === "articles" && !writing) return await listArticles(db, url)
    if (suffix === "drafts" && !writing) return await listDrafts(db, url)
    if (suffix === "files" && request.method === "POST")
      return json(await reserveFile(db, env, await bodyOf(request)))
    const fileMatch = /^files\/([a-zA-Z0-9][a-zA-Z0-9:_-]{0,159})$/.exec(suffix)
    if (fileMatch) {
      if (request.method === "PUT") return await writeFile(request, env, db, fileMatch[1])
      if (!writing) return await readFile(request, env, db, fileMatch[1])
      throw new PersonalError("请求方法不正确。", 405)
    }
    if (writing && request.method !== "POST") throw new PersonalError("请求方法不正确。", 405)
    if (importing) {
      if (!writing) throw new PersonalError("请求方法不正确。", 405)
      const body = await bodyOf(request)
      if (!Array.isArray(body.articles) || body.articles.length < 1 || body.articles.length > 3)
        throw new PersonalError("每批请导入 1–3 篇原文。")
      const results = []
      // Each original commits independently with optimistic guards. A partial
      // batch can safely retry after a dropped connection without overwriting.
      for (const entry of body.articles)
        results.push(
          await saveArticle(
            db,
            { ...entry, requestId: entry.requestId || crypto.randomUUID() },
            null,
            true,
          ),
        )
      return json({ imported: results.filter((value) => value.imported).length, articles: results })
    }
    if (suffix === "articles" && writing) return json(await saveArticle(db, await bodyOf(request)))
    const articleMatch =
      /^articles\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(save|delete|restore|purge|versions)(?:\/(\d+)(?:\/(restore))?)?)?$/.exec(
        suffix,
      )
    if (articleMatch) {
      const [, id, action, oldVersion, versionAction] = articleMatch
      if (!writing && (!action || (action === "versions" && !versionAction))) {
        const row = await db.prepare("SELECT * FROM personal_articles WHERE id=?").bind(id).first()
        if (!row) throw new PersonalError("文章不存在。", 404)
        if (action === "versions") {
          if (oldVersion) {
            if (!Number.isSafeInteger(Number(oldVersion)))
              throw new PersonalError("历史版本不正确。")
            const old = await db
              .prepare("SELECT * FROM personal_article_versions WHERE article_id=? AND version=?")
              .bind(id, Number(oldVersion))
              .first()
            if (!old) throw new PersonalError("此历史版本已超过保留范围。", 404)
            return json({
              article: JSON.parse(old.article),
              raw: old.raw,
              version: old.version,
              savedAt: new Date(old.saved_at).toISOString(),
              publicLink: old.public_link ? JSON.parse(old.public_link) : null,
            })
          }
          const versions = await db
            .prepare(
              "SELECT version,saved_at,length(CAST(raw AS BLOB)) AS bytes FROM personal_article_versions WHERE article_id=? ORDER BY version DESC",
            )
            .bind(id)
            .all()
          return json({
            id,
            version: row.version,
            versions: versions.results.map((value) => ({
              version: value.version,
              bytes: value.bytes,
              savedAt: new Date(value.saved_at).toISOString(),
            })),
          })
        }
        return json(noteOf(row))
      }
      if (!writing) throw new PersonalError("请求方法不正确。", 405)
      if (action === "versions" && !versionAction) throw new PersonalError("请求方法不正确。", 405)
      const body = await bodyOf(request)
      if (!action || action === "save") return json(await saveArticle(db, body, id))
      if (action === "versions" && oldVersion && versionAction === "restore") {
        const operation = `version-restore:${id}:${oldVersion}`
        const prior = await requestOf(db, body, operation)
        if (prior.replay) {
          const snapshot = await db
            .prepare("SELECT raw FROM personal_article_versions WHERE article_id=? AND version=?")
            .bind(id, prior.replay.version)
            .first()
          return json({
            ...prior.replay,
            ...(snapshot ? { raw: snapshot.raw } : {}),
            replayed: true,
          })
        }
        const old = await db
          .prepare("SELECT * FROM personal_article_versions WHERE article_id=? AND version=?")
          .bind(id, Number(oldVersion))
          .first()
        if (!old) throw new PersonalError("此历史版本已超过保留范围。", 404)
        return json(
          await saveArticle(
            db,
            {
              ...body,
              article: JSON.parse(old.article),
              raw: old.raw,
              publicLink: old.public_link ? JSON.parse(old.public_link) : null,
            },
            id,
            false,
            { operation, body },
          ),
        )
      }
      if (["delete", "restore", "purge"].includes(action))
        return json(await articleAction(db, id, action, body))
    }
    const draftMatch =
      /^drafts\/([a-zA-Z0-9][a-zA-Z0-9:_-]{0,159})(?:\/(delete|restore|purge))?$/.exec(suffix)
    if (draftMatch) {
      const [, id, action] = draftMatch
      if (!writing && !action) {
        const row = await db
          .prepare("SELECT * FROM personal_drafts WHERE editor_id=?")
          .bind(id)
          .first()
        if (!row) throw new PersonalError("恢复稿不存在。", 404)
        return json(draftOf(row))
      }
      if (!writing) throw new PersonalError("请求方法不正确。", 405)
      const body = await bodyOf(request)
      return json(action ? await draftAction(db, id, action, body) : await saveDraft(db, id, body))
    }
    throw new PersonalError("私密文库接口不存在。", 404)
  } catch (error) {
    return json(
      {
        error:
          error instanceof PersonalError || error?.status
            ? error.message
            : "私密文库暂时不可用，请稍后重试。",
      },
      error.status || 503,
    )
  }
}
