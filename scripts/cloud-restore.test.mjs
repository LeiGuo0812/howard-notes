import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import {
  prepareCloudRestore,
  verifyCloudRestorePlan,
  validateRestoreTarget,
} from "./lib/cloud-restore.mjs"
const sha = (value) => createHash("sha256").update(value).digest("hex")
const production = {
  name: "notes",
  d1_databases: [
    {
      binding: "DB",
      database_name: "notes-content",
      database_id: "11111111-1111-1111-1111-111111111111",
    },
  ],
  r2_buckets: [{ binding: "PERSONAL_FILES_BUCKET", bucket_name: "notes-files" }],
}
const target = {
  name: "notes-restore",
  d1_databases: [
    {
      binding: "DB",
      database_name: "notes-restore-content",
      database_id: "22222222-2222-2222-2222-222222222222",
    },
  ],
  r2_buckets: [{ binding: "PERSONAL_FILES_BUCKET", bucket_name: "notes-restore-files" }],
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "restore-plan-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const databasePath = path.join(root, "restored.sqlite"),
    privateFilesPath = path.join(root, "private-files"),
    output = path.join(root, "plan")
  const db = new DatabaseSync(databasePath)
  for (const file of ["memories-schema.sql", "personal-notes-schema.sql"])
    db.exec(await fs.readFile(new URL(`../content-service/${file}`, import.meta.url), "utf8"))
  const raw =
    "\uFEFF# 中文标题\r\n\r\n" + "汉字 **bold** `code` 原文\r\n".repeat(16000) + "\u0000最后一行"
  db.prepare(
    "INSERT INTO personal_articles(id,file,article,raw,created_at,updated_at,last_request_id) VALUES ('id','notes/file.md','{}',?,1,2,'request')",
  ).run(raw)
  db.prepare(
    "INSERT INTO personal_article_versions VALUES ('id',1,'{}',?,NULL,9007199254740993)",
  ).run(raw)
  const bytes = Buffer.alloc(300000, 93),
    hash = sha(bytes)
  db.prepare(
    "INSERT INTO personal_files VALUES ('file','original.bin','application/octet-stream',?,?,?,1,1,'{}')",
  ).run(bytes.length, hash, `personal-files/${hash}`)
  db.close()
  await fs.mkdir(path.join(privateFilesPath, "personal-files"), { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(privateFilesPath, `personal-files/${hash}`), bytes, { mode: 0o600 })
  return {
    root,
    databasePath,
    privateFilesPath,
    output,
    raw,
    bytes,
    hash,
    targetConfig: target,
    productionConfig: production,
  }
}
test("isolated restore plans preserve original text, historical bigint dates and original file hashes in bounded chunks", async (t) => {
  const f = await fixture(t)
  const result = await prepareCloudRestore(f)
  assert.equal(result.verified, true)
  assert.equal(result.cloudAccessed, false)
  assert.equal(result.cloudTargetEmptyVerified, false)
  const manifest = JSON.parse(await fs.readFile(path.join(f.output, "manifest.json"), "utf8"))
  for (const record of [...manifest.tables, ...manifest.files])
    assert.ok(record.parts.every((part) => part.bytes <= 128 * 1024))
  const versions = manifest.tables.find((table) => table.name === "personal_article_versions")
  const row = JSON.parse(
    Buffer.concat(
      await Promise.all(versions.parts.map((part) => fs.readFile(path.join(f.output, part.key)))),
    ).toString("utf8"),
  )
  assert.deepEqual(row[versions.columns.indexOf("raw")], ["text", f.raw])
  assert.deepEqual(row[versions.columns.indexOf("saved_at")], ["integer", "9007199254740993"])
  const recovered = Buffer.concat(
    await Promise.all(
      manifest.files[0].parts.map((part) => fs.readFile(path.join(f.output, part.key))),
    ),
  )
  assert.deepEqual(recovered, f.bytes)
  assert.equal((await fs.stat(f.output)).mode & 0o777, 0o700)
  assert.equal((await fs.stat(path.join(f.output, "manifest.json"))).mode & 0o777, 0o600)
  assert.deepEqual(await verifyCloudRestorePlan(f.output), result)
})
test("production resources, ambiguous names, routes, cron triggers and extra bindings are rejected", () => {
  for (const patch of [
    { name: "notes" },
    { d1_databases: production.d1_databases },
    {
      d1_databases: [
        { ...target.d1_databases[0], database_id: production.d1_databases[0].database_id },
      ],
    },
    { r2_buckets: production.r2_buckets },
    { routes: ["site.example/*"] },
    { triggers: { crons: ["* * * * *"] } },
    { d1_databases: [...target.d1_databases, ...production.d1_databases] },
  ])
    assert.throws(() => validateRestoreTarget({ ...target, ...patch }, production), {
      code: "TARGET_ISOLATION",
    })
})
test("corrupt original attachment aborts without keeping a partial plan", async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.privateFilesPath, `personal-files/${f.hash}`), "corrupted")
  await assert.rejects(prepareCloudRestore(f), { code: "PRIVATE_FILE_HASH" })
  await assert.rejects(fs.stat(f.output), { code: "ENOENT" })
})
test("missing canonical table cannot be prepared as a full restore", async (t) => {
  const f = await fixture(t),
    db = new DatabaseSync(f.databasePath)
  db.exec("DROP TABLE personal_draft_versions")
  db.close()
  await assert.rejects(prepareCloudRestore(f), { code: "CANONICAL_TABLES" })
})
test("tampered chunk hashes and traversal attempts cannot verify", async (t) => {
  const f = await fixture(t)
  await prepareCloudRestore(f)
  const manifestFile = path.join(f.output, "manifest.json"),
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"))
  const part = manifest.tables.find((table) => table.parts.length).parts[0]
  const bytes = await fs.readFile(path.join(f.output, part.key))
  await fs.writeFile(path.join(f.output, part.key), Buffer.from("tampered"))
  await assert.rejects(verifyCloudRestorePlan(f.output), { code: "PART_HASH" })
  await fs.writeFile(path.join(f.output, part.key), bytes)
  part.key = "../../outside"
  await fs.writeFile(manifestFile, JSON.stringify(manifest))
  await assert.rejects(verifyCloudRestorePlan(f.output), { code: "PART_IDENTITY" })
})
test("source symlinks and existing output directories are not overwritten", async (t) => {
  const f = await fixture(t),
    link = path.join(f.root, "linked.sqlite")
  await fs.symlink(f.databasePath, link)
  await assert.rejects(prepareCloudRestore({ ...f, databasePath: link }), { code: "SOURCE_PATH" })
  await fs.mkdir(f.output)
  await fs.writeFile(path.join(f.output, "keep"), "retained")
  await assert.rejects(prepareCloudRestore(f), { code: "PREPARATION" })
  assert.equal(await fs.readFile(path.join(f.output, "keep"), "utf8"), "retained")
})
