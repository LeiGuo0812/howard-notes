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
const EXPORT_KEY_HEADER = "X-Howard-Backup-Key"
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
  if (tables.length !== BACKUP_TABLES.length)
    throw new Error("A required canonical backup table is missing.")
  for (const table of tables) {
    for (const operation of ["insert", "update", "delete"]) {
      const name = `backup_epoch_${table.name}_${operation}`
      const guard = rows.find((row) => row.type === "trigger" && row.name === name)
      const normalized = guard?.sql
        ?.toLowerCase()
        .replace(/\bif\s+not\s+exists\s+/g, "")
        .replace(/[\s"`\[\]]/g, "")
        .replace(/;$/, "")
      const expected = `createtrigger${name}after${operation}on${table.name}beginupdatebackups_epochsetgeneration=generation+1whereid=1;end`
      if (guard?.tbl_name !== table.name || normalized !== expected)
        throw new Error("A canonical table is missing its valid backup mutation guard.")
    }
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
  // D1's production compound-SELECT limit is lower than local SQLite's.
  // Independent scalar counts keep one query without a ten-term UNION.
  return (
    "SELECT " +
    definitions
      .map((table) => `(SELECT COUNT(*) FROM "${table.name}") AS "${table.name}"`)
      .join(",")
  )
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
        firstStartedAt: job.firstStartedAt || job.createdAt,
        restartCount: job.restartCount || 0,
        attempts: (job.restartCount || 0) + 1,
        copiedTables: job.tableIndex,
        totalTables: job.tables.length,
        rows: job.parts.reduce((sum, part) => sum + part.rows, 0),
        privateBytes:
          job.objects.reduce((sum, object) => sum + object.size, 0) +
          (job.pendingFile?.offset || 0),
      }
    : null
}
async function saveProgress(env, job, latest, error = null, metrics = {}) {
  if (job) await writeEncrypted(env.BACKUP_BUCKET, PROGRESS, job, env.BACKUP_SECRET)
  else await env.BACKUP_BUCKET.delete(PROGRESS)
  await env.BACKUP_BUCKET.put(
    STATUS,
    JSON.stringify({
      latest,
      progress: publicProgress(job),
      error,
      checkedAt: new Date().toISOString(),
      ...metrics,
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
  const maxPages = Math.max(1, Math.min(8, options.maxPages ?? 4))
  const maxFileChunks = Math.max(1, Math.min(4, options.maxFileChunks ?? 1))
  const deadline = Date.now() + Math.max(250, Math.min(15_000, options.maxMilliseconds ?? 8_000))
  const previous = await readJson(env.BACKUP_BUCKET, STATUS)
  let job = await readEncrypted(env.BACKUP_BUCKET, PROGRESS, env.BACKUP_SECRET)
  // A retried manual intent may arrive after another invocation completed it.
  // Compare under the same lease, before force can create a second snapshot.
  if (
    !job &&
    options.force &&
    options.expectedLatestId !== undefined &&
    (previous?.latest?.id ?? null) !== options.expectedLatestId
  )
    return { status: "current", latest: previous?.latest || null }
  if (
    !job &&
    !options.force &&
    previous?.latest?.completedAt?.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
  )
    return { status: "current", latest: previous.latest }
  let restartCount = job?.restartCount || previous?.restartCount || 0
  let firstStartedAt =
    job?.firstStartedAt || job?.createdAt || previous?.firstStartedAt || new Date(now).toISOString()
  try {
    let queries = 0
    const definitions = await schema(db)
    queries++
    const generation = await epoch(db)
    queries++
    if (job && job.generation !== generation) {
      await discardSnapshot(env.BACKUP_BUCKET, job.id)
      restartCount++
      job = null
    }
    if (!job) {
      const counts = definitions.tables.length
        ? await db.prepare(rowCounts(definitions.tables)).first()
        : {}
      if (definitions.tables.length) queries++
      const id =
        new Date(now).toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomUUID().slice(0, 8)
      job = {
        format: "howard-notes-logical-backup-v1",
        id,
        generation,
        createdAt: new Date(now).toISOString(),
        firstStartedAt,
        restartCount,
        tables: definitions.tables.map((table) => {
          return {
            ...table,
            expectedRows: counts?.[table.name] || 0,
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
    let copiedAttachment = 0
    while (job.pendingFile && copiedAttachment < maxFileChunks && Date.now() < deadline) {
      job.pendingFile = await backupPrivateFile(
        env,
        job.pendingFile.file,
        job.objects,
        job.pendingFile,
      )
      copiedAttachment++
    }
    while (
      job.tableIndex < job.tables.length &&
      queries < budget - 2 &&
      copiedPages < maxPages &&
      !job.pendingFile &&
      copiedAttachment < maxFileChunks &&
      Date.now() < deadline
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
        // File ranges remain bounded; cron may copy up to four 256KiB chunks
        // per invocation before persisting its encrypted checkpoint.
        job.pendingFile = await backupPrivateFile(env, values[0], job.objects)
        copiedAttachment++
        while (job.pendingFile && copiedAttachment < maxFileChunks && Date.now() < deadline) {
          job.pendingFile = await backupPrivateFile(
            env,
            job.pendingFile.file,
            job.objects,
            job.pendingFile,
          )
          copiedAttachment++
        }
      }
    }
    if ((await epoch(db)) !== job.generation)
      throw new Error("Canonical data changed during backup.")
    if (job.tableIndex < job.tables.length) {
      await saveProgress(env, job, previous?.latest || null)
      return { status: "progress", progress: publicProgress(job) }
    }
    // Revalidate the complete canonical structure before activating the manifest.
    await schema(db)
    const latest = {
      id: job.id,
      createdAt: job.createdAt,
      completedAt: new Date(now).toISOString(),
      rows: job.parts.reduce((sum, part) => sum + part.rows, 0),
      tables: job.tables.length,
      bytes: job.parts.reduce((sum, part) => sum + part.bytes, 0),
      privateFiles: job.objects.length,
      privateBytes: job.objects.reduce((total, file) => total + file.size, 0),
      durationMs: Math.max(0, now - Date.parse(job.createdAt)),
      totalDurationMs: Math.max(0, now - Date.parse(firstStartedAt)),
      restartCount,
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
    if (error.message === "Canonical data changed during backup.") restartCount++
    await saveProgress(env, null, previous?.latest || null, error.message, {
      restartCount,
      firstStartedAt,
    }).catch(() => {})
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

function canonicalExportKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null
  try {
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
    if (
      decoded.length !== 32 ||
      btoa(decoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== value
    )
      return null
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

async function equalKeyBytes(actual, configured) {
  const digests = await Promise.all(
    [actual, configured].map((bytes) => crypto.subtle.digest("SHA-256", bytes)),
  )
  const left = new Uint8Array(digests[0])
  const right = new Uint8Array(digests[1])
  let mismatch = 0
  // Both hashes always have 32 bytes; do not stop at the first difference.
  for (let index = 0; index < 32; index++) mismatch |= left[index] ^ right[index]
  return mismatch === 0
}

async function exportKeyMatches(candidate, configured) {
  const actual = canonicalExportKey(candidate)
  return actual ? equalKeyBytes(actual, configured) : false
}

function isoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

function completeManifestKeys(manifest, id) {
  if (
    !manifest ||
    manifest.format !== "howard-notes-logical-backup-v1" ||
    manifest.id !== id ||
    !isoTimestamp(manifest.createdAt) ||
    !isoTimestamp(manifest.completedAt) ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.parts) ||
    !Array.isArray(manifest.objects)
  )
    throw new Error("Only a completed canonical snapshot may be exported.")
  const snapshotPrefix = `${PREFIX}${id}/`
  const keys = [snapshotPrefix + "manifest.hnbackup"]
  const tables = new Set()
  for (const table of manifest.tables) {
    if (!BACKUP_TABLES.includes(table?.name) || tables.has(table.name))
      throw new Error("Snapshot contains an unsupported table.")
    tables.add(table.name)
  }
  if (tables.size !== BACKUP_TABLES.length)
    throw new Error("Snapshot is missing a required canonical table.")
  for (const part of manifest.parts) {
    if (
      !part ||
      !tables.has(part.table) ||
      typeof part.key !== "string" ||
      !part.key.startsWith(snapshotPrefix) ||
      !/^\d{6}\.hnbackup$/.test(part.key.slice(snapshotPrefix.length))
    )
      throw new Error("Snapshot part does not belong to the selected snapshot.")
    keys.push(part.key)
  }
  for (const object of manifest.objects) {
    if (
      !object ||
      typeof object.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(object.sha256) ||
      !Array.isArray(object.parts)
    )
      throw new Error("Snapshot attachment reference is invalid.")
    const objectPrefix = `objects/${object.sha256}/`
    if (object.key !== objectPrefix + "manifest.hnbackup")
      throw new Error("Snapshot attachment manifest is invalid.")
    keys.push(object.key)
    for (const part of object.parts) {
      if (
        typeof part?.key !== "string" ||
        !part.key.startsWith(objectPrefix) ||
        !/^\d{6}\.hnbackup$/.test(part.key.slice(objectPrefix.length))
      )
        throw new Error("Snapshot attachment part is invalid.")
      keys.push(part.key)
    }
  }
  if (new Set(keys).size !== keys.length)
    throw new Error("Snapshot contains duplicate object references.")
  return keys
}

function exportMetadata(value) {
  if (
    !value ||
    typeof value.id !== "string" ||
    !SAFE_ID.test(value.id) ||
    !isoTimestamp(value.createdAt) ||
    !isoTimestamp(value.completedAt) ||
    ["rows", "tables", "bytes", "privateFiles"].some(
      (field) => !Number.isSafeInteger(value[field]) || value[field] < 0,
    ) ||
    value.tables !== BACKUP_TABLES.length
  )
    return null
  return {
    id: value.id,
    createdAt: value.createdAt,
    completedAt: value.completedAt,
    rows: value.rows,
    tables: value.tables,
    bytes: value.bytes,
    privateFiles: value.privateFiles,
  }
}

async function backupBundle(env, id, extraHeaders) {
  if (!SAFE_ID.test(id)) return json({ error: "备份不存在。" }, 404, extraHeaders)
  const manifestKey = `${PREFIX}${id}/manifest.hnbackup`
  const manifest = await readEncrypted(env.BACKUP_BUCKET, manifestKey, env.BACKUP_SECRET)
  if (!manifest) return json({ error: "备份不存在。" }, 404, extraHeaders)
  const keys = completeManifestKeys(manifest, id)
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

/** Server automation can inspect or copy ciphertext, never operate as the owner. */
async function exportBackupsResponse(request, env, route, extraHeaders) {
  if (!["backups/export/status", "backups/export/download"].includes(route))
    return json({ error: "备份导出操作不存在。" }, 404, extraHeaders)
  if (request.method !== "GET")
    return json({ error: "备份导出接口仅支持 GET。" }, 405, extraHeaders)
  const configured = canonicalExportKey(env.BACKUP_EXPORT_KEY)
  if (
    !configured ||
    !env.BACKUP_BUCKET ||
    !env.BACKUP_SECRET ||
    env.BACKUP_EXPORT_KEY === env.BACKUP_SECRET ||
    env.BACKUP_EXPORT_KEY === env.SYNC_SECRET ||
    env.BACKUP_EXPORT_KEY === env.CONTENT_SYNC_KEY
  )
    return json({ configured: false, error: "独立备份导出尚未配置。" }, 503, extraHeaders)
  try {
    // The encryption format also accepts a padded encoding. Compare decoded
    // bytes so adding padding cannot accidentally reuse the recovery key.
    if (await equalKeyBytes(backupKey(env.BACKUP_SECRET), configured))
      return json({ configured: false, error: "独立备份导出尚未配置。" }, 503, extraHeaders)
  } catch {
    return json({ configured: false, error: "独立备份导出尚未配置。" }, 503, extraHeaders)
  }
  // No login cookie, bearer token or content-sync credential can substitute
  // for this separate server-only capability, or combine to broaden its scope.
  if (
    request.headers.has("X-Howard-Sync-Key") ||
    request.headers.has("Authorization") ||
    request.headers.has("Cookie") ||
    !(await exportKeyMatches(request.headers.get(EXPORT_KEY_HEADER), configured))
  )
    return json({ error: "备份导出凭据不正确。" }, 403, extraHeaders)
  const parameters = new URL(request.url).searchParams
  if (route === "backups/export/status") {
    if ([...parameters].length)
      return json({ error: "备份状态不接受查询参数。" }, 400, extraHeaders)
    const status = await readJson(env.BACKUP_BUCKET, STATUS)
    let latest = exportMetadata(status?.latest)
    if (latest) {
      const manifest = await readEncrypted(
        env.BACKUP_BUCKET,
        `${PREFIX}${latest.id}/manifest.hnbackup`,
        env.BACKUP_SECRET,
      )
      if (!manifest) latest = null
      else {
        completeManifestKeys(manifest, latest.id)
        if (manifest.createdAt !== latest.createdAt || manifest.completedAt !== latest.completedAt)
          throw new Error("Backup metadata does not match its completed snapshot.")
      }
    }
    // Never spread the stored status: progress, job errors, recovery secrets
    // and future owner-only fields must stay outside this capability.
    return json({ configured: true, latest }, 200, extraHeaders)
  }
  if (
    [...parameters.keys()].some((key) => key !== "id") ||
    parameters.getAll("id").length !== 1 ||
    !SAFE_ID.test(parameters.get("id") || "")
  )
    return json({ error: "备份下载必须指定有效快照。" }, 400, extraHeaders)
  return backupBundle(env, parameters.get("id"), extraHeaders)
}

/** Read-only metadata totals. Missing catalogue links are not proof of garbage. */
export async function backupStorageReport(db, now = Date.now()) {
  const files = await db
    .prepare(
      `SELECT
    COUNT(*) AS registeredCount, COALESCE(SUM(size),0) AS registeredBytes,
    SUM(CASE WHEN complete=0 THEN 1 ELSE 0 END) AS incompleteCount,
    SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM personal_attachments a WHERE a.file_id=personal_files.id) THEN 1 ELSE 0 END) AS uncataloguedCount,
    COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM personal_attachments a WHERE a.file_id=personal_files.id) THEN size ELSE 0 END),0) AS uncataloguedBytes
    FROM personal_files`,
    )
    .first()
  const unique = await db
    .prepare(
      "SELECT COUNT(*) AS uniqueObjectCount,COALESCE(SUM(size),0) AS uniqueObjectBytes FROM (SELECT object_key,MAX(size) AS size FROM personal_files WHERE complete=1 GROUP BY object_key)",
    )
    .first()
  const records = await db
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM personal_articles) AS articles,
    (SELECT COUNT(*) FROM personal_drafts) AS drafts,
    (SELECT COUNT(*) FROM personal_article_versions) AS articleVersions,
    (SELECT COUNT(*) FROM personal_draft_versions) AS draftVersions,
    (SELECT COUNT(*) FROM personal_articles WHERE status='TRASH') AS trashedArticles,
    (SELECT COUNT(*) FROM personal_drafts WHERE status='TRASH') AS trashedDrafts`,
    )
    .first()
  let queue = null
  try {
    const row = await db
      .prepare(
        `SELECT
      SUM(CASE WHEN status IN ('queued','running','retry','awaiting_sync','awaiting_auth') THEN 1 ELSE 0 END) AS activeCount,
      SUM(CASE WHEN status='awaiting_auth' THEN 1 ELSE 0 END) AS awaitingAuthCount,
      MIN(CASE WHEN status IN ('queued','running','retry','awaiting_sync','awaiting_auth') THEN created_at END) AS oldestCreatedAt
      FROM publication_jobs`,
      )
      .first()
    queue = {
      activeCount: row.activeCount || 0,
      awaitingAuthCount: row.awaitingAuthCount || 0,
      oldestPendingAgeMs:
        row.oldestCreatedAt == null ? null : Math.max(0, now - row.oldestCreatedAt),
    }
  } catch {
    /* Older restored databases may not have the transient publication queue yet. */
  }
  return {
    files: {
      ...files,
      ...unique,
      incompleteCount: files.incompleteCount || 0,
      uncataloguedCount: files.uncataloguedCount || 0,
    },
    records,
    queue,
    policy: {
      deletionEnabled: false,
      unreferencedProven: false,
      reason:
        "Current Markdown, drafts, version history, trash and retained backups may reference uncatalogued originals; all originals remain preserved.",
    },
  }
}

export function backupHealth(status, now = Date.now()) {
  const completed = Date.parse(status?.latest?.completedAt)
  const ageMs = Number.isFinite(completed) ? Math.max(0, now - completed) : null
  return {
    ageMs,
    stale: ageMs === null || ageMs > 48 * 60 * 60_000,
    restartCount: status?.progress?.restartCount ?? status?.restartCount ?? 0,
    durationMs: status?.latest?.durationMs ?? null,
    privateBytes: status?.latest?.privateBytes ?? null,
  }
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
    if (route === "backups/export" || route.startsWith("backups/export/"))
      return await exportBackupsResponse(request, env, route, extraHeaders)
    // A server export credential is intentionally incapable of entering the
    // existing owner authorization, including backup start/run endpoints.
    if (request.headers.has(EXPORT_KEY_HEADER))
      return json({ error: "备份导出凭据仅允许读取状态和下载密文。" }, 403, extraHeaders)
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
        {
          configured: true,
          ...(status || { latest: null, progress: null, error: null }),
          health: backupHealth(status),
        },
        200,
        extraHeaders,
      )
    }
    if (request.method === "GET" && route === "backups/storage")
      return json(await backupStorageReport(db), 200, extraHeaders)
    if (request.method === "GET" && route === "backups/download") {
      const id =
        new URL(request.url).searchParams.get("id") ||
        (await readJson(env.BACKUP_BUCKET, STATUS))?.latest?.id
      return await backupBundle(env, id || "", extraHeaders)
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
        ![undefined, "start", "continue"].includes(body.action) ||
        (body.expectedLatestId !== undefined &&
          body.expectedLatestId !== null &&
          (typeof body.expectedLatestId !== "string" ||
            !/^[A-Za-z0-9_-]{1,100}$/.test(body.expectedLatestId)))
      )
        return json({ error: "备份操作不正确。" }, 400, extraHeaders)
      // force bypasses today's completed snapshot only when no pending job
      // exists. Repeated start calls still resume the same consistent job.
      const task = runScheduledBackup(env, {
        db,
        force: body.action !== "continue",
        expectedLatestId: body.expectedLatestId,
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
