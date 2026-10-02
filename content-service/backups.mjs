import {
  backupHash,
  backupKey,
  encryptBackup,
  decryptBackup,
  encodeBackupJson,
  decodeBackupJson,
} from "../scripts/lib/backup-crypto.mjs"

export const BACKUP_TABLES = Object.freeze([
  "memory_cards",
  "memory_files",
  "memory_file_chunks",
  "memory_attachments",
  "personal_articles",
  "personal_article_versions",
  "personal_drafts",
  "personal_draft_versions",
  "personal_files",
  "personal_attachments",
])
const PREFIX = "snapshots/"
const PROGRESS = "control/progress.hnbackup"
const STATUS = "control/status.json"
const TARGET_BYTES = 128 * 1024
const FILE_CHUNK_BYTES = 256 * 1024
const SAFE_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/
const textEncoder = new TextEncoder()
const json = (value, status = 200, extra = {}) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  })

async function readJson(bucket, key) {
  const object = await bucket.get(key)
  return object ? JSON.parse(await object.text()) : null
}
async function readEncrypted(bucket, key, secret) {
  const object = await bucket.get(key)
  return object
    ? decodeBackupJson(await decryptBackup(await object.arrayBuffer(), secret, key))
    : null
}
async function writeEncrypted(bucket, key, value, secret) {
  return bucket.put(key, await encryptBackup(encodeBackupJson(value), secret, key), {
    httpMetadata: { contentType: "application/octet-stream" },
  })
}
async function epoch(db) {
  const row = await db.prepare("SELECT generation FROM backups_epoch WHERE id=1").first()
  if (!row) throw new Error("Backup mutation guards have not been installed.")
  return row.generation
}
function columnsOf(sql) {
  const columns = [
    ...sql.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/gim),
  ].map((match) => match[1])
  if (!columns.length || columns.some((name) => !/^[a-z_][a-z0-9_]*$/.test(name)))
    throw new Error("Backup schema contains unsupported column declarations.")
  return columns
}
async function schema(db) {
  const rows = (
    await db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name",
      )
      .all()
  ).results
  const tables = rows.filter((row) => row.type === "table" && BACKUP_TABLES.includes(row.name))
  for (const table of tables) {
    for (const operation of ["insert", "update", "delete"])
      if (!rows.some((row) => row.name === `backup_epoch_${table.name}_${operation}`))
        throw new Error("A canonical table is missing its backup mutation guard.")
  }
  return {
    tables: tables.map((table) => ({
      name: table.name,
      sql: table.sql,
      columns: columnsOf(table.sql),
    })),
    indexes: rows
      .filter((row) => row.type === "index" && tables.some((table) => table.name === row.tbl_name))
      .map((row) => row.sql),
  }
}
function rowCounts(definitions) {
  return definitions
    .map((table) => `SELECT '${table.name}' name,COUNT(*) count FROM "${table.name}"`)
    .join(" UNION ALL ")
}
function pageQuery(table) {
  // Only the next 25 candidate identities and native JSON byte lengths are
  // materialized in D1. Large candidate bodies never cross into the Worker
  // unless selected. A large first row makes progress without shrinking every
  // other page in its table to one row.
  const fields = table.columns.map((column) => `'${column}',"${column}"`).join(",")
  return `WITH candidates AS MATERIALIZED (
    SELECT rowid AS __backup_rowid,
      length(CAST(json_object(${fields}) AS BLOB))+64 AS __backup_bytes
    FROM "${table.name}" WHERE rowid>? ORDER BY rowid LIMIT ?
  ), ranked AS (
    SELECT __backup_rowid,ROW_NUMBER() OVER (ORDER BY __backup_rowid) AS position,
      SUM(__backup_bytes) OVER (ORDER BY __backup_rowid ROWS UNBOUNDED PRECEDING) AS bytes
    FROM candidates
  )
  SELECT original.rowid AS __backup_rowid,original.*
  FROM "${table.name}" original JOIN ranked ON original.rowid=ranked.__backup_rowid
  WHERE ranked.position=1 OR ranked.bytes<=? ORDER BY original.rowid`
}
function publicProgress(job) {
  return job
    ? {
        id: job.id,
        startedAt: job.createdAt,
        copiedTables: job.tableIndex,
        totalTables: job.tables.length,
        rows: job.parts.reduce((sum, part) => sum + part.rows, 0),
        privateBytes:
          job.objects.reduce((sum, object) => sum + object.size, 0) +
          (job.pendingFile?.offset || 0),
      }
    : null
}
async function saveProgress(env, job, latest, error = null) {
  if (job) await writeEncrypted(env.BACKUP_BUCKET, PROGRESS, job, env.BACKUP_SECRET)
  else await env.BACKUP_BUCKET.delete(PROGRESS)
  await env.BACKUP_BUCKET.put(
    STATUS,
    JSON.stringify({
      latest,
      progress: publicProgress(job),
      error,
      checkedAt: new Date().toISOString(),
    }),
    { httpMetadata: { contentType: "application/json" } },
  )
}

