import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { BACKUP_TABLES } from "../../content-service/backups.mjs"

const FORMAT = "howard-notes-cloud-restore-plan-v1"
const CHUNK_BYTES = 128 * 1024
const identifier = /^[a-z_][a-z0-9_]*$/
const hashPattern = /^[a-f0-9]{64}$/
export class RestorePlanError extends Error {
  constructor(code) {
    super(`Restore preparation failed (${code}); no cloud resources were changed.`)
    this.name = "RestorePlanError"
    this.code = code
  }
}
const fail = (code) => {
  throw new RestorePlanError(code)
}
function safeTargetName(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9-]{1,63}$/.test(value) &&
    /(?:^|-)(?:restore|staging)(?:-|$)/.test(value)
  )
}
export function validateRestoreTarget(target, production) {
  const database = target?.d1_databases?.find((binding) => binding.binding === "DB")
  const files = target?.r2_buckets?.find((binding) => binding.binding === "PERSONAL_FILES_BUCKET")
  const productionDatabase = production?.d1_databases?.find((binding) => binding.binding === "DB")
  const productionBuckets = production?.r2_buckets?.map((binding) => binding.bucket_name)
  if (
    !productionDatabase?.database_id ||
    !productionBuckets?.length ||
    !safeTargetName(target?.name) ||
    !safeTargetName(database?.database_name) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      database?.database_id || "",
    ) ||
    !safeTargetName(files?.bucket_name) ||
    target.name === production.name ||
    database.database_id === productionDatabase.database_id ||
    database.database_name === productionDatabase.database_name ||
    productionBuckets.includes(files.bucket_name) ||
    target.routes?.length ||
    target.route ||
    target.triggers?.crons?.length ||
    target.d1_databases.length !== 1 ||
    target.r2_buckets.length !== 1
  )
    fail("TARGET_ISOLATION")
  return {
    worker: target.name,
    database: { binding: "DB", name: database.database_name, id: database.database_id },
    privateFiles: { binding: "PERSONAL_FILES_BUCKET", bucket: files.bucket_name },
  }
}
async function safeFile(file) {
  const resolved = path.resolve(file)
  const stat = await fs.lstat(resolved)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (await fs.realpath(resolved)) !== resolved
  )
    fail("SOURCE_PATH")
  return stat
}
async function digest(file) {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
    bytes += chunk.length
  }
  return { sha256: hash.digest("hex"), bytes }
}
function cell(value) {
  if (value === null) return ["null"]
  if (typeof value === "bigint") return ["integer", value.toString()]
  if (typeof value === "number" && Number.isFinite(value)) return ["real", value]
  if (typeof value === "string") return ["text", value]
  if (value instanceof Uint8Array) return ["blob", Buffer.from(value).toString("base64")]
  fail("CELL_TYPE")
}
async function writeParts(chunks, output, prefix) {
  const parts = [],
    hash = createHash("sha256")
  let pending = Buffer.alloc(0),
    total = 0
  async function write(bytes) {
    const key = `${prefix}/${String(parts.length).padStart(6, "0")}.bin`
    await fs.writeFile(path.join(output, key), bytes, { mode: 0o600, flag: "wx" })
    parts.push({
      key,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
  }
  await fs.mkdir(path.join(output, prefix), { recursive: true, mode: 0o700 })
  for await (const chunk of chunks) {
    const bytes = Buffer.from(chunk)
    hash.update(bytes)
    total += bytes.length
    pending = Buffer.concat([pending, bytes])
    while (pending.length >= CHUNK_BYTES) {
      await write(pending.subarray(0, CHUNK_BYTES))
      pending = pending.subarray(CHUNK_BYTES)
    }
  }
  if (pending.length) await write(pending)
  return { bytes: total, sha256: hash.digest("hex"), parts }
}
/** Local preparation only. Every private byte stays in the new restricted directory. */
export async function prepareCloudRestore({
  databasePath,
  privateFilesPath,
  targetConfig,
  productionConfig,
  output,
}) {
  const target = validateRestoreTarget(targetConfig, productionConfig)
  await safeFile(databasePath)
  for (const suffix of ["-wal", "-journal"]) {
    const journal = await fs
      .stat(databasePath + suffix)
      .catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)))
    if (journal?.size) fail("DATABASE_NOT_STANDALONE")
  }
  const before = await digest(databasePath)
  let database,
    created = false
  try {
    await fs.mkdir(output, { mode: 0o700 })
    created = true
    if ((await fs.realpath(output)) !== path.resolve(output)) fail("OUTPUT_PATH")
    database = new DatabaseSync(databasePath, { readOnly: true })
    database.exec("BEGIN")
    if (database.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      fail("DATABASE_INTEGRITY")
    const definitions = database
      .prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
    if (BACKUP_TABLES.some((name) => !definitions.some((table) => table.name === name)))
      fail("CANONICAL_TABLES")
    const tables = []
    for (const name of BACKUP_TABLES) {
      const definition = definitions.find((table) => table.name === name)
      const columns = database
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((column) => column.name)
      if (!columns.length || columns.some((column) => !identifier.test(column))) fail("SCHEMA")
      const statement = database.prepare(
        `SELECT ${columns.map((column) => `"${column}"`).join(",")} FROM "${name}" ORDER BY rowid`,
      )
      statement.setReadBigInts(true)
      let rows = 0
      function* bytes() {
        for (const row of statement.iterate()) {
          rows++
          yield Buffer.from(JSON.stringify(columns.map((column) => cell(row[column]))) + "\n")
        }
      }
      const data = await writeParts(bytes(), output, `tables/${name}`)
      tables.push({ name, sql: definition.sql, columns, rows, ...data })
    }
    const files = [],
      seen = new Map()
    for (const file of database
      .prepare(
        "SELECT object_key,sha256,size FROM personal_files WHERE complete=1 ORDER BY object_key",
      )
      .iterate()) {
      if (
        !hashPattern.test(file.sha256) ||
        file.object_key !== `personal-files/${file.sha256}` ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0
      )
        fail("PRIVATE_FILE_IDENTITY")
      if (seen.has(file.sha256)) {
        if (seen.get(file.sha256) !== file.size) fail("PRIVATE_FILE_IDENTITY")
        continue
      }
      seen.set(file.sha256, file.size)
      const source = path.join(privateFilesPath, file.object_key)
      await safeFile(source)
      const data = await writeParts(createReadStream(source), output, `objects/${file.sha256}`)
      if (data.bytes !== file.size || data.sha256 !== file.sha256) fail("PRIVATE_FILE_HASH")
      files.push({ key: file.object_key, ...data })
    }
    const after = await digest(databasePath)
    if (before.sha256 !== after.sha256 || before.bytes !== after.bytes) fail("SOURCE_CHANGED")
    database.exec("COMMIT")
    const manifest = {
      format: FORMAT,
      target,
      sourceDatabase: before,
      tables,
      files,
      encoding: "typed-json-lines-v1",
      chunkBytes: CHUNK_BYTES,
      cloud: {
        accessed: false,
        emptyTargetVerified: false,
        writesPerformed: false,
        prerequisites: [
          "verify-new-D1-and-R2-are-empty",
          "install-current-versioned-schema",
          "bounded-idempotent-upload",
          "read-back-all-row-and-file-hashes",
          "switch-site-only-after-verification",
        ],
      },
    }
    await fs.writeFile(
      path.join(output, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    )
    return await verifyCloudRestorePlan(output)
  } catch (error) {
    if (created) await fs.rm(output, { recursive: true, force: true }).catch(() => {})
    if (error instanceof RestorePlanError) throw error
    throw new RestorePlanError("PREPARATION")
  } finally {
    database?.close()
  }
}
export async function verifyCloudRestorePlan(directory) {
  let manifest
  try {
    await safeFile(path.join(directory, "manifest.json"))
    manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"))
    if (
      manifest.format !== FORMAT ||
      manifest.encoding !== "typed-json-lines-v1" ||
      manifest.tables?.length !== BACKUP_TABLES.length ||
      new Set(manifest.tables.map((table) => table.name)).size !== BACKUP_TABLES.length ||
      !Array.isArray(manifest.files)
    )
      fail("MANIFEST")
    const used = new Set()
    async function verify(record, prefix, rows = false) {
      const aggregate = createHash("sha256")
      let bytes = 0,
        lineBuffer = "",
        rowCount = 0
      const decoder = new TextDecoder("utf-8", { fatal: true })
      for (const [index, part] of record.parts.entries()) {
        const expected = `${prefix}/${String(index).padStart(6, "0")}.bin`
        if (
          part.key !== expected ||
          used.has(expected) ||
          !hashPattern.test(part.sha256) ||
          part.bytes < 1 ||
          part.bytes > CHUNK_BYTES
        )
          fail("PART_IDENTITY")
        used.add(expected)
        const source = path.join(directory, expected)
        await safeFile(source)
        const value = await fs.readFile(source)
        if (
          value.length !== part.bytes ||
          createHash("sha256").update(value).digest("hex") !== part.sha256
        )
          fail("PART_HASH")
        aggregate.update(value)
        bytes += value.length
        if (rows) {
          lineBuffer += decoder.decode(value, { stream: true })
          if (lineBuffer.length > 32 * 1024 * 1024) fail("ROW_SIZE")
          let index
          while ((index = lineBuffer.indexOf("\n")) >= 0) {
            const cells = JSON.parse(lineBuffer.slice(0, index))
            if (
              !Array.isArray(cells) ||
              cells.length !== record.columns.length ||
              cells.some(
                (cell) =>
                  !Array.isArray(cell) ||
                  !["null", "integer", "real", "text", "blob"].includes(cell[0]),
              )
            )
              fail("ROW_ENCODING")
            rowCount++
            lineBuffer = lineBuffer.slice(index + 1)
          }
        }
      }
      if (rows && (lineBuffer + decoder.decode() !== "" || rowCount !== record.rows))
        fail("ROW_COUNT")
      if (bytes !== record.bytes || aggregate.digest("hex") !== record.sha256)
        fail("AGGREGATE_HASH")
    }
    for (const table of manifest.tables) {
      if (
        !BACKUP_TABLES.includes(table.name) ||
        !Array.isArray(table.columns) ||
        table.columns.some((column) => !identifier.test(column))
      )
        fail("SCHEMA")
      await verify(table, `tables/${table.name}`, true)
    }
    for (const file of manifest.files) {
      if (!hashPattern.test(file.sha256) || file.key !== `personal-files/${file.sha256}`)
        fail("PRIVATE_FILE_IDENTITY")
      await verify(file, `objects/${file.sha256}`)
    }
    return {
      verified: true,
      format: FORMAT,
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
      privateFiles: manifest.files.length,
      privateBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      parts: used.size,
      cloudAccessed: false,
      cloudWritesPerformed: false,
      cloudTargetEmptyVerified: false,
      containsPrivatePlaintext: true,
    }
  } catch (error) {
    if (error instanceof RestorePlanError) throw error
    throw new RestorePlanError("VERIFICATION")
  }
}
