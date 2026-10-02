import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { runOffsiteBackup, OffsiteBackupError } from "./lib/offsite-backup.mjs"

try {
  const { values } = parseArgs({
    options: { config: { type: "string" }, materials: { type: "string" } },
  })
  if (!values.config) throw new OffsiteBackupError("CONFIG")
  const file = path.resolve(values.config),
    config = JSON.parse(await fs.readFile(file, "utf8"))
  const materials = values.materials
    ? path.resolve(values.materials)
    : path.resolve(path.dirname(file), config.handoffDirectory || "handoff")
  const result = await runOffsiteBackup({
    config,
    repository: process.env.PRIVATE_BACKUP_REPOSITORY,
    key: process.env.BACKUP_EXPORT_KEY,
    materials,
  })
  console.log(JSON.stringify(result))
} catch (error) {
  // Never print raw HTTP/CLI errors, environment credentials or private paths.
  console.error(
    JSON.stringify({
      complete: false,
      code: error instanceof OffsiteBackupError ? error.code : "UNEXPECTED",
      message:
        error instanceof OffsiteBackupError
          ? error.message
          : "Backup failed; existing backups are preserved.",
    }),
  )
  process.exitCode = 1
}
