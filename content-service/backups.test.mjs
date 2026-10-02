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