async function backupPrivateFile(env, file, objects, pending = null) {
  if (!file.complete || !file.object_key) return null
  if (!env.PERSONAL_FILES_BUCKET) throw new Error("Private file storage is unavailable for backup.")
  if (!/^[a-f0-9]{64}$/.test(file.sha256) || file.object_key !== `personal-files/${file.sha256}`)
    throw new Error("Private file backup identity is invalid.")
  if (objects.some((object) => object.sha256 === file.sha256)) return null
  const key = `objects/${file.sha256}/manifest.hnbackup`
  const existing = await readEncrypted(env.BACKUP_BUCKET, key, env.BACKUP_SECRET)
  let parts =
    existing?.sha256 === file.sha256 && existing.size === file.size ? existing.parts : null
  if (!parts) {
    const copied = pending || { file, parts: [], offset: 0 }
    const length = Math.min(FILE_CHUNK_BYTES, file.size - copied.offset)
    const source = length
      ? await env.PERSONAL_FILES_BUCKET.get(file.object_key, {
          range: { offset: copied.offset, length },
        })
      : await env.PERSONAL_FILES_BUCKET.head(file.object_key)
    if (!source || source.size !== file.size)
      throw new Error("Private attachment is missing or has changed.")
    if (length) {
      const bytes = new Uint8Array(await source.arrayBuffer())
      if (bytes.byteLength !== length) throw new Error("Private attachment range is incomplete.")
      const partKey = `objects/${file.sha256}/${String(copied.parts.length).padStart(6, "0")}.hnbackup`
      await env.BACKUP_BUCKET.put(partKey, await encryptBackup(bytes, env.BACKUP_SECRET, partKey), {
        httpMetadata: { contentType: "application/octet-stream" },
      })
      copied.parts.push({ key: partKey, bytes: length, sha256: await backupHash(bytes) })
      copied.offset += length
      if (copied.offset < file.size) return copied
    }
    // Native stream hashing does not build a second whole-file JavaScript buffer.
    // Verify the immutable original once, after all bounded chunks have been copied.
    const completeSource = await env.PERSONAL_FILES_BUCKET.get(file.object_key)
    if (!completeSource || completeSource.size !== file.size)
      throw new Error("Private attachment changed while backing up.")
    const digestStream =
      typeof crypto.DigestStream === "function" ? new crypto.DigestStream("SHA-256") : null
    if (!digestStream && file.size > 20 * 1024 * 1024)
      throw new Error("Large private attachment backup requires the Workers streaming digest.")
    let actual
    if (digestStream) {
      await completeSource.body.pipeTo(digestStream)
      actual = [...new Uint8Array(await digestStream.digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    } else {
      const bytes = new Uint8Array(await completeSource.arrayBuffer())
      if (bytes.byteLength !== file.size)
        throw new Error("Private attachment changed while backing up.")
      actual = await backupHash(bytes)
    }
    if (actual !== file.sha256) throw new Error("Private attachment checksum does not match.")
    parts = copied.parts
    await writeEncrypted(
      env.BACKUP_BUCKET,
      key,
      { sha256: file.sha256, size: file.size, parts },
      env.BACKUP_SECRET,
    )
  }
  objects.push({ key, parts, sha256: file.sha256, size: file.size, sourceKey: file.object_key })
  return null
}

/** Canonical-only, encrypted, resumable backup; public HTML is rebuilt from Git. */
export async function runScheduledBackup(env, options = {}) {
  if (!env.BACKUP_BUCKET || !env.BACKUP_SECRET) return { status: "disabled" }
  backupKey(env.BACKUP_SECRET)
  const db = options.db || (env.DB.withSession ? env.DB.withSession("first-primary") : env.DB)
  const now = options.now ?? Date.now()
  const lease = crypto.randomUUID()
  const acquired = await db
    .prepare(
      "INSERT INTO backups_lease (id,lease,expires) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires WHERE backups_lease.expires<? RETURNING lease",
    )
    .bind(lease, now + 10 * 60_000, now)
    .first()
  if (acquired?.lease !== lease) return { status: "busy" }
  try {
    return await performScheduledBackup(env, { ...options, db, now })
  } finally {
    await db
      .prepare("DELETE FROM backups_lease WHERE id=1 AND lease=? RETURNING lease")
      .bind(lease)
      .first()
  }
}
async function performScheduledBackup(env, options) {
  const db = options.db
  const now = options.now
  const budget = Math.max(8, Math.min(35, options.maxQueries ?? 8))
  const maxPages = Math.max(1, Math.min(8, options.maxPages ?? 1))
  const previous = await readJson(env.BACKUP_BUCKET, STATUS)
  let job = await readEncrypted(env.BACKUP_BUCKET, PROGRESS, env.BACKUP_SECRET)
  if (
    !job &&
    !options.force &&
    previous?.latest?.completedAt?.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
  )
    return { status: "current", latest: previous.latest }
  try {
    let queries = 0
    const generation = await epoch(db)
    queries++
    if (job && job.generation !== generation) {
      await discardSnapshot(env.BACKUP_BUCKET, job.id)
      job = null
    }
    if (!job) {
      const definitions = await schema(db)
      queries++
      const counts = definitions.tables.length
        ? (await db.prepare(rowCounts(definitions.tables)).all()).results
        : []
      if (definitions.tables.length) queries++
      const id =
        new Date(now).toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomUUID().slice(0, 8)
      job = {
        format: "howard-notes-logical-backup-v1",
        id,
        generation,
        createdAt: new Date(now).toISOString(),
        tables: definitions.tables.map((table) => {
          const count = counts.find((item) => item.name === table.name)
          return {
            ...table,
            expectedRows: count?.count || 0,
            pageSize: table.name === "personal_files" ? 1 : 25,
          }
        }),
        indexes: definitions.indexes,
        tableIndex: 0,
        cursor: 0,
        parts: [],
        objects: [],
        source: {
          repository: env.REPOSITORY || null,
          publicContent: "regenerate-from-github",
          loginSecrets: "excluded",
        },
      }
    }
    let copiedPages = 0
    let copiedAttachment = false
    if (job.pendingFile) {
      job.pendingFile = await backupPrivateFile(
        env,
        job.pendingFile.file,
        job.objects,
        job.pendingFile,
      )
      copiedAttachment = true
    }
    while (
      job.tableIndex < job.tables.length &&
      queries < budget - 2 &&
      copiedPages < maxPages &&
      !copiedAttachment
    ) {
      const table = job.tables[job.tableIndex]
      const rows = (
        await db
          .prepare(pageQuery(table))
          .bind(job.cursor, table.name === "personal_files" ? 1 : 25, TARGET_BYTES - 2)
          .all()
      ).results
      queries++
      if (!rows.length) {
        const copied = job.parts
          .filter((part) => part.table === table.name)
          .reduce((sum, part) => sum + part.rows, 0)
        if (copied !== table.expectedRows) throw new Error("Canonical data changed during backup.")
        job.tableIndex++
        job.cursor = 0
        continue
      }
      job.cursor = rows.at(-1).__backup_rowid
      const values = rows.map(({ __backup_rowid: _rowid, ...row }) => row)
      const bytes = encodeBackupJson(values)
      const key = `${PREFIX}${job.id}/${String(job.parts.length).padStart(6, "0")}.hnbackup`
      await env.BACKUP_BUCKET.put(key, await encryptBackup(bytes, env.BACKUP_SECRET, key), {
        httpMetadata: { contentType: "application/octet-stream" },
      })
      job.parts.push({
        key,
        table: table.name,
        rows: rows.length,
        bytes: bytes.byteLength,
        sha256: await backupHash(bytes),
      })
      copiedPages++
      if (table.name === "personal_files") {
        // A metadata page has at most one file; each invocation copies one
        // 256KiB range, then saves its encrypted checkpoint before returning.
        job.pendingFile = await backupPrivateFile(env, values[0], job.objects)
        copiedAttachment = true
      }
    }
    if ((await epoch(db)) !== job.generation)
      throw new Error("Canonical data changed during backup.")
    if (job.tableIndex < job.tables.length) {
      await saveProgress(env, job, previous?.latest || null)
      return { status: "progress", progress: publicProgress(job) }
    }
    const latest = {
      id: job.id,
      createdAt: job.createdAt,
      completedAt: new Date(now).toISOString(),
      rows: job.parts.reduce((sum, part) => sum + part.rows, 0),
      tables: job.tables.length,
      bytes: job.parts.reduce((sum, part) => sum + part.bytes, 0),
      privateFiles: job.objects.length,
    }
    const manifest = { ...job, completedAt: latest.completedAt }
    delete manifest.tableIndex
    delete manifest.cursor
    delete manifest.pendingFile
    // Activation is last: incomplete prefixes never appear as a valid backup.
    await writeEncrypted(
      env.BACKUP_BUCKET,
      `${PREFIX}${job.id}/manifest.hnbackup`,
      manifest,
      env.BACKUP_SECRET,
    )
    await saveProgress(env, null, latest)
    try {
      await retainBackups(env.BACKUP_BUCKET, now)
      const collected = await readJson(env.BACKUP_BUCKET, "control/collection.json")
      if (!collected || now - collected.checkedAt > 7 * 86_400_000)
        await garbageCollectBackupObjects(env, { now })
    } catch {
      // A storage-maintenance failure must not destroy a verified new snapshot.
      await saveProgress(env, null, latest, "Backup completed; retention maintenance needs retry.")
    }
    return { status: "complete", latest }
  } catch (error) {
    if (job) await discardSnapshot(env.BACKUP_BUCKET, job.id).catch(() => {})
    await saveProgress(env, null, previous?.latest || null, error.message).catch(() => {})
    throw error
  }
}

async function listObjects(bucket, prefix) {
  const objects = []
  let cursor
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 })
    objects.push(...page.objects)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return objects
}
async function discardSnapshot(bucket, id) {
  if (!SAFE_ID.test(id)) throw new Error("Backup identifier is invalid.")
  const objects = await listObjects(bucket, `${PREFIX}${id}/`)
  for (let index = 0; index < objects.length; index += 1000)
    await bucket.delete(objects.slice(index, index + 1000).map((object) => object.key))
}
export async function retainBackups(bucket, now = Date.now()) {
  const objects = await listObjects(bucket, PREFIX)
  const completed = objects
    .filter((object) => object.key.endsWith("/manifest.hnbackup"))
    .map((object) => ({ key: object.key, id: object.key.split("/")[1] }))
    .filter((object) => SAFE_ID.test(object.id))
    .sort((a, b) => b.id.localeCompare(a.id))
  const dailyCutoff = now - 30 * 86_400_000
  const monthly = new Set()
  const keep = new Set()
  for (const entry of completed) {
    const month = entry.id.slice(0, 7)
    const timestamp = Date.parse(entry.id.slice(0, 10))
    if (timestamp >= dailyCutoff || (!monthly.has(month) && monthly.size < 12)) keep.add(entry.id)
    monthly.add(month)
  }
  for (const entry of completed) if (!keep.has(entry.id)) await discardSnapshot(bucket, entry.id)
}

