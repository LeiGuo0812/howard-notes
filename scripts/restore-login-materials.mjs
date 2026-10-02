import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import { pathToFileURL } from "node:url"
import { decryptBackup, decodeBackupJson } from "./lib/backup-crypto.mjs"

export const LOGIN_RECOVERY_CONTEXT = "howard-notes-login-recovery-v1"
const names = new Map([
  ["login-bootstrap", "login-bootstrap.json"],
  ["login-resource-bindings", "login-resource-bindings.json"],
  ["login-app-config", "login-app-config.json"],
])

export async function restoreLoginMaterials({ input, output, secret }) {
  if (!input || !output) throw new Error("Missing recovery paths.")
  const stat = await fs.stat(input)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Invalid recovery bundle.")
  const value = decodeBackupJson(
    await decryptBackup(await fs.readFile(input), secret, LOGIN_RECOVERY_CONTEXT),
  )
  if (
    value?.format !== LOGIN_RECOVERY_CONTEXT ||
    !Array.isArray(value.files) ||
    ![2, 3].includes(value.files.length)
  )
    throw new Error("Unsupported recovery bundle.")
  const seen = new Set()
  const files = value.files.map((file) => {
    if (
      !names.has(file.label) ||
      seen.has(file.label) ||
      file.encoding !== "base64" ||
      typeof file.content !== "string" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256 || "")
    )
      throw new Error("Invalid recovery file.")
    seen.add(file.label)
    const bytes = Buffer.from(file.content, "base64")
    if (
      bytes.toString("base64") !== file.content ||
      bytes.length !== file.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error("Recovery file verification failed.")
    JSON.parse(bytes.toString("utf8"))
    return { name: names.get(file.label), bytes }
  })
  if (!seen.has("login-bootstrap") || !seen.has("login-resource-bindings"))
    throw new Error("Required login recovery files are missing.")
  // Authenticate and validate everything before creating a fresh private output.
  // Existing directories and production configuration are never overwritten.
  await fs.mkdir(output, { mode: 0o700 })
  try {
    for (const file of files)
      await fs.writeFile(path.join(output, file.name), file.bytes, { flag: "wx", mode: 0o600 })
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true })
    throw error
  }
  return { files: files.length, verified: true, productionModified: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: { input: { type: "string" }, output: { type: "string" } },
    })
    const result = await restoreLoginMaterials({ ...values, secret: process.env.BACKUP_SECRET })
    console.log(JSON.stringify(result))
  } catch {
    console.error(
      "Login recovery did not complete. Check the original recovery key, bundle and a new output directory; no credentials were printed or production files replaced.",
    )
    process.exitCode = 1
  }
}
