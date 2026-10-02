import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { encryptBackup, encodeBackupJson } from "./lib/backup-crypto.mjs"
import { restoreLoginMaterials, LOGIN_RECOVERY_CONTEXT } from "./restore-login-materials.mjs"

const secret = Buffer.alloc(32, 29).toString("base64url")
async function fixture(t, change = () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "login-recovery-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const value = {
    format: LOGIN_RECOVERY_CONTEXT,
    files: ["login-bootstrap", "login-resource-bindings", "login-app-config"].map((label) => {
      const bytes = Buffer.from(JSON.stringify({ label, synthetic: true }))
      return {
        label,
        encoding: "base64",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        content: bytes.toString("base64"),
      }
    }),
  }
  change(value)
  const input = path.join(directory, "recovery.hnbackup")
  await fs.writeFile(
    input,
    await encryptBackup(encodeBackupJson(value), secret, LOGIN_RECOVERY_CONTEXT),
  )
  return { input, output: path.join(directory, "restored"), secret, value }
}

test("login recovery authenticates exact JSON bytes into fresh private files", async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await restoreLoginMaterials(f), {
    files: 3,
    verified: true,
    productionModified: false,
  })
  for (const file of f.value.files) {
    const location = path.join(f.output, file.label + ".json")
    assert.deepEqual(await fs.readFile(location), Buffer.from(file.content, "base64"))
    assert.equal((await fs.stat(location)).mode & 0o777, 0o600)
  }
  assert.equal((await fs.stat(f.output)).mode & 0o777, 0o700)
})
test("historical two-file login recovery bundles remain readable", async (t) => {
  const f = await fixture(t, (v) => v.files.pop())
  assert.equal((await restoreLoginMaterials(f)).files, 2)
})
test("required bootstrap and resource bindings cannot be replaced", async (t) => {
  const f = await fixture(t, (v) => v.files.splice(1, 1))
  await assert.rejects(restoreLoginMaterials(f))
  await assert.rejects(fs.stat(f.output), { code: "ENOENT" })
})
test("wrong key rejects recovery before creating output", async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    restoreLoginMaterials({ ...f, secret: Buffer.alloc(32, 30).toString("base64url") }),
  )
  await assert.rejects(fs.stat(f.output), { code: "ENOENT" })
})
test("existing output and its files remain untouched", async (t) => {
  const f = await fixture(t)
  await fs.mkdir(f.output)
  await fs.writeFile(path.join(f.output, "sentinel"), "existing")
  await assert.rejects(restoreLoginMaterials(f), { code: "EEXIST" })
  assert.equal(await fs.readFile(path.join(f.output, "sentinel"), "utf8"), "existing")
})
test("recovery rejects duplicate or escaping labels", async (t) => {
  for (const label of ["../escape", "login-bootstrap"]) {
    const f = await fixture(t, (v) => (v.files[1].label = label))
    await assert.rejects(restoreLoginMaterials(f))
    await assert.rejects(fs.stat(f.output), { code: "ENOENT" })
  }
})
test("recovery rejects malformed base64 and wrong file hashes", async (t) => {
  for (const change of [
    (v) => (v.files[0].content += "!"),
    (v) => (v.files[0].sha256 = "0".repeat(64)),
  ]) {
    const f = await fixture(t, change)
    await assert.rejects(restoreLoginMaterials(f))
    await assert.rejects(fs.stat(f.output), { code: "ENOENT" })
  }
})