/** Call while holding the backup lease; mark every retained snapshot before sweep. */
export async function garbageCollectBackupObjects(env, { now = Date.now() } = {}) {
  const snapshots = (await listObjects(env.BACKUP_BUCKET, PREFIX)).filter((entry) =>
    entry.key.endsWith("/manifest.hnbackup"),
  )
  const referenced = new Set()
  for (const snapshot of snapshots) {
    const manifest = await readEncrypted(env.BACKUP_BUCKET, snapshot.key, env.BACKUP_SECRET)
    if (!manifest?.completedAt || !Array.isArray(manifest.objects))
      throw new Error("Retained snapshot is incomplete; attachment collection is unsafe.")
    for (const object of manifest.objects) referenced.add(object.sha256)
  }
  const pending = await readEncrypted(env.BACKUP_BUCKET, PROGRESS, env.BACKUP_SECRET)
  for (const object of pending?.objects || []) referenced.add(object.sha256)
  if (pending?.pendingFile?.file?.sha256) referenced.add(pending.pendingFile.file.sha256)
  const objects = await listObjects(env.BACKUP_BUCKET, "objects/")
  const expired = objects.filter((object) => {
    const match = /^objects\/([a-f0-9]{64})\/(?:manifest|\d{6})\.hnbackup$/.exec(object.key)
    // A one-day grace period also protects files from an interrupted attempt
    // before its pending encrypted state had been saved.
    return (
      match &&
      !referenced.has(match[1]) &&
      object.uploaded &&
      new Date(object.uploaded).getTime() < now - 86_400_000
    )
  })
  for (let index = 0; index < expired.length; index += 1000)
    await env.BACKUP_BUCKET.delete(expired.slice(index, index + 1000).map((object) => object.key))
  await env.BACKUP_BUCKET.put(
    "control/collection.json",
    JSON.stringify({ checkedAt: now, deletedObjects: expired.length }),
  )
  return { deletedObjects: expired.length }
}

