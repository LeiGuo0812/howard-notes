import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import { backupHash, decryptBackup, decodeBackupJson, encodeBackupJson } from "./backup-crypto.mjs"
import { BACKUP_TABLES } from "../../content-service/backups.mjs"

const SAFE_KEY =
  /^(?:snapshots\/[0-9TZ:a-f-]+|objects\/[a-f0-9]{64})\/(?:\d{6}|manifest)\.hnbackup$/
function assertKey(key) {
  if (typeof key !== "string" || !SAFE_KEY.test(key))
    throw new Error("Backup object path is invalid.")
}

/** Copies encrypted objects only. Never writes decrypted source into an archive. */
export async function unpackBackupBundle(input, target) {
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  const chunks = createReadStream(input)[Symbol.asyncIterator]()
  let pending = Buffer.alloc(0),
    finished = false
  const take = async (size, allowEnd = false) => {
    const pieces = []
    let remaining = size
    while (remaining) {
      if (!pending.length) {
        const next = await chunks.next()
        if (next.done) {
          finished = true
          if (allowEnd && remaining === size) return null
          throw new Error("Backup bundle is truncated.")
        }
        pending = next.value
      }
      const count = Math.min(pending.length, remaining)
      pieces.push(pending.subarray(0, count))
      pending = pending.subarray(count)
      remaining -= count
    }
    return pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, size)
  }
  const heading = []
  while (heading.length < 1024) {
    const byte = await take(1)
    if (byte[0] === 10) break
    heading.push(byte[0])
  }
  const header = JSON.parse(Buffer.from(heading).toString("utf8"))
  if (header.format !== "howard-notes-backup-bundle-v2" || typeof header.snapshot !== "string")
    throw new Error("Backup bundle format is invalid.")
  let objects = 0
  const seen = new Set()
  while (!finished) {
    const lengthBytes = await take(4, true)
    if (!lengthBytes) break
    const length = lengthBytes.readUInt32BE()
    if (!length || length > 1024) throw new Error("Backup bundle object header is invalid.")
    const record = JSON.parse((await take(length)).toString("utf8"))
    assertKey(record.key)
    if (
      seen.has(record.key) ||
      !Number.isSafeInteger(record.size) ||
      record.size < 32 ||
      record.size > 64 * 1024 * 1024
    )
      throw new Error("Backup bundle contains duplicate or malformed objects.")
    const file = path.join(target, record.key)
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const destination = await fs.open(file, "wx", 0o600)
    try {
      for (let remaining = record.size; remaining > 0;) {
        const count = Math.min(64 * 1024, remaining)
        await destination.writeFile(await take(count))
        remaining -= count
      }
    } finally {
      await destination.close()
    }
    seen.add(record.key)
    objects++
  }
  if (!header || !seen.has(`snapshots/${header.snapshot}/manifest.hnbackup`))
    throw new Error("Backup bundle is incomplete.")
  return { snapshot: header.snapshot, objects, directory: target }
}

