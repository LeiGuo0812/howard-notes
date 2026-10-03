import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import {
  backupsResponse,
  backupHealth,
  backupStorageReport,
  runScheduledBackup,
  retainBackups,
  garbageCollectBackupObjects,
} from "./backups.mjs"
import {
  backupHash,
  encryptBackup,
  decryptBackup,
  encodeBackupJson,
  decodeBackupJson,
} from "../scripts/lib/backup-crypto.mjs"
import { unpackBackupBundle, verifyAndRestoreBackup } from "../scripts/lib/backup-restore.mjs"
import { encryptBackupStream, decryptBackupStream } from "../scripts/lib/backup-node-stream.mjs"
import { handle, runScheduledTasks } from "./worker.mjs"

const secret = Buffer.alloc(32, 15).toString("base64url")
const now = Date.parse("2026-10-02T09:00:00.000Z")
class Bucket {
  objects = new Map()
  async put(key, value, options = {}) {
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)
    this.objects.set(key, { bytes, options, uploaded: new Date(now) })
    return { key }
  }
  async get(key, options = {}) {
    const value = this.objects.get(key)
    if (!value) return null
    const bytes = options.range
      ? value.bytes.subarray(options.range.offset, options.range.offset + options.range.length)
      : value.bytes
    return {
      key,
      size: value.bytes.byteLength,
      customMetadata: value.options.customMetadata,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
      body: new Response(bytes).body,
    }
  }
  async head(key) {
    return this.get(key)
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key)
  }
  async list({ prefix }) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key, uploaded: this.objects.get(key).uploaded })),
      truncated: false,
    }
  }
}
function fixture() {
  const sqlite = new DatabaseSync(":memory:")
  for (const file of ["memories-schema.sql", "personal-notes-schema.sql", "backups-schema.sql"])
    sqlite.exec(fsSync.readFileSync(new URL(file, import.meta.url), "utf8"))
  const raw = "\uFEFF# 中文笔记\r\n\r\n原文 '引号' **bold** `code`\n"
  sqlite
    .prepare(
      "INSERT INTO memory_cards (id,visibility,status,created_at,modified_at,body) VALUES ('memory','PRIVATE','NORMAL',1,2,?)",
    )
    .run(
      JSON.stringify({ content: raw, tags: ["private"], visibility: "PRIVATE", attachments: [] }),
    )
  sqlite
    .prepare(
      "INSERT INTO personal_articles (id,file,article,raw,created_at,updated_at,last_request_id) VALUES ('article','notes/private.md','{}',?,3,4,'request')",
    )
    .run(raw)
  let hook = null
  let queries = 0
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let values = []
      return {
        bind(...input) {
          values = input
          return this
        },
        async first() {
          queries++
          return statement.get(...values) || null
        },
        async all() {
          queries++
          const results = statement.all(...values)
          hook?.(sql)
          return { results }
        },
      }
    },
  }
  const env = {
    DB,
    BACKUP_BUCKET: new Bucket(),
    PERSONAL_FILES_BUCKET: new Bucket(),
    BACKUP_SECRET: secret,
    REPOSITORY: "owner/notes",
  }
  return {
    sqlite,
    DB,
    env,
    raw,
    setHook: (value) => {
      hook = value
    },
    queryCount: () => queries,
  }
}
async function manifestFor(env, id) {
  const key = `snapshots/${id}/manifest.hnbackup`
  return decodeBackupJson(
    await decryptBackup(await (await env.BACKUP_BUCKET.get(key)).arrayBuffer(), secret, key),
  )
}
async function completeBackup(f, options = {}) {
  for (let index = 0; index < 100; index++) {
    const before = f.queryCount()
    const result = await runScheduledBackup(f.env, { now, ...options })
    assert.ok(f.queryCount() - before <= 10, "bounded default invocation exceeds query budget")
    if (result.status !== "progress") return result
  }
  throw new Error("Backup did not converge within its bounded test fixture.")
}
test("AES-GCM validates key, context and ciphertext while keeping Chinese source encrypted", async () => {
  const bytes = encodeBackupJson({ raw: "private content 中文" })
  const encrypted = await encryptBackup(bytes, secret, "snapshot:one")
  assert.equal(Buffer.from(encrypted).includes(Buffer.from("private content")), false)
  assert.deepEqual(await decryptBackup(encrypted, secret, "snapshot:one"), bytes)
  await assert.rejects(decryptBackup(encrypted, secret, "snapshot:two"), /context/)
  await assert.rejects(
    decryptBackup(encrypted, Buffer.alloc(32, 16).toString("base64url"), "snapshot:one"),
  )
  encrypted[encrypted.length - 1] ^= 1
  await assert.rejects(decryptBackup(encrypted, secret, "snapshot:one"))
  await assert.rejects(encryptBackup(bytes, "short-key", "snapshot:one"), /32-byte/)
})
test("canonical backup excludes public projections and credentials, restores exact SQLite bytes", async () => {
  const f = fixture()
  f.sqlite.exec(
    "CREATE TABLE publication_jobs(id TEXT,token_cipher TEXT); INSERT INTO publication_jobs VALUES ('job','sensitive-job-token'); CREATE TABLE public_pages(path TEXT,body TEXT); INSERT INTO public_pages VALUES ('index','derived html');",
  )
  const result = await completeBackup(f)
  assert.equal(result.status, "complete")
  const manifest = await manifestFor(f.env, result.latest.id)
  assert.equal(manifest.tables.length, 10)
  assert.equal(JSON.stringify(manifest).includes("token_cipher"), false)
  assert.equal(JSON.stringify(manifest).includes("public_pages"), false)
  for (const value of f.env.BACKUP_BUCKET.objects.values())
    assert.equal(Buffer.from(value.bytes).includes(Buffer.from(f.raw)), false)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-backup-test-"))
  try {
    const databasePath = path.join(directory, "restore.sqlite")
    const report = await verifyAndRestoreBackup({
      readObject: async (key) => (await f.env.BACKUP_BUCKET.get(key)).arrayBuffer(),
      manifestKey: `snapshots/${manifest.id}/manifest.hnbackup`,
      secret,
      databasePath,
    })
    assert.equal(report.originalBytesVerified, true)
    assert.equal(report.rows, 2)
    const restored = new DatabaseSync(databasePath)
    assert.equal(restored.prepare("SELECT raw FROM personal_articles").get().raw, f.raw)
    assert.equal(
      JSON.parse(restored.prepare("SELECT body FROM memory_cards").get().body).content,
      f.raw,
    )
    restored.close()
    assert.equal((await runScheduledBackup(f.env, { now })).status, "current")
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test("paged backup resumes under the Free D1 read budget and never activates a torn snapshot", async () => {
  const f = fixture()
  let result = await runScheduledBackup(f.env, { now, maxQueries: 8 })
  assert.equal(result.status, "progress")
  let runs = 0
  while (result.status === "progress" && runs++ < 10)
    result = await runScheduledBackup(f.env, { now, maxQueries: 8 })
  assert.equal(result.status, "complete")
  let changed = false
  f.setHook((sql) => {
    if (sql.includes("__backup_rowid") && !changed) {
      changed = true
      f.sqlite.exec("UPDATE memory_cards SET version=version+1,body='changed'")
    }
  })
  await assert.rejects(runScheduledBackup(f.env, { now: now + 86_400_000 }), /changed/)
  assert.equal(
    [...f.env.BACKUP_BUCKET.objects.keys()].filter((key) => key.endsWith("/manifest.hnbackup"))
      .length,
    1,
  )
  const status = JSON.parse(await (await f.env.BACKUP_BUCKET.get("control/status.json")).text())
  assert.equal(status.latest.id, result.latest.id)
  assert.match(status.error, /changed/)
})
test("D1 selects bounded next-page bytes without making all rows single-page after one oversized article", async () => {
  const f = fixture()
  const insert = f.sqlite.prepare(
    "INSERT INTO personal_articles (id,file,article,raw,created_at,updated_at,last_request_id) VALUES (?,?,?, ?,1,1,'request')",
  )
  insert.run("large", "notes/large.md", "{}", "中文".repeat(50000))
  for (let index = 0; index < 50; index++) {
    insert.run(
      `small-${index}`,
      `notes/small-${index}.md`,
      "{}",
      '# 小笔记\r\n包含 "引号" 和零字符\u0000\t'.repeat(30),
    )
  }
  for (let index = 0; index < 8; index++)
    insert.run(`medium-${index}`, `notes/medium-${index}.md`, "{}", "x".repeat(60_000))
  const result = await completeBackup(f)
  const manifest = await manifestFor(f.env, result.latest.id)
  const parts = manifest.parts.filter((part) => part.table === "personal_articles")
  assert.equal(
    parts.reduce((sum, part) => sum + part.rows, 0),
    60,
  )
  assert.ok(
    parts.some((part) => part.rows === 25),
    "small articles still share a full candidate page",
  )
  assert.ok(parts.length < 15, "one oversized note must not force sixty single-row pages")
  assert.ok(parts.some((part) => part.rows === 1 && part.bytes > 128 * 1024))
  for (const part of parts) {
    assert.ok(part.rows <= 25)
    assert.ok(
      part.rows === 1 || part.bytes <= 128 * 1024,
      "only a first oversized row may exceed the byte budget",
    )
  }
  const report = await verifyAndRestoreBackup({
    readObject: async (key) => (await f.env.BACKUP_BUCKET.get(key)).arrayBuffer(),
    manifestKey: `snapshots/${manifest.id}/manifest.hnbackup`,
    secret,
    databasePath: ":memory:",
  })
  assert.equal(report.rowCounts.personal_articles, 60)
  assert.equal(report.originalBytesVerified, true)
})
test("missing mutation guards prevent claiming a consistent canonical snapshot", async () => {
  const f = fixture()
  f.sqlite.exec("DROP TRIGGER backup_epoch_memory_cards_update")
  await assert.rejects(runScheduledBackup(f.env, { now }), /missing.*guard/)
  assert.equal(
    [...f.env.BACKUP_BUCKET.objects.keys()].some((key) => key.endsWith("/manifest.hnbackup")),
    false,
  )
})
test("all canonical table counts avoid D1's production compound SELECT limit", async () => {
  const f = fixture()
  const originalPrepare = f.DB.prepare
  f.DB.prepare = (sql) => {
    if (/\bUNION\b/i.test(sql)) throw new Error("D1_ERROR: too many terms in compound SELECT")
    return originalPrepare(sql)
  }
  const result = await completeBackup(f)
  const manifest = await manifestFor(f.env, result.latest.id)
  assert.equal(manifest.tables.length, 10)
  assert.equal(manifest.tables.find((table) => table.name === "personal_articles").expectedRows, 1)
  assert.equal(manifest.tables.find((table) => table.name === "memory_cards").expectedRows, 1)
  assert.equal(manifest.tables.find((table) => table.name === "personal_files").expectedRows, 0)
})
test("simultaneous invocations share a lease and low-CPU page limits resume safely", async () => {
  const f = fixture()
  f.sqlite.prepare("INSERT INTO backups_lease VALUES (1,'existing',?)").run(now + 60_000)
  assert.equal((await runScheduledBackup(f.env, { now })).status, "busy")
  f.sqlite.exec("DELETE FROM backups_lease")
  const first = await runScheduledBackup(f.env, { now, maxPages: 1 })
  assert.equal(first.status, "progress")
  let result = first
  for (let index = 0; index < 15 && result.status === "progress"; index++)
    result = await runScheduledBackup(f.env, { now, maxPages: 1 })
  assert.equal(result.status, "complete")
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM backups_lease").get().count, 0)
})
test("private R2 attachments are encrypted by immutable SHA, reused and restored in bounded chunks", async () => {
  const f = fixture()
  const bytes = new Uint8Array(1024 * 1024 + 333).fill(173)
  const sha256 = await backupHash(bytes)
  const sourceKey = `personal-files/${sha256}`
  await f.env.PERSONAL_FILES_BUCKET.put(sourceKey, bytes)
  f.sqlite
    .prepare("INSERT INTO personal_files VALUES ('file','private.png','image/png',?,?,?,1,2,'{}')")
    .run(bytes.byteLength, sha256, sourceKey)
  const one = await completeBackup(f)
  const manifest = await manifestFor(f.env, one.latest.id)
  assert.equal(manifest.objects[0].parts.length, 5)
  const oldObjects = [...f.env.BACKUP_BUCKET.objects.keys()].filter((key) =>
    key.startsWith("objects/"),
  )
  const two = await completeBackup(f, { now: now + 86_400_000 })
  assert.deepEqual(
    [...f.env.BACKUP_BUCKET.objects.keys()].filter((key) => key.startsWith("objects/")),
    oldObjects,
  )
  assert.notEqual(one.latest.id, two.latest.id)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-private-restore-"))
  try {
    const report = await verifyAndRestoreBackup({
      readObject: async (key) => (await f.env.BACKUP_BUCKET.get(key)).arrayBuffer(),
      manifestKey: `snapshots/${manifest.id}/manifest.hnbackup`,
      secret,
      databasePath: ":memory:",
      privateFilesPath: directory,
    })
    assert.equal(report.privateBytes, bytes.byteLength)
    assert.deepEqual(new Uint8Array(await fs.readFile(path.join(directory, sourceKey))), bytes)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test("owner-only encrypted download can be exported, unpacked and verified without revealing source", async () => {
  const f = fixture()
  await completeBackup(f)
  const authorize = async (request) => {
    if (request.headers.get("Authorization") !== "Bearer owner") {
      const error = new Error("Login required")
      error.status = 401
      throw error
    }
  }
  const request = (route, owner = false) =>
    new Request(`https://notes.example/howard-notes/api/content/${route}`, {
      headers: owner ? { Authorization: "Bearer owner" } : {},
    })
  assert.equal(
    (await backupsResponse(request("backups/status"), f.env, f.DB, "backups/status", authorize))
      .status,
    401,
  )
  const status = await backupsResponse(
    request("backups/status", true),
    f.env,
    f.DB,
    "backups/status",
    authorize,
  )
  assert.equal((await status.json()).configured, true)
  const response = await backupsResponse(
    request("backups/download", true),
    f.env,
    f.DB,
    "backups/download",
    authorize,
  )
  const bundle = Buffer.from(await response.arrayBuffer())
  assert.equal(bundle.includes(Buffer.from(f.raw)), false)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-bundle-test-"))
  try {
    const input = path.join(directory, "bundle.hnbackup")
    await fs.writeFile(input, bundle)
    const unpacked = await unpackBackupBundle(input, path.join(directory, "objects"))
    const report = await verifyAndRestoreBackup({
      readObject: (key) => fs.readFile(path.join(unpacked.directory, key)),
      manifestKey: `snapshots/${unpacked.snapshot}/manifest.hnbackup`,
      secret,
      databasePath: ":memory:",
    })
    assert.equal(report.rows, 2)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test("backup endpoints reject automation sync credentials before shared authorization", async () => {
  const f = fixture()
  let authorized = 0
  const authorize = async () => {
    authorized++
  }
  for (const [method, route] of [
    ["GET", "backups"],
    ["GET", "backups/status"],
    ["GET", "backups/download"],
    ["POST", "backups/run"],
  ]) {
    for (const value of ["valid-automation-key", ""]) {
      const response = await backupsResponse(
        new Request(`https://notes.example/api/content/${route}`, {
          method,
          headers: { "X-Howard-Sync-Key": value, Authorization: "Bearer owner" },
        }),
        f.env,
        f.DB,
        route,
        authorize,
      )
      assert.equal(response.status, 403)
    }
  }
  assert.equal(authorized, 0)
  assert.equal(f.queryCount(), 0)
  assert.equal(f.env.BACKUP_BUCKET.objects.size, 0)
})
const exportSecret = Buffer.alloc(32, 28).toString("base64url")
const syncSecret = Buffer.alloc(32, 29).toString("base64url")
function exportAccess(f) {
  f.env.BACKUP_EXPORT_KEY = exportSecret
  f.env.SYNC_SECRET = syncSecret
  f.env.CONTENT_SYNC_KEY = syncSecret
  let ownerCalls = 0
  const call = (route = "backups/export/status", options = {}) =>
    backupsResponse(
      new Request(`https://notes.example/howard-notes/api/content/${route}`, {
        ...options,
        headers: { "X-Howard-Backup-Key": exportSecret, ...options.headers },
      }),
      f.env,
      f.DB,
      route.split("?")[0],
      async () => {
        ownerCalls++
        throw new Error("Dedicated export must never call owner authorization.")
      },
    )
  return { call, ownerCalls: () => ownerCalls }
}
test("dedicated export status reveals only complete snapshot metadata and never enters owner auth", async () => {
  const f = fixture()
  const result = await completeBackup(f)
  const access = exportAccess(f)
  await f.env.BACKUP_BUCKET.put(
    "control/status.json",
    JSON.stringify({
      latest: { ...result.latest, raw: f.raw, recoveryKey: secret },
      progress: { body: f.raw, token: "private-job-token" },
      error: "private-storage-error",
      checkedAt: "owner-only-field",
      encryptionKey: secret,
    }),
  )
  const before = f.queryCount()
  const response = await access.call()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), null)
  const status = await response.json()
  assert.deepEqual(status, {
    configured: true,
    latest: Object.fromEntries(
      ["id", "createdAt", "completedAt", "rows", "tables", "bytes", "privateFiles"].map((key) => [
        key,
        result.latest[key],
      ]),
    ),
  })
  assert.deepEqual(Object.keys(status.latest), [
    "id",
    "createdAt",
    "completedAt",
    "rows",
    "tables",
    "bytes",
    "privateFiles",
  ])
  const text = JSON.stringify(status)
  for (const privateValue of [
    f.raw,
    secret,
    exportSecret,
    syncSecret,
    "private-job-token",
    "private-storage-error",
  ])
    assert.equal(text.includes(privateValue), false)
  assert.equal(access.ownerCalls(), 0)
  assert.equal(f.queryCount(), before)
})
test("dedicated export accepts only a canonical 43-character 32-byte key and rejects login/sync substitutes", async () => {
  const f = fixture()
  const access = exportAccess(f)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  const noncanonical =
    exportSecret.slice(0, -1) + alphabet[alphabet.indexOf(exportSecret.at(-1)) ^ 1]
  assert.deepEqual(Buffer.from(noncanonical, "base64url"), Buffer.from(exportSecret, "base64url"))
  for (const key of [
    "",
    "short",
    exportSecret + "=",
    "+".repeat(43),
    noncanonical,
    Buffer.alloc(32, 30).toString("base64url"),
    secret,
    syncSecret,
    `${exportSecret}, ${exportSecret}`,
  ]) {
    const response = await access.call("backups/export/status", {
      headers: { "X-Howard-Backup-Key": key },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    assert.doesNotMatch(
      await response.text(),
      /control\/|snapshots\/|personal_|private-job|generation/,
    )
  }
  for (const headers of [
    { "X-Howard-Backup-Key": "", Cookie: "owner=synthetic" },
    { "X-Howard-Backup-Key": "", Authorization: "Bearer owner" },
    { Cookie: "owner=synthetic" },
    { Authorization: "Bearer owner" },
    { "X-Howard-Sync-Key": syncSecret },
    { "X-Howard-Sync-Key": "" },
  ])
    assert.equal((await access.call("backups/export/status", { headers })).status, 403)
  assert.equal(access.ownerCalls(), 0)
  assert.equal(f.queryCount(), 0)
  assert.equal(f.env.BACKUP_BUCKET.objects.size, 0)
})
test("dedicated export is unconfigured without separate valid export, encryption and storage bindings", async () => {
  const scenarios = [
    { BACKUP_EXPORT_KEY: undefined },
    { BACKUP_EXPORT_KEY: "invalid" },
    { BACKUP_EXPORT_KEY: exportSecret + "=" },
    { BACKUP_EXPORT_KEY: secret },
    { BACKUP_SECRET: exportSecret + "=" },
    { BACKUP_EXPORT_KEY: syncSecret },
    { SYNC_SECRET: exportSecret },
    { CONTENT_SYNC_KEY: exportSecret },
    { BACKUP_SECRET: undefined },
    { BACKUP_SECRET: "invalid" },
    { BACKUP_BUCKET: undefined },
  ]
  for (const patch of scenarios) {
    const f = fixture()
    const access = exportAccess(f)
    Object.assign(f.env, patch)
    const response = await access.call()
    assert.equal(response.status, 503)
    assert.equal((await response.json()).configured, false)
    assert.equal(access.ownerCalls(), 0)
    assert.equal(f.queryCount(), 0)
  }
})
test("dedicated key cannot access owner operations, extra routes, methods or arbitrary download parameters", async () => {
  const f = fixture()
  const access = exportAccess(f)
  for (const [route, options, expected] of [
    ["backups", {}, 403],
    ["backups/status", {}, 403],
    ["backups/download", {}, 403],
    ["backups/run", { method: "POST", body: '{"action":"start"}' }, 403],
    ["backups/run", { method: "POST", headers: { Authorization: "Bearer owner" } }, 403],
    ["backups/export", {}, 404],
    ["backups/export/start", { method: "POST" }, 404],
    ["backups/export/run", { method: "POST" }, 404],
    ["backups/export/files/control/status.json", {}, 404],
    ["backups/export/status", { method: "HEAD" }, 405],
    ["backups/export/status", { method: "POST", body: "private" }, 405],
    ["backups/export/download", { method: "PUT" }, 405],
    ["backups/export/status?id=anything", {}, 400],
    ["backups/export/status?key=secret", {}, 400],
    ["backups/export/download", {}, 400],
    ["backups/export/download?id=control%2Fstatus.json", {}, 400],
    ["backups/export/download?id=..%2Fprivate", {}, 400],
    ["backups/export/download?id=objects%2Ffile", {}, 400],
    ["backups/export/download?id=a&id=b", {}, 400],
    ["backups/export/download?id=a&file=personal-files%2Fraw", {}, 400],
    ["backups/export/download?id=a&key=secret", {}, 400],
  ])
    assert.equal((await access.call(route, options)).status, expected, route)
  assert.equal(access.ownerCalls(), 0)
  assert.equal(f.queryCount(), 0)
  assert.equal(f.env.BACKUP_BUCKET.objects.size, 0)
})
test("Worker dispatch keeps server export independent of GitHub login and browser CORS credentials", async () => {
  const f = fixture()
  exportAccess(f)
  Object.assign(f.env, {
    SITE_PREFIX: "/howard-notes/",
    FALLBACK_ORIGIN: "https://pages.example",
  })
  let authorizationRequests = 0
  const call = (options) =>
    handle(
      new Request("https://notes.example/howard-notes/api/content/backups/export/status", options),
      f.env,
      {},
      async () => {
        authorizationRequests++
        throw new Error("An export capability must not request GitHub authorization.")
      },
    )
  const response = await call({ headers: { "X-Howard-Backup-Key": exportSecret } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { configured: true, latest: null })
  assert.equal((await call({ headers: { Authorization: "Bearer owner" } })).status, 403)
  const preflight = await call({
    method: "OPTIONS",
    headers: {
      Origin: "https://pages.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "X-Howard-Backup-Key",
    },
  })
  assert.equal(preflight.status, 204)
  assert.doesNotMatch(preflight.headers.get("Access-Control-Allow-Headers"), /backup-key/i)
  assert.equal(authorizationRequests, 0)
  assert.equal(f.queryCount(), 0)
})
test("dedicated ciphertext download includes private attachments without reading private sources or D1", async () => {
  const f = fixture()
  const attachment = new TextEncoder().encode("private attachment original bytes")
  const sha = await backupHash(attachment)
  await f.env.PERSONAL_FILES_BUCKET.put(`personal-files/${sha}`, attachment)
  f.sqlite
    .prepare(
      "INSERT INTO personal_files VALUES ('file','private-original.png','image/png',?,?,?,1,2,'{}')",
    )
    .run(attachment.byteLength, sha, `personal-files/${sha}`)
  const result = await completeBackup(f)
  const access = exportAccess(f)
  f.env.PERSONAL_FILES_BUCKET.get = () => {
    throw new Error("Export must not read the private source bucket.")
  }
  const before = f.queryCount()
  const response = await access.call(`backups/export/download?id=${result.latest.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream")
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.equal(
    response.headers.get("Content-Disposition"),
    `attachment; filename="notes-backup-${result.latest.id}.hnbackup"`,
  )
  const bundle = Buffer.from(await response.arrayBuffer())
  for (const privateValue of [
    f.raw,
    secret,
    exportSecret,
    syncSecret,
    "private-original.png",
    "private attachment original bytes",
  ])
    assert.equal(bundle.includes(Buffer.from(privateValue)), false)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-export-capability-test-"))
  try {
    const input = path.join(directory, "bundle.hnbackup")
    await fs.writeFile(input, bundle)
    const unpacked = await unpackBackupBundle(input, path.join(directory, "encrypted"))
    const privateFilesPath = path.join(directory, "restored-private")
    const report = await verifyAndRestoreBackup({
      readObject: (key) => fs.readFile(path.join(unpacked.directory, key)),
      manifestKey: `snapshots/${unpacked.snapshot}/manifest.hnbackup`,
      secret,
      databasePath: ":memory:",
      privateFilesPath,
    })
    assert.equal(report.originalBytesVerified, true)
    assert.equal(report.rows, 3)
    assert.equal(report.privateFiles, 1)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
  assert.equal(access.ownerCalls(), 0)
  assert.equal(f.queryCount(), before)
})
test("dedicated status requires a complete snapshot and filters malformed or absent metadata", async () => {
  const f = fixture()
  const result = await completeBackup(f)
  const access = exportAccess(f)
  const key = `snapshots/${result.latest.id}/manifest.hnbackup`
  const original = await manifestFor(f.env, result.latest.id)
  for (const patch of [{ rows: "private body" }, { bytes: -1 }, { id: [result.latest.id] }]) {
    await f.env.BACKUP_BUCKET.put(
      "control/status.json",
      JSON.stringify({ latest: { ...result.latest, ...patch } }),
    )
    assert.deepEqual(await (await access.call()).json(), { configured: true, latest: null })
  }
  await f.env.BACKUP_BUCKET.put("control/status.json", JSON.stringify({ latest: result.latest }))
  await f.env.BACKUP_BUCKET.delete(key)
  assert.deepEqual(await (await access.call()).json(), { configured: true, latest: null })
  assert.equal((await access.call(`backups/export/download?id=${result.latest.id}`)).status, 404)
  await f.env.BACKUP_BUCKET.put(
    key,
    await encryptBackup(encodeBackupJson({ ...original, completedAt: null }), secret, key),
  )
  assert.equal((await access.call()).status, 503)
  assert.equal((await access.call(`backups/export/download?id=${result.latest.id}`)).status, 503)
  assert.equal(access.ownerCalls(), 0)
})
test("completed manifests cannot export control objects, raw files, other snapshots or duplicate frames", async () => {
  const f = fixture()
  const result = await completeBackup(f)
  const access = exportAccess(f)
  const key = `snapshots/${result.latest.id}/manifest.hnbackup`
  const original = await manifestFor(f.env, result.latest.id)
  const seen = []
  const originalGet = f.env.BACKUP_BUCKET.get.bind(f.env.BACKUP_BUCKET)
  f.env.BACKUP_BUCKET.get = async (name, options) => {
    seen.push(name)
    return originalGet(name, options)
  }
  for (const partKey of [
    "control/status.json",
    "control/progress.hnbackup",
    "personal-files/private",
    `snapshots/${result.latest.id}/../control.hnbackup`,
    "snapshots/2026-01-01T00-00-00-000Z-aaaaaaaa/000000.hnbackup",
  ]) {
    const changed = { ...original, parts: [{ ...original.parts[0], key: partKey }] }
    await f.env.BACKUP_BUCKET.put(key, await encryptBackup(encodeBackupJson(changed), secret, key))
    seen.length = 0
    assert.equal((await access.call(`backups/export/download?id=${result.latest.id}`)).status, 503)
    assert.deepEqual(seen, [key])
  }
  for (const changed of [
    { ...original, parts: [...original.parts, original.parts[0]] },
    {
      ...original,
      objects: [{ sha256: "a".repeat(64), key: "control/progress.hnbackup", parts: [] }],
    },
    {
      ...original,
      objects: [
        {
          sha256: "a".repeat(64),
          key: `objects/${"a".repeat(64)}/manifest.hnbackup`,
          parts: [{ key: "control/status.json" }],
        },
      ],
    },
  ]) {
    await f.env.BACKUP_BUCKET.put(key, await encryptBackup(encodeBackupJson(changed), secret, key))
    seen.length = 0
    assert.equal((await access.call(`backups/export/download?id=${result.latest.id}`)).status, 503)
    assert.deepEqual(seen, [key])
  }
  assert.equal(access.ownerCalls(), 0)
})
test("manual start is bounded and repeated starts resume; continue never creates another completed snapshot", async () => {
  const f = fixture()
  const invoke = async (action, context) => {
    const before = f.queryCount()
    const response = await backupsResponse(
      new Request("https://notes.example/api/content/backups/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
      f.env,
      f.DB,
      "backups/run",
      async () => {},
      {},
      context,
    )
    assert.ok(f.queryCount() - before <= 10)
    return response.json()
  }
  let result = await invoke("start")
  assert.equal(result.status, "progress")
  const id = result.progress.id
  result = await invoke("start")
  assert.equal(result.progress.id, id)
  let task
  assert.equal(
    (
      await invoke("continue", {
        waitUntil: (value) => {
          task = value
        },
      })
    ).status,
    "accepted",
  )
  result = await task
  for (let index = 0; index < 20 && result.status === "progress"; index++) {
    result = await invoke("continue")
    assert.equal(result.progress?.id || result.latest.id, id)
  }
  assert.equal(result.status, "complete")
  assert.equal((await invoke("continue")).status, "current")
  assert.equal(
    [...f.env.BACKUP_BUCKET.objects.keys()].filter(
      (key) => key.startsWith("snapshots/") && key.endsWith("/manifest.hnbackup"),
    ).length,
    1,
  )
})
test("large private files resume one 256KiB encrypted range per invocation", async () => {
  const f = fixture()
  const bytes = new Uint8Array(3 * 256 * 1024 + 77).fill(43)
  const sha = await backupHash(bytes)
  await f.env.PERSONAL_FILES_BUCKET.put(`personal-files/${sha}`, bytes)
  f.sqlite
    .prepare(
      "INSERT INTO personal_files VALUES ('file','private.bin','application/octet-stream',?,?,?,1,2,'{}')",
    )
    .run(bytes.byteLength, sha, `personal-files/${sha}`)
  let result
  let snapshot
  for (let index = 0; index < 40; index++) {
    const before = [...f.env.BACKUP_BUCKET.objects.keys()].filter((key) =>
      /^objects\/[^/]+\/\d/.test(key),
    ).length
    result = await runScheduledBackup(f.env, { now, force: true })
    snapshot ||= result.progress?.id
    assert.equal(result.progress?.id || result.latest.id, snapshot)
    const after = [...f.env.BACKUP_BUCKET.objects.keys()].filter((key) =>
      /^objects\/[^/]+\/\d/.test(key),
    ).length
    assert.ok(after - before <= 1)
    if (result.status === "complete") break
  }
  assert.equal(result.status, "complete")
  assert.equal((await manifestFor(f.env, result.latest.id)).objects[0].parts.length, 4)
})
test("a private source hash mismatch never activates its copied chunks as a complete backup", async () => {
  const f = fixture()
  const previous = await completeBackup(f)
  const actual = new Uint8Array(256 * 1024 + 13).fill(11)
  const expected = await backupHash(new Uint8Array(actual.length).fill(12))
  await f.env.PERSONAL_FILES_BUCKET.put(`personal-files/${expected}`, actual)
  f.sqlite
    .prepare(
      "INSERT INTO personal_files VALUES ('file','private.bin','application/octet-stream',?,?,?,1,2,'{}')",
    )
    .run(actual.byteLength, expected, `personal-files/${expected}`)
  await assert.rejects(completeBackup(f, { now: now + 86_400_000 }), /checksum/)
  const status = JSON.parse(await (await f.env.BACKUP_BUCKET.get("control/status.json")).text())
  assert.equal(status.latest.id, previous.latest.id)
  assert.equal(status.progress, null)
  assert.equal(await f.env.BACKUP_BUCKET.get(`objects/${expected}/manifest.hnbackup`), null)
})
test("retention keeps thirty daily and twelve monthly completed snapshots", async () => {
  const bucket = new Bucket()
  const ids = []
  for (let day = 0; day < 440; day++) {
    const id = new Date(now - day * 86_400_000).toISOString().replace(/[:.]/g, "-") + "-aaaaaaaa"
    ids.push(id)
    await bucket.put(`snapshots/${id}/manifest.hnbackup`, "encrypted")
    await bucket.put(`snapshots/${id}/000000.hnbackup`, "encrypted")
  }
  await retainBackups(bucket, now)
  const manifests = [...bucket.objects.keys()].filter((key) => key.endsWith("/manifest.hnbackup"))
  assert.ok(manifests.length >= 30 && manifests.length <= 43)
  assert.ok(manifests.includes(`snapshots/${ids[0]}/manifest.hnbackup`))
  assert.equal(manifests.includes(`snapshots/${ids.at(-1)}/manifest.hnbackup`), false)
})
test("attachment collection protects retained references and removes only old orphans", async () => {
  const f = fixture()
  const bytes = new Uint8Array([7, 8, 9])
  const sha = await backupHash(bytes)
  await f.env.PERSONAL_FILES_BUCKET.put(`personal-files/${sha}`, bytes)
  f.sqlite
    .prepare("INSERT INTO personal_files VALUES ('file','private.png','image/png',?,?,?,1,2,'{}')")
    .run(bytes.byteLength, sha, `personal-files/${sha}`)
  await completeBackup(f)
  const orphan = `objects/${"a".repeat(64)}/000000.hnbackup`
  await f.env.BACKUP_BUCKET.put(orphan, "orphan")
  const collected = await garbageCollectBackupObjects(f.env, { now: now + 2 * 86_400_000 })
  assert.equal(collected.deletedObjects, 1)
  assert.equal(await f.env.BACKUP_BUCKET.get(orphan), null)
  assert.ok(await f.env.BACKUP_BUCKET.get(`objects/${sha}/000000.hnbackup`))
  const manifestKey = [...f.env.BACKUP_BUCKET.objects.keys()].find(
    (key) => key.startsWith("snapshots/") && key.endsWith("/manifest.hnbackup"),
  )
  await f.env.BACKUP_BUCKET.put(manifestKey, "broken ciphertext")
  const another = `objects/${"b".repeat(64)}/000000.hnbackup`
  await f.env.BACKUP_BUCKET.put(another, "orphan")
  await assert.rejects(garbageCollectBackupObjects(f.env, { now: now + 3 * 86_400_000 }))
  assert.ok(await f.env.BACKUP_BUCKET.get(another))
})
test("portable streaming archive encryption matches AES envelope and never overwrites existing files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-stream-test-"))
  try {
    const bytes = Buffer.from("archive bytes\r\n中文".repeat(1024))
    const encrypted = path.join(directory, "archive.hnbackup")
    const restored = path.join(directory, "archive.tar.gz")
    const context = "archives/owner-repo-fixed.hnbackup"
    const info = await encryptBackupStream(
      Readable.from([bytes.subarray(0, 57), bytes.subarray(57)]),
      encrypted,
      secret,
      context,
    )
    assert.equal(info.sha256, await backupHash(bytes))
    assert.deepEqual(
      Buffer.from(await decryptBackup(await fs.readFile(encrypted), secret, context)),
      bytes,
    )
    const actual = await decryptBackupStream(encrypted, restored, secret, context)
    assert.deepEqual(actual, info)
    await assert.rejects(decryptBackupStream(encrypted, restored, secret, context), /EEXIST/)
    assert.deepEqual(await fs.readFile(restored), bytes)
    await assert.rejects(
      encryptBackupStream(Readable.from([Buffer.from("different")]), encrypted, secret, context),
      /EEXIST/,
    )
    assert.deepEqual(
      Buffer.from(await decryptBackup(await fs.readFile(encrypted), secret, context)),
      bytes,
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("missing canonical tables and counterfeit guards cannot complete a backup", async () => {
  for (const sql of [
    "DROP TABLE personal_draft_versions",
    "DROP TRIGGER backup_epoch_memory_cards_insert; CREATE TRIGGER backup_epoch_memory_cards_insert AFTER INSERT ON memory_cards BEGIN SELECT 1; END;",
    "DROP TRIGGER backup_epoch_memory_cards_update; CREATE TRIGGER backup_epoch_memory_cards_update AFTER UPDATE ON memory_cards WHEN 0 BEGIN UPDATE backups_epoch SET generation=generation+1 WHERE id=1; END;",
  ]) {
    const f = fixture()
    f.sqlite.exec(sql)
    await assert.rejects(runScheduledBackup(f.env, { now }), /missing/)
    assert.equal(
      [...f.env.BACKUP_BUCKET.objects.keys()].some(
        (key) => key.startsWith("snapshots/") && key.endsWith("manifest.hnbackup"),
      ),
      false,
    )
  }
})
test("resumed backup rechecks guard integrity and records mutation restarts", async () => {
  const f = fixture()
  await runScheduledBackup(f.env, { now, maxPages: 1 })
  f.sqlite.exec("UPDATE memory_cards SET modified_at=3")
  const retry = await runScheduledBackup(f.env, { now: now + 60000, maxPages: 1 })
  assert.equal(retry.progress.restartCount, 1)
  assert.equal(retry.progress.firstStartedAt, new Date(now).toISOString())
  f.sqlite.exec("DROP TRIGGER backup_epoch_memory_cards_update")
  await assert.rejects(runScheduledBackup(f.env, { now: now + 120000 }), /missing/)
})
test("scheduled backup progresses independently while publication waits or rejects", async () => {
  const f = fixture()
  let release,
    backupRan = false
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  const task = runScheduledTasks({ cron: "* * * * *" }, f.env, {
    publication: async () => {
      await waiting
      throw new Error("synthetic")
    },
    backup: async (_env, options) => {
      backupRan = true
      assert.equal(options.maxFileChunks, 4)
      return { status: "progress" }
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(backupRan, true)
  release()
  await assert.rejects(task, /need retry/)
})
test("backup health reports age and restarts without content", () => {
  assert.deepEqual(backupHealth(null, now), {
    ageMs: null,
    stale: true,
    restartCount: 0,
    durationMs: null,
    privateBytes: null,
  })
  const status = {
    latest: {
      completedAt: new Date(now - 49 * 3600000).toISOString(),
      durationMs: 120000,
      privateBytes: 100,
    },
    progress: { restartCount: 3 },
  }
  assert.equal(backupHealth(status, now).stale, true)
  assert.equal(backupHealth(status, now).restartCount, 3)
})

test("storage report retains uncatalogued originals and never exposes their identities or bodies", async () => {
  const f = fixture()
  f.sqlite.exec(
    "INSERT INTO personal_files VALUES ('sensitive-id','sensitive-name.png','image/png',123,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','personal-files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,1,'{}')",
  )
  const report = await backupStorageReport(f.DB, now)
  assert.equal(report.files.uncataloguedBytes, 123)
  assert.equal(report.files.uniqueObjectBytes, 123)
  assert.equal(report.policy.deletionEnabled, false)
  assert.equal(JSON.stringify(report).includes("sensitive"), false)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM personal_files").get().count, 1)
})

test("public health probes the database and reveals no internal failure details", async () => {
  const f = fixture()
  const healthy = await handle(new Request("https://notes.example/health"), f.env)
  assert.equal(healthy.status, 200)
  assert.equal((await healthy.json()).database, true)
  f.DB.prepare = () => {
    throw new Error("sensitive database path and raw content")
  }
  const failed = await handle(new Request("https://notes.example/health"), f.env)
  assert.equal(failed.status, 503)
  assert.deepEqual(await failed.json(), {
    status: "unavailable",
    service: "howard-notes-content",
    database: false,
  })
})

test("manual start retry carries a baseline and cannot create another snapshot after completion", async () => {
  const f = fixture()
  const first = await completeBackup(f, { force: true, expectedLatestId: null })
  assert.equal(first.status, "complete")
  const retry = await runScheduledBackup(f.env, { now, force: true, expectedLatestId: null })
  assert.equal(retry.status, "current")
  assert.equal(retry.latest.id, first.latest.id)
  const second = await completeBackup(f, { force: true, expectedLatestId: first.latest.id })
  assert.equal(second.status, "complete")
  assert.notEqual(second.latest.id, first.latest.id)
  const delayed = await runScheduledBackup(f.env, {
    now,
    force: true,
    expectedLatestId: first.latest.id,
  })
  assert.equal(delayed.status, "current")
  assert.equal(delayed.latest.id, second.latest.id)
  assert.equal(
    [...f.env.BACKUP_BUCKET.objects.keys()].filter(
      (key) => key.startsWith("snapshots/") && key.endsWith("/manifest.hnbackup"),
    ).length,
    2,
  )
})

test("manual baseline is validated and propagated through the owner endpoint", async () => {
  const f = fixture()
  const done = await completeBackup(f)
  for (const [expectedLatestId, status] of [
    [null, 200],
    [42, 400],
    ["../invalid", 400],
  ]) {
    const response = await backupsResponse(
      new Request("https://notes.example/api/content/backups/run", {
        method: "POST",
        body: JSON.stringify({ action: "start", expectedLatestId }),
      }),
      f.env,
      f.DB,
      "backups/run",
      async () => {},
    )
    assert.equal(response.status, status)
    if (status === 200) {
      const value = await response.json()
      assert.equal(value.status, "current")
      assert.equal(value.latest.id, done.latest.id)
    }
  }
})
