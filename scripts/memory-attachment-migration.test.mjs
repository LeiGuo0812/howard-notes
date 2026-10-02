import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import { githubMemoryAttachmentUrl } from "./lib/memory-attachment-storage.mjs"
import {
  attachmentStoragePlan,
  attachmentMetadataSql,
  attachmentPruneSql,
  verifyAttachmentMetadata,
} from "./lib/memory-attachment-migration.mjs"
function fixture() {
  const db = new DatabaseSync(":memory:")
  db.exec(
    fs.readFileSync(new URL("../content-service/memories-schema.sql", import.meta.url), "utf8"),
  )
  const files = attachmentStoragePlan(
    [{ id: "file'1", sha256: "a".repeat(64), size: 3, path: `img/memory/${"a".repeat(64)}.png` }],
    "owner/repo",
    "b".repeat(40),
  )
  db.prepare("INSERT INTO memory_files VALUES (?,?,?,?,?,?,1,1,'{}')").run(
    files[0].id,
    "original",
    "image/png",
    3,
    files[0].sha256,
    1,
  )
  db.prepare("INSERT INTO memory_file_chunks VALUES (?,0,3,'YWJj')").run(files[0].id)
  const body = JSON.stringify({
    content: "\uFEFF# 原文\r\n'保留'",
    raw: { content: "same\r\n" },
    visibility: "PRIVATE",
    created: "2024-01-01",
    attachments: [{ fileId: files[0].id, sourceUrl: "https://old.example/file" }],
  })
  db.prepare(
    "INSERT INTO memory_cards (id,visibility,status,created_at,modified_at,source_hash,body) VALUES ('card','PRIVATE','NORMAL',1,2,'unchanged',?)",
  ).run(body)
  db.prepare("INSERT INTO memory_attachments VALUES ('card',?)").run(files[0].id)
  const cards = db.prepare("SELECT * FROM memory_cards").all()
  return { db, files, cards }
}
test("immutable pointers reject traversal, mutable commits and arbitrary hosts", () => {
  const { files } = fixture()
  const s = files[0].storage
  assert.match(
    githubMemoryAttachmentUrl(s),
    /^https:\/\/raw.githubusercontent.com\/owner\/repo\/b{40}\//,
  )
  for (const change of [
    { commit: "main" },
    { repository: "https://evil.example" },
    { path: `img/memory/../${s.sha256}.png` },
    { sha256: "f".repeat(64) },
    { provider: "other" },
  ])
    assert.equal(githubMemoryAttachmentUrl({ ...s, ...change }), null)
})
test("activation preserves original text and references, pruning only removes verified chunks", () => {
  const { db, files, cards } = fixture()
  db.exec(attachmentPruneSql(files).join("\n"))
  assert.equal(db.prepare("SELECT count(*) n FROM memory_file_chunks").get().n, 1)
  db.exec(attachmentMetadataSql(files, cards).statements.join("\n"))
  assert.equal(
    verifyAttachmentMetadata(
      files,
      db.prepare("SELECT * FROM memory_files").all(),
      db.prepare("SELECT * FROM memory_cards").all(),
      cards,
    ).originalTextPreserved,
    true,
  )
  assert.equal(db.prepare("SELECT source_hash FROM memory_cards").get().source_hash, "unchanged")
  db.exec(
    "UPDATE memory_cards SET body=json_set(body,'$.attachments[0].url','https://wrong.example')",
  )
  db.exec(attachmentPruneSql(files).join("\n"))
  assert.equal(db.prepare("SELECT count(*) n FROM memory_file_chunks").get().n, 1)
  db.prepare("UPDATE memory_cards SET body=?,version=1").run(cards[0].body)
  db.exec(attachmentMetadataSql(files, cards).statements.join("\n"))
  db.exec(attachmentPruneSql(files).join("\n"))
  assert.equal(db.prepare("SELECT count(*) n FROM memory_file_chunks").get().n, 0)
  assert.equal(db.prepare("SELECT count(*) n FROM memory_attachments").get().n, 1)
  const now = db.prepare("SELECT * FROM memory_cards").all()
  assert.equal(attachmentMetadataSql(files, now).changedCards, 0)
})
test("concurrent edits prevent activation and fail the audit before pruning", () => {
  const { db, files, cards } = fixture()
  db.exec("UPDATE memory_cards SET version=2,body=json_set(body,'$.content','new edit')")
  db.exec(attachmentMetadataSql(files, cards).statements.join("\n"))
  assert.throws(
    () =>
      verifyAttachmentMetadata(
        files,
        db.prepare("SELECT * FROM memory_files").all(),
        db.prepare("SELECT * FROM memory_cards").all(),
        cards,
      ),
    /text or settings/,
  )
  db.exec(attachmentPruneSql(files).join("\n"))
  assert.equal(db.prepare("SELECT count(*) n FROM memory_file_chunks").get().n, 1)
})