/** Restores only a new local staging SQLite database; never overwrites production. */
export async function verifyAndRestoreBackup({
  readObject,
  manifestKey,
  secret,
  databasePath,
  privateFilesPath,
}) {
  assertKey(manifestKey)
  const manifest = decodeBackupJson(
    await decryptBackup(await readObject(manifestKey), secret, manifestKey),
  )
  if (
    manifest.format !== "howard-notes-logical-backup-v1" ||
    !manifest.completedAt ||
    manifestKey !== `snapshots/${manifest.id}/manifest.hnbackup`
  )
    throw new Error("Only a completed logical snapshot can be restored.")
  if (
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.parts) ||
    !Array.isArray(manifest.objects)
  )
    throw new Error("Backup manifest is incomplete.")
  const names = new Set()
  for (const table of manifest.tables) {
    if (
      !BACKUP_TABLES.includes(table.name) ||
      names.has(table.name) ||
      !Array.isArray(table.columns) ||
      table.columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column))
    )
      throw new Error("Backup contains an unsupported canonical table.")
    names.add(table.name)
  }
  if (databasePath !== ":memory:") {
    await fs.mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 })
    const reserve = await fs.open(databasePath, "wx", 0o600)
    await reserve.close()
  }
  const database = new DatabaseSync(databasePath)
  let restoredRows = 0
  try {
    database.exec("BEGIN")
    // AES-GCM authenticates schema along with all manifest metadata. Restore
    // goes to an isolated staging DB, never the login DB or live D1 binding.
    for (const table of manifest.tables) database.exec(table.sql)
    for (const part of manifest.parts) {
      assertKey(part.key)
      const table = manifest.tables.find((entry) => entry.name === part.table)
      if (!table || !part.key.startsWith(`snapshots/${manifest.id}/`))
        throw new Error("Backup part belongs to another snapshot or table.")
      const bytes = await decryptBackup(await readObject(part.key), secret, part.key)
      if (bytes.byteLength !== part.bytes || (await backupHash(bytes)) !== part.sha256)
        throw new Error("Backup part checksum does not match.")
      const rows = decodeBackupJson(bytes)
      if (!Array.isArray(rows) || rows.length !== part.rows)
        throw new Error("Backup part row count does not match.")
      const insert = database.prepare(
        `INSERT INTO "${table.name}" (${table.columns.map((column) => `"${column}"`).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`,
      )
      for (const row of rows) {
        if (
          Object.keys(row).length !== table.columns.length ||
          table.columns.some((column) => !(column in row))
        )
          throw new Error("Backup row columns do not match its schema.")
        insert.run(...table.columns.map((column) => row[column]))
        restoredRows++
      }
      // Compare the values read back from SQLite with the original canonical
      // JSON. This catches truncation, type changes and CRLF/BOM alteration.
      const actual = rows.map((row) => {
        const primary = database
          .prepare(`PRAGMA table_info("${table.name}")`)
          .all()
          .filter((column) => column.pk)
          .sort((a, b) => a.pk - b.pk)
          .map((column) => column.name)
        if (!primary.length) throw new Error("Canonical backup table has no primary key.")
        return database
          .prepare(
            `SELECT * FROM "${table.name}" WHERE ${primary.map((column) => `"${column}" IS ?`).join(" AND ")}`,
          )
          .get(...primary.map((column) => row[column]))
      })
      if ((await backupHash(encodeBackupJson(actual))) !== part.sha256)
        throw new Error("Restored SQLite values differ from their original bytes.")
    }
    for (const table of manifest.tables) {
      if (
        database.prepare(`SELECT COUNT(*) count FROM "${table.name}"`).get().count !==
        table.expectedRows
      )
        throw new Error("Restored table row count does not match.")
    }
    for (const statement of manifest.indexes || []) database.exec(statement)
    if (database.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Restored SQLite integrity check failed.")
    database.exec("COMMIT")
    let privateBytes = 0
    for (const object of manifest.objects) {
      assertKey(object.key)
      if (
        !/^[a-f0-9]{64}$/.test(object.sha256) ||
        object.key !== `objects/${object.sha256}/manifest.hnbackup` ||
        object.sourceKey !== `personal-files/${object.sha256}`
      )
        throw new Error("Private file restore path is invalid.")
      const value = decodeBackupJson(
        await decryptBackup(await readObject(object.key), secret, object.key),
      )
      if (
        JSON.stringify(value) !==
        JSON.stringify({ sha256: object.sha256, size: object.size, parts: object.parts })
      )
        throw new Error("Private file manifest differs from its snapshot reference.")
      const hash = createHash("sha256")
      let size = 0
      const destination = privateFilesPath ? path.join(privateFilesPath, object.sourceKey) : null
      let writer = null
      if (destination) {
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        writer = await fs.open(destination, "wx", 0o600)
      }
      try {
        for (const part of object.parts) {
          assertKey(part.key)
          if (!part.key.startsWith(`objects/${object.sha256}/`))
            throw new Error("Private file part belongs to another file.")
          const bytes = await decryptBackup(await readObject(part.key), secret, part.key)
          if (bytes.byteLength !== part.bytes || (await backupHash(bytes)) !== part.sha256)
            throw new Error("Private file part checksum does not match.")
          hash.update(bytes)
          size += bytes.byteLength
          await writer?.writeFile(bytes)
        }
      } finally {
        await writer?.close()
      }
      if (size !== object.size || hash.digest("hex") !== object.sha256)
        throw new Error("Private file restore checksum does not match.")
      privateBytes += size
    }
    return {
      format: manifest.format,
      snapshot: manifest.id,
      completedAt: manifest.completedAt,
      sourceGeneration: manifest.generation,
      tables: manifest.tables.length,
      rowCounts: Object.fromEntries(
        manifest.tables.map((table) => [table.name, table.expectedRows]),
      ),
      rows: restoredRows,
      verifiedParts: manifest.parts.length,
      privateFiles: manifest.objects.length,
      privateBytes,
      integrity: "ok",
      originalBytesVerified: true,
    }
  } catch (error) {
    try {
      database.exec("ROLLBACK")
    } catch {
      /* Already committed; staging remains isolated. */
    }
    throw error
  } finally {
    database.close()
  }
}
