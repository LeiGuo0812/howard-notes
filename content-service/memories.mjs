import { sessionResponse } from "./session.mjs"

const DAY = 86_400_000
const MAX_BODY_BYTES = 1_900_000
const MAX_CARD_BYTES = 1_800_000
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_CHUNK_BYTES = 600 * 1024
const encoder = new TextEncoder()
const visibilityValues = new Set(["PUBLIC", "PROTECTED", "PRIVATE"])
const statusValues = new Set(["NORMAL", "ARCHIVED", "TRASH"])
const filePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/
const requestPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
class MemoryError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  })
const secretEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false
  let different = 0
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return different === 0
}
const digest = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
const decodeBase64 = (value) => {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(value)
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
function decodeChunk(value) {
  if (typeof value !== "string" || value.length % 4 !== 0)
    throw new MemoryError("附件分块格式不正确。")
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const expectedSize = (value.length / 4) * 3 - padding
  if (expectedSize > MAX_CHUNK_BYTES) throw new MemoryError("附件分块过大。", 413)
  try {
    const data =
      typeof Uint8Array.fromBase64 === "function"
        ? Uint8Array.fromBase64(value, { lastChunkHandling: "strict" })
        : decodeBase64(value)
    // Native decoders ignore ASCII whitespace. Any ignored characters change
    // the expected byte count, so reject them without rescanning the input.
    if (data.length !== expectedSize) throw new Error()
    if (padding) {
      // atob accepts nonzero overflow bits; enforce native strict semantics in
      // the fallback too, using only the final meaningful base64 character.
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
      const last = alphabet.indexOf(value[value.length - padding - 1])
      if (last < 0 || (last & (padding === 2 ? 15 : 3)) !== 0) throw new Error()
    }
    return data
  } catch {
    throw new MemoryError("附件分块格式不正确。")
  }
}
// Even files split into 1,000 tiny chunks use at most 40 D1 reads per request.
// Smaller files use one row per page to avoid buffering multi-megabyte D1 JSON.
const chunkPageSize = (total) => Math.max(1, Math.ceil(total / 40))
async function fileDigest(db, id, total, size) {
  // Workers supplies a native streaming digest that never retains the whole
  // file. The standard Web Crypto fallback is for local Node test runtimes.
  const stream =
    typeof crypto.DigestStream === "function" ? new crypto.DigestStream("SHA-256") : null
  const writer = stream?.getWriter()
  if (stream) void stream.digest.catch(() => {})
  const fallback = writer ? null : new Uint8Array(size)
  let index = 0,
    offset = 0
  try {
    while (index < total) {
      const rows = await db
        .prepare(
          "SELECT chunk_index,size,data FROM memory_file_chunks WHERE file_id=? AND chunk_index>=? ORDER BY chunk_index LIMIT ?",
        )
        .bind(id, index, chunkPageSize(total))
        .all()
      if (!rows.results.length) throw new MemoryError("附件分块不完整。")
      for (const row of rows.results) {
        if (row.chunk_index !== index++ || index > total) throw new MemoryError("附件分块不完整。")
        const bytes = decodeBase64(row.data)
        if (bytes.length !== row.size || offset + bytes.length > size)
          throw new MemoryError("附件分块长度不一致。")
        if (writer) await writer.write(bytes)
        else fallback.set(bytes, offset)
        offset += bytes.length
      }
    }
    if (offset !== size) throw new MemoryError("附件分块长度不一致。")
    if (!writer) return digest(fallback)
    await writer.close()
    return [...new Uint8Array(await stream.digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  } catch (error) {
    await writer?.abort(error).catch(() => {})
    throw error
  } finally {
    writer?.releaseLock()
  }
}
const date = (value, fallback) => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) {
    if (fallback) return fallback
    throw new MemoryError("记忆卡时间不正确。")
  }
  return value
}
function tagsOf(content, supplied) {
  if (supplied != null && !Array.isArray(supplied)) throw new MemoryError("标签格式不正确。")
  const text = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, " ")
  const inferred = [
    ...text.matchAll(/(?:^|[\s(（])#([\p{L}\p{N}_\-/]+)(?=$|[\s.,，。!！?？:：;；)）])/gu),
  ].map((match) => match[1])
  const values = supplied ?? inferred
  if (values.length > 200) throw new MemoryError("标签数量过多。")
  return [
    ...new Set(values.map((tag) => String(tag).replace(/^#/, "").trim()).filter(Boolean)),
  ].map((tag) => {
    if (tag.length > 160 || /[\u0000-\u001f]/.test(tag)) throw new MemoryError("标签格式不正确。")
    return tag
  })
}
function cardValue(value, { imported = false, prior = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MemoryError("记忆卡格式不正确。")
  const now = new Date().toISOString()
  const content = value.content ?? prior?.content
  if (typeof content !== "string" || (!imported && !content.trim()))
    throw new MemoryError("请填写记忆卡内容。")
  const visibility = value.visibility ?? prior?.visibility ?? "PRIVATE"
  const status = value.status ?? prior?.status ?? "NORMAL"
  if (!visibilityValues.has(visibility) || !statusValues.has(status))
    throw new MemoryError("记忆卡可见性或状态不正确。")
  const attachments = value.attachments ?? prior?.attachments ?? []
  const relations = value.relations ?? prior?.relations ?? []
  if (!Array.isArray(attachments) || attachments.length > 1000 || !Array.isArray(relations))
    throw new MemoryError("附件或关联格式不正确。")
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") throw new MemoryError("附件格式不正确。")
    if (attachment.fileId != null && !filePattern.test(attachment.fileId))
      throw new MemoryError("附件标识不正确。")
  }
  const result = {
    ...(prior || {}),
    content,
    created: imported ? date(value.created, null) : (prior?.created ?? now),
    modified: imported ? date(value.modified ?? value.created, null) : now,
    visibility,
    status,
    tags: tagsOf(content, value.tags ?? (value.content == null ? prior?.tags : undefined)),
    attachments,
    relations,
    pinned: value.pinned ?? prior?.pinned ?? false,
  }
  if (typeof result.pinned !== "boolean") throw new MemoryError("置顶状态不正确。")
  if (imported) {
    result.source = value.source ?? null
    result.raw = value.raw ?? null
    if (value.deletedAt) result.deletedAt = date(value.deletedAt, null)
  }
  if (encoder.encode(JSON.stringify(result)).length > MAX_CARD_BYTES)
    throw new MemoryError("记忆卡内容过大。", 413)
  return result
}
function attachmentSourcePath(attachment) {
  for (const value of [
    attachment.sourcePath,
    attachment.sourceUrl,
    attachment.externalLink,
    attachment.originalUrl,
    attachment.url,
  ]) {
    if (typeof value !== "string" || !value || /[\\\u0000-\u001f]/.test(value)) continue
    try {
      const url = new URL(value, "https://source.invalid/")
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url.pathname
    } catch {
      /* An invalid source URL never becomes a public attachment hint. */
    }
  }
  return undefined
}
function visibleCard(row, owner, env) {
  const card = { ...JSON.parse(row.body), id: row.id, version: row.version }
  if (row.deleted_at != null) {
    card.deletedAt = new Date(row.deleted_at).toISOString()
    card.expiresAt = new Date(row.deleted_at + 30 * DAY).toISOString()
  }
  card.attachments = card.attachments.map((attachment) => {
    const output = owner
      ? { ...attachment }
      : {
          id: attachment.id,
          fileId: attachment.fileId,
          name: attachment.name,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          type: attachment.type,
          size: attachment.size,
          sourcePath: attachmentSourcePath(attachment),
        }
    if (attachment.fileId)
      output.url = `${env.SITE_PREFIX || "/howard-notes/"}api/content/memories/files/${attachment.fileId}`
    else if (owner) output.url = attachment.url
    return output
  })
  if (!owner) {
    delete card.raw
    delete card.source
    // Source relations may reveal the identifiers of private source records.
    card.relations = []
  }
  return card
}
async function ownerOf(request, env, authorize, required = false, importing = false) {
  const url = new URL(request.url)
  const origin = request.headers.get("Origin")
  const wrongOrigin = origin && origin !== url.origin && origin !== env.FALLBACK_ORIGIN
  const crossSite =
    request.headers.get("Sec-Fetch-Site") === "cross-site" && origin !== env.FALLBACK_ORIGIN
  if (wrongOrigin || crossSite) {
    // Cross-site <img> requests have no Origin header or credentials. They may
    // load genuinely public resources without weakening cookie or write checks.
    if (
      !wrongOrigin &&
      !required &&
      !importing &&
      !request.headers.has("Authorization") &&
      !/(?:^|;\s*)howard_session=/.test(request.headers.get("Cookie") || "")
    )
      return { owner: false }
    throw new MemoryError("请求来源不正确。", 403)
  }
  if (importing) {
    if (!secretEqual(request.headers.get("X-Howard-Sync-Key"), env.SYNC_SECRET))
      throw new MemoryError("导入授权不正确。", 403)
    await authorize(request)
    return { owner: true }
  }
  if (request.headers.has("X-Howard-Sync-Key"))
    throw new MemoryError("此接口需要维护账号登录。", 403)
  if (request.headers.has("Authorization")) {
    await authorize(request)
    return { owner: true }
  }
  if (request.headers.has("Cookie") && env.SESSION_SECRET) {
    const restored = await sessionResponse(
      new Request(request.url, {
        headers: request.headers,
        method: "GET",
      }),
      env,
      authorize,
    )
    const credentials = await restored.json()
    if (restored.ok && credentials?.token) return { owner: true }
    if (restored.status >= 500) throw new MemoryError("暂时无法验证登录，请稍后重试。", 503)
    if (required) throw new MemoryError("请重新登录。", 401)
    const cookie = restored.headers.get("Set-Cookie")
    return { owner: false, headers: cookie ? { "Set-Cookie": cookie } : {} }
  }
  if (required) throw new MemoryError("请先登录。", 401)
  return { owner: false }
}
async function bodyOf(request) {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    throw new MemoryError("请求格式不正确。")
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES)
    throw new MemoryError("请求过大。", 413)
  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) throw new MemoryError("请求过大。", 413)
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new MemoryError("请求格式不正确。")
  }
}
function condition(url, owner) {
  const parts = [],
    values = []
  if (!owner) parts.push("visibility = 'PUBLIC'", "status = 'NORMAL'")
  else {
    const status = url.searchParams.get("status") || "NORMAL"
    if (status !== "ALL") {
      if (!statusValues.has(status)) throw new MemoryError("筛选状态不正确。")
      parts.push("status = ?")
      values.push(status)
    } else parts.push("status != 'TRASH'")
  }
  const tag = url.searchParams.get("tag")
  if (tag) {
    parts.push("EXISTS (SELECT 1 FROM json_each(json_extract(body, '$.tags')) WHERE value = ?)")
    values.push(tag)
  }
  const q = url.searchParams.get("q")?.trim()
  if (q) {
    if (q.length > 500) throw new MemoryError("搜索文字过长。")
    parts.push(
      "(instr(lower(json_extract(body, '$.content')),lower(?)) > 0 OR EXISTS (SELECT 1 FROM json_each(json_extract(body, '$.tags')) WHERE instr(lower(value),lower(?)) > 0))",
    )
    values.push(q, q)
  }
  return { where: parts.length ? " WHERE " + parts.join(" AND ") : "", values }
}
function orderOf(url) {
  const sort = url.searchParams.get("sort") || "created-desc"
  const orders = {
    "created-desc": "created_at DESC, id DESC",
    "created-asc": "created_at ASC, id ASC",
    "modified-desc": "modified_at DESC, id DESC",
    "modified-asc": "modified_at ASC, id ASC",
  }
  if (!orders[sort]) throw new MemoryError("排序方式不正确。")
  return { order: orders[sort], sort }
}
async function rowOf(db, id, owner) {
  const row = await db
    .prepare(
      "SELECT * FROM memory_cards WHERE id = ?" +
        (owner ? "" : " AND visibility = 'PUBLIC' AND status = 'NORMAL'"),
    )
    .bind(id)
    .first()
  if (!row) throw new MemoryError("记忆卡不存在或尚未公开。", 404)
  return row
}
function attachmentStatements(db, id, card, expectedVersion = null) {
  const guarded = expectedVersion != null
  const guard = guarded
    ? " AND EXISTS (SELECT 1 FROM memory_cards WHERE id=? AND version=? AND body=?)"
    : ""
  const args = guarded ? [id, expectedVersion, JSON.stringify(card)] : []
  return [
    db.prepare("DELETE FROM memory_attachments WHERE memory_id = ?" + guard).bind(id, ...args),
    db
      .prepare(
        "INSERT OR IGNORE INTO memory_attachments(memory_id,file_id) SELECT ?,value FROM json_each(?)" +
          (guarded
            ? " WHERE EXISTS (SELECT 1 FROM memory_cards WHERE id=? AND version=? AND body=?)"
            : ""),
      )
      .bind(
        id,
        JSON.stringify([
          ...new Set(card.attachments.map((attachment) => attachment.fileId).filter(Boolean)),
        ]),
        ...args,
      ),
  ]
}
function insertCard(
  db,
  id,
  card,
  sourceOrigin = null,
  sourceId = null,
  sourceHash = null,
  ignoreExisting = false,
) {
  const deleted = card.status === "TRASH" ? Date.parse(card.deletedAt || card.modified) : null
  return db
    .prepare(
      `INSERT${ignoreExisting ? " OR IGNORE" : ""} INTO memory_cards(id,source_origin,source_id,source_hash,visibility,status,created_at,modified_at,deleted_at,version,body) VALUES(?,?,?,?,?,?,?,?,?,1,?)`,
    )
    .bind(
      id,
      sourceOrigin,
      sourceId,
      sourceHash,
      card.visibility,
      card.status,
      Date.parse(card.created),
      Date.parse(card.modified),
      deleted,
      JSON.stringify(card),
    )
}
async function importCards(db, body) {
  let sourceOrigin
  try {
    const url = new URL(body.sourceOrigin)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error()
    sourceOrigin = url.origin
  } catch {
    throw new MemoryError("来源地址不正确。")
  }
  if (!Array.isArray(body.memories) || !body.memories.length || body.memories.length > 100)
    throw new MemoryError("导入分块应包含 1–100 张记忆卡。")
  const seen = new Set(),
    entries = [],
    changed = []
  const sourceIds = body.memories.map((value) => {
    const sourceId = String(value.sourceId ?? value.source?.id ?? "")
    if (!sourceId || sourceId.length > 200 || seen.has(sourceId))
      throw new MemoryError("来源标识不正确或重复。")
    seen.add(sourceId)
    return sourceId
  })
  const priorRows = await db
    .prepare(
      "SELECT id,source_id,source_hash FROM memory_cards WHERE source_origin = ? AND source_id IN (SELECT value FROM json_each(?))",
    )
    .bind(sourceOrigin, JSON.stringify(sourceIds))
    .all()
  const priorById = new Map(priorRows.results.map((row) => [row.source_id, row]))
  let unchanged = 0
  for (const [index, value] of body.memories.entries()) {
    const sourceId = sourceIds[index]
    const card = cardValue(value, { imported: true })
    const hash = await digest(encoder.encode(JSON.stringify(card)))
    const prior = priorById.get(sourceId)
    const id =
      prior?.id ||
      "memos-" + (await digest(encoder.encode(`${sourceOrigin}\0${sourceId}`))).slice(0, 32)
    entries.push({ sourceId, id })
    if (prior?.source_hash === hash) {
      unchanged++
      continue
    }
    changed.push({
      id,
      sourceId,
      hash,
      card,
      createdAt: Date.parse(card.created),
      modifiedAt: Date.parse(card.modified),
      deletedAt: card.status === "TRASH" ? Date.parse(card.deletedAt || card.modified) : null,
    })
  }
  if (changed.length) {
    const data = JSON.stringify(changed)
    if (encoder.encode(data).length > MAX_BODY_BYTES)
      throw new MemoryError("导入分块过大，请减少每批记忆卡数量。", 413)
    await db.batch([
      db
        .prepare(
          "INSERT INTO memory_cards(id,source_origin,source_id,source_hash,visibility,status,created_at,modified_at,deleted_at,version,body) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.sourceId'),json_extract(value,'$.hash'),json_extract(value,'$.card.visibility'),json_extract(value,'$.card.status'),json_extract(value,'$.createdAt'),json_extract(value,'$.modifiedAt'),json_extract(value,'$.deletedAt'),1,json_extract(value,'$.card') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET source_hash=excluded.source_hash,visibility=excluded.visibility,status=excluded.status,created_at=excluded.created_at,modified_at=excluded.modified_at,deleted_at=excluded.deleted_at,version=memory_cards.version+1,body=excluded.body WHERE memory_cards.source_hash IS NOT excluded.source_hash",
        )
        .bind(sourceOrigin, data),
      db
        .prepare(
          "DELETE FROM memory_attachments WHERE memory_id IN (SELECT m.id FROM json_each(?) j JOIN memory_cards m ON m.id=json_extract(j.value,'$.id') WHERE m.source_hash=json_extract(j.value,'$.hash') AND m.body=json_extract(j.value,'$.card'))",
        )
        .bind(data),
      db
        .prepare(
          "INSERT OR IGNORE INTO memory_attachments(memory_id,file_id) SELECT m.id,json_extract(a.value,'$.fileId') FROM json_each(?) j JOIN memory_cards m ON m.id=json_extract(j.value,'$.id'),json_each(json_extract(j.value,'$.card.attachments')) a WHERE json_type(a.value,'$.fileId')='text' AND m.source_hash=json_extract(j.value,'$.hash') AND m.body=json_extract(j.value,'$.card')",
        )
        .bind(data),
    ])
  }
  return json({ imported: entries.length - unchanged, unchanged, ids: entries })
}
function safeMime(value) {
  return /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|ogg|wav|mp4|webm)|application\/pdf)$/.test(
    value,
  )
    ? value
    : "application/octet-stream"
}
async function importFile(db, body) {
  const { file, chunk } = body
  if (
    !file ||
    !filePattern.test(file.id) ||
    typeof file.name !== "string" ||
    file.name.length > 500 ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_FILE_BYTES ||
    !/^[a-f0-9]{64}$/.test(file.sha256 || "")
  )
    throw new MemoryError("附件元信息不正确。")
  const source = file.source ?? {}
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new MemoryError("附件来源元信息不正确。")
  if (source.memo != null) {
    if (
      typeof source.memo !== "string" ||
      !/^memos\/[a-zA-Z0-9_-]+$/.test(source.memo) ||
      source.memo.length > 200
    )
      throw new MemoryError("附件所属记忆卡标识不正确。")
    try {
      const origin = new URL(source.origin)
      if (
        !/^https?:$/.test(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.origin !== source.origin
      )
        throw new Error()
    } catch {
      throw new MemoryError("附件来源地址不正确。")
    }
  }
  if (
    !chunk ||
    !Number.isSafeInteger(chunk.index) ||
    !Number.isSafeInteger(chunk.total) ||
    chunk.index < 0 ||
    chunk.index >= chunk.total ||
    chunk.total > 1000
  )
    throw new MemoryError("附件分块格式不正确。")
  const data = decodeChunk(chunk.data)
  const prior = await db.prepare("SELECT * FROM memory_files WHERE id = ?").bind(file.id).first()
  if (
    prior &&
    (prior.sha256 !== file.sha256 || prior.size !== file.size || prior.total_chunks !== chunk.total)
  )
    throw new MemoryError("附件内容已有变化，请使用新的附件标识。", 409)
  const previousSource = prior ? JSON.parse(prior.metadata) : {}
  const metadata = JSON.stringify({
    ...previousSource,
    ...source,
    // A retry from an older importer must not erase an already known owner.
    ...(previousSource.memo && !source.memo
      ? { memo: previousSource.memo, origin: previousSource.origin }
      : {}),
  })
  if (prior?.complete) {
    if (metadata !== prior.metadata)
      await db
        .prepare("UPDATE memory_files SET metadata=? WHERE id=?")
        .bind(metadata, file.id)
        .run()
    return json({ id: file.id, complete: true, unchanged: true })
  }
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO memory_files(id,name,mime_type,size,sha256,total_chunks,created_at,metadata) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        file.id,
        file.name,
        String(file.mimeType || "application/octet-stream"),
        file.size,
        file.sha256,
        chunk.total,
        Date.now(),
        metadata,
      ),
    ...(prior && metadata !== prior.metadata
      ? [db.prepare("UPDATE memory_files SET metadata=? WHERE id=?").bind(metadata, file.id)]
      : []),
    db
      .prepare(
        "INSERT OR REPLACE INTO memory_file_chunks(file_id,chunk_index,size,data) VALUES(?,?,?,?)",
      )
      .bind(file.id, chunk.index, data.length, chunk.data),
  ])
  const progress = await db
    .prepare(
      "SELECT count(*) AS count,coalesce(sum(size),0) AS size FROM memory_file_chunks WHERE file_id = ?",
    )
    .bind(file.id)
    .first()
  if (progress.count === chunk.total) {
    if (progress.size !== file.size) throw new MemoryError("附件分块长度不一致。")
    if ((await fileDigest(db, file.id, chunk.total, file.size)) !== file.sha256)
      throw new MemoryError("附件校验不一致。")
    await db.prepare("UPDATE memory_files SET complete = 1 WHERE id = ?").bind(file.id).run()
  }
  return json({
    id: file.id,
    complete: progress.count === chunk.total,
    receivedChunks: progress.count,
  })
}
async function fileRead(request, env, db, id, owner, extraHeaders) {
  if (!filePattern.test(id)) throw new MemoryError("附件不存在或尚未公开。", 404)
  const file = await db
    .prepare(
      "SELECT * FROM memory_files WHERE id = ? AND complete = 1 AND EXISTS (SELECT 1 FROM memory_attachments a JOIN memory_cards m ON m.id = a.memory_id WHERE a.file_id = memory_files.id" +
        (owner ? "" : " AND m.visibility = 'PUBLIC' AND m.status = 'NORMAL'") +
        ")" +
        (owner
          ? ""
          : " AND (json_extract(memory_files.metadata,'$.memo') IS NULL OR EXISTS (SELECT 1 FROM memory_cards source_card WHERE source_card.source_origin=json_extract(memory_files.metadata,'$.origin') AND source_card.source_id=json_extract(memory_files.metadata,'$.memo') AND source_card.visibility='PUBLIC' AND source_card.status='NORMAL'))"),
    )
    .bind(id)
    .first()
  if (!file) throw new MemoryError("附件不存在或尚未公开。", 404)
  const mime = safeMime(file.mime_type)
  const filename = encodeURIComponent(file.name).replace(
    /[!'()*]/g,
    (letter) => "%" + letter.charCodeAt(0).toString(16).toUpperCase(),
  )
  const headers = {
    "Content-Type": mime,
    "Content-Length": String(file.size),
    "Content-Disposition": `${mime === "application/octet-stream" ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
    ...extraHeaders,
  }
  let firstByte = 0,
    lastByte = file.size - 1,
    status = 200
  const range = request.headers.get("Range")
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      if (match[1]) {
        firstByte = Number(match[1])
        lastByte = match[2] ? Math.min(lastByte, Number(match[2])) : lastByte
      } else firstByte = Math.max(0, file.size - Number(match[2]))
    }
    if (
      !match ||
      !file.size ||
      !Number.isSafeInteger(firstByte) ||
      !Number.isSafeInteger(lastByte) ||
      firstByte < 0 ||
      firstByte >= file.size ||
      lastByte < firstByte ||
      (!match[1] && !Number(match[2]))
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${file.size}` },
      })
    status = 206
    headers["Content-Length"] = String(lastByte - firstByte + 1)
    headers["Content-Range"] = `bytes ${firstByte}-${lastByte}/${file.size}`
  }
  if (request.method === "HEAD") return new Response(null, { status, headers })
  let index = 0,
    offset = 0,
    lastChunk = file.total_chunks - 1,
    rows = []
  if (range) {
    const sizes = await db
      .prepare(
        "SELECT chunk_index,size FROM memory_file_chunks WHERE file_id=? ORDER BY chunk_index",
      )
      .bind(id)
      .all()
    let current = 0
    for (const row of sizes.results) {
      if (current + row.size <= firstByte) {
        index = row.chunk_index + 1
        offset += row.size
      }
      if (current <= lastByte && current + row.size > lastByte) lastChunk = row.chunk_index
      current += row.size
    }
  }
  const stream = new ReadableStream({
    async pull(controller) {
      if (index > lastChunk || offset > lastByte) {
        controller.close()
        return
      }
      if (!rows.length) {
        const result = await db
          .prepare(
            "SELECT chunk_index,size,data FROM memory_file_chunks WHERE file_id=? AND chunk_index>=? AND chunk_index<=? ORDER BY chunk_index LIMIT ?",
          )
          .bind(id, index, lastChunk, chunkPageSize(file.total_chunks))
          .all()
        rows = result.results
      }
      const row = rows.shift()
      if (!row || row.chunk_index !== index++) {
        controller.error(new Error("Attachment chunk unavailable"))
        return
      }
      const bytes = decodeBase64(row.data)
      const begin = Math.max(0, firstByte - offset),
        end = Math.min(bytes.length, lastByte - offset + 1)
      offset += bytes.length
      if (end > begin) controller.enqueue(bytes.subarray(begin, end))
    },
    cancel() {
      rows = []
    },
  })
  return new Response(stream, { status, headers })
}
export async function cleanupMemories(db, now = Date.now()) {
  await db.batch([
    db
      .prepare(
        "DELETE FROM memory_attachments WHERE memory_id IN (SELECT id FROM memory_cards WHERE status = 'TRASH' AND deleted_at <= ?)",
      )
      .bind(now - 30 * DAY),
    db
      .prepare("DELETE FROM memory_cards WHERE status = 'TRASH' AND deleted_at <= ?")
      .bind(now - 30 * DAY),
    db
      .prepare(
        "DELETE FROM memory_file_chunks WHERE file_id IN (SELECT id FROM memory_files WHERE created_at <= ? AND NOT EXISTS (SELECT 1 FROM memory_attachments WHERE file_id = memory_files.id))",
      )
      .bind(now - 30 * DAY),
    db
      .prepare(
        "DELETE FROM memory_files WHERE created_at <= ? AND NOT EXISTS (SELECT 1 FROM memory_attachments WHERE file_id = memory_files.id)",
      )
      .bind(now - 30 * DAY),
  ])
}
export async function memoriesResponse(request, env, db, path, authorize) {
  try {
    const url = new URL(request.url)
    const suffix = path.replace(/^memories\/?/, "")
    const writing = !["GET", "HEAD"].includes(request.method)
    const importing = suffix === "import" || suffix === "import/files"
    const auth = await ownerOf(request, env, authorize, writing, importing)
    if (writing && request.method !== "POST") throw new MemoryError("请求方法不正确。", 405)
    if (importing) {
      if (!writing) throw new MemoryError("请求方法不正确。", 405)
      const body = await bodyOf(request)
      return await (suffix === "import" ? importCards(db, body) : importFile(db, body))
    }
    if (suffix.startsWith("files/")) {
      if (writing) throw new MemoryError("请求方法不正确。", 405)
      return await fileRead(request, env, db, suffix.slice(6), auth.owner, auth.headers)
    }
    if (!writing && (!suffix || suffix === "tags")) {
      const filter = condition(url, auth.owner)
      const tags = await db
        .prepare(
          "SELECT j.value AS name,count(*) AS count FROM memory_cards,json_each(json_extract(body,'$.tags')) j" +
            filter.where +
            " GROUP BY j.value ORDER BY count DESC,j.value COLLATE NOCASE",
        )
        .bind(...filter.values)
        .all()
      if (suffix === "tags")
        return json({ tags: tags.results, owner: auth.owner }, 200, auth.headers)
      const { order, sort } = orderOf(url)
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
      if (!Number.isSafeInteger(page) || page > 100000) throw new MemoryError("页码不正确。")
      const pageSize = url.searchParams.get("view") === "timeline" ? 5000 : 20
      const count = await db
        .prepare("SELECT count(*) AS count FROM memory_cards" + filter.where)
        .bind(...filter.values)
        .first()
      const rows = await db
        .prepare(
          "SELECT * FROM memory_cards" + filter.where + " ORDER BY " + order + " LIMIT ? OFFSET ?",
        )
        .bind(...filter.values, pageSize, (page - 1) * pageSize)
        .all()
      return json(
        {
          memories: rows.results.map((row) => visibleCard(row, auth.owner, env)),
          total: count.count,
          page,
          pageSize,
          sort,
          owner: auth.owner,
          tags: tags.results,
        },
        200,
        auth.headers,
      )
    }
    if (!suffix && writing) {
      const body = await bodyOf(request)
      const card = cardValue(body)
      if (card.status === "TRASH") throw new MemoryError("不能直接创建回收站记忆卡。")
      if (
        body.requestId != null &&
        (typeof body.requestId !== "string" || !requestPattern.test(body.requestId))
      )
        throw new MemoryError("保存请求标识不正确。")
      const id = "memory-" + (body.requestId?.toLowerCase() || crypto.randomUUID())
      const { created: _created, modified: _modified, ...initial } = card
      const initialHash = await digest(encoder.encode(JSON.stringify(initial)))
      const prior = await db.prepare("SELECT * FROM memory_cards WHERE id = ?").bind(id).first()
      if (prior) {
        if (prior.source_hash !== initialHash)
          throw new MemoryError("保存请求已用于另一张记忆卡，请重新新建。", 409)
        return json({ memory: visibleCard(prior, true, env), status: "saved", replayed: true })
      }
      const result = await db.batch([
        insertCard(db, id, card, null, null, initialHash, true),
        ...attachmentStatements(db, id, card, 1),
      ])
      const saved = await db.prepare("SELECT * FROM memory_cards WHERE id = ?").bind(id).first()
      if (!saved || saved.source_hash !== initialHash)
        throw new MemoryError("保存请求已用于另一张记忆卡，请重新新建。", 409)
      return json(
        {
          memory: visibleCard(saved, true, env),
          ...(result[0].meta.changes ? {} : { replayed: true }),
        },
        result[0].meta.changes ? 201 : 200,
      )
    }
    const match = /^([a-zA-Z0-9_-]+)(?:\/(delete|restore))?$/.exec(suffix)
    if (!match) throw new MemoryError("接口不存在。", 404)
    const [, id, action] = match
    const row = await rowOf(db, id, auth.owner)
    if (!writing) {
      if (action) throw new MemoryError("请求方法不正确。", 405)
      return json(
        { memory: visibleCard(row, auth.owner, env), owner: auth.owner },
        200,
        auth.headers,
      )
    }
    const body = await bodyOf(request)
    if (action === "delete" && row.status === "TRASH")
      return json({ memory: visibleCard(row, true, env), status: "deleted", replayed: true })
    if (body.version != null && body.version !== row.version)
      throw new MemoryError("记忆卡已有更新，请重新打开后编辑。", 409)
    const prior = JSON.parse(row.body)
    let card,
      deletedAt = row.deleted_at,
      previousStatus = row.previous_status
    if (action === "delete") {
      deletedAt = Date.now()
      previousStatus = row.status
      card = { ...prior, status: "TRASH", modified: new Date().toISOString() }
    } else if (action === "restore") {
      if (row.status !== "TRASH" || row.deleted_at <= Date.now() - 30 * DAY)
        throw new MemoryError("记忆卡已过保留期或不在回收站。", 409)
      deletedAt = null
      card = {
        ...prior,
        status: row.previous_status || "NORMAL",
        modified: new Date().toISOString(),
      }
      delete card.deletedAt
      previousStatus = null
    } else {
      if (row.status === "TRASH") throw new MemoryError("请先从回收站恢复记忆卡。", 409)
      card = cardValue(body, { prior })
      if (card.status === "TRASH") throw new MemoryError("请使用删除按钮移入回收站。")
    }
    const update = db
      .prepare(
        "UPDATE memory_cards SET visibility=?,status=?,modified_at=?,deleted_at=?,previous_status=?,version=version+1,body=? WHERE id=? AND version=?",
      )
      .bind(
        card.visibility,
        card.status,
        Date.parse(card.modified),
        deletedAt,
        previousStatus,
        JSON.stringify(card),
        id,
        row.version,
      )
    const result = await db.batch([update, ...attachmentStatements(db, id, card, row.version + 1)])
    if (!result[0].meta.changes) throw new MemoryError("记忆卡已有更新，请重新打开后编辑。", 409)
    return json({
      memory: visibleCard(
        { ...row, body: JSON.stringify(card), deleted_at: deletedAt, version: row.version + 1 },
        true,
        env,
      ),
      status: action === "delete" ? "deleted" : action === "restore" ? "restored" : "saved",
    })
  } catch (error) {
    return json(
      {
        error:
          error instanceof MemoryError || error?.status
            ? error.message
            : "记忆卡服务暂时不可用，请稍后重试。",
      },
      error.status || 503,
    )
  }
}