async function backupBundle(env, id, extraHeaders) {
  if (!SAFE_ID.test(id)) return json({ error: "备份不存在。" }, 404, extraHeaders)
  const manifestKey = `${PREFIX}${id}/manifest.hnbackup`
  const manifest = await readEncrypted(env.BACKUP_BUCKET, manifestKey, env.BACKUP_SECRET)
  if (!manifest) return json({ error: "备份不存在。" }, 404, extraHeaders)
  const keys = [
    manifestKey,
    ...manifest.parts.map((part) => part.key),
    ...manifest.objects.flatMap((object) => [object.key, ...object.parts.map((part) => part.key)]),
  ]
  let index = -1
  let reader = null
  const body = new ReadableStream({
    async pull(controller) {
      if (index === -1) {
        controller.enqueue(
          textEncoder.encode(
            JSON.stringify({ format: "howard-notes-backup-bundle-v2", snapshot: id }) + "\n",
          ),
        )
        index = 0
        return
      }
      if (reader) {
        const result = await reader.read()
        if (!result.done) return controller.enqueue(result.value)
        reader.releaseLock()
        reader = null
        index++
      }
      if (index >= keys.length) return controller.close()
      const key = keys[index]
      const object = await env.BACKUP_BUCKET.get(key)
      if (!object) return controller.error(new Error("Backup object is missing."))
      const header = textEncoder.encode(JSON.stringify({ key, size: object.size }))
      const frame = new Uint8Array(4 + header.byteLength)
      new DataView(frame.buffer).setUint32(0, header.byteLength)
      frame.set(header, 4)
      controller.enqueue(frame)
      reader = object.body.getReader()
    },
    async cancel(reason) {
      await reader?.cancel(reason)
    },
  })
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="notes-backup-${id}.hnbackup"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  })
}

