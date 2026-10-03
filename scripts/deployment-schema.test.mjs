import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs/promises"
import { verifyDeploymentSchema } from "./lib/deployment-schema.mjs"

test("immutable migration installs a valid public/backup schema and is safe to reapply", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    const migration = await fs.readFile(
      new URL("../content-service/migrations/0001_initial.sql", import.meta.url),
      "utf8",
    )
    db.exec(migration)
    db.exec("UPDATE content_state SET revision = 9")
    db.exec(migration)
    assert.equal(db.prepare("SELECT revision FROM content_state").get().revision, 9)
    const read = () => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master").all()
    assert.equal(verifyDeploymentSchema(read()), true)
    db.exec("DROP TRIGGER backup_epoch_personal_articles_insert")
    assert.throws(() => verifyDeploymentSchema(read()), /写入保护不完整/)
    db.exec("DROP TABLE personal_drafts")
    assert.throws(() => verifyDeploymentSchema(read()), /缺少必需表/)
  } finally {
    db.close()
  }
})