/** Caller supplies the existing verified owner authorization and CORS policy. */
export async function backupsResponse(
  request,
  env,
  db,
  route,
  authorize,
  extraHeaders = {},
  context,
) {
  if (route !== "backups" && !route.startsWith("backups/")) return null
  try {
    // Shared owner authorization also recognizes an automation sync key.
    // That key never grants private backup status, execution or download.
    if (request.headers.has("X-Howard-Sync-Key"))
      return json({ error: "自动同步凭据无权访问个人备份。" }, 403, extraHeaders)
    await authorize(request)
    if (!env.BACKUP_BUCKET || !env.BACKUP_SECRET)
      return json({ configured: false, error: "独立备份尚未配置。" }, 503, extraHeaders)
    if (request.method === "GET" && (route === "backups" || route === "backups/status")) {
      const status = await readJson(env.BACKUP_BUCKET, STATUS)
      return json(
        { configured: true, ...(status || { latest: null, progress: null, error: null }) },
        200,
        extraHeaders,
      )
    }
    if (request.method === "GET" && route === "backups/download") {
      const id =
        new URL(request.url).searchParams.get("id") ||
        (await readJson(env.BACKUP_BUCKET, STATUS))?.latest?.id
      return backupBundle(env, id || "", extraHeaders)
    }
    if (request.method === "POST" && route === "backups/run") {
      let body = {}
      try {
        const text = await request.text()
        if (text) body = JSON.parse(text)
      } catch {
        return json({ error: "备份请求格式不正确。" }, 400, extraHeaders)
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        ![undefined, "start", "continue"].includes(body.action)
      )
        return json({ error: "备份操作不正确。" }, 400, extraHeaders)
      // force bypasses today's completed snapshot only when no pending job
      // exists. Repeated start calls still resume the same consistent job.
      const task = runScheduledBackup(env, {
        db,
        force: body.action !== "continue",
        maxQueries: 8,
        maxPages: 1,
      })
      if (context?.waitUntil) {
        context.waitUntil(task)
        return json({ status: "accepted" }, 202, extraHeaders)
      }
      return json(await task, 200, extraHeaders)
    }
    return json({ error: "备份操作不存在。" }, 404, extraHeaders)
  } catch (error) {
    return json(
      { error: error.status ? error.message : "备份暂未完成，请保留已有副本并重试。" },
      error.status || 503,
      extraHeaders,
    )
  }
}
