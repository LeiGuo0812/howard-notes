import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { runOffsiteBackup, OffsiteBackupError } from "./lib/offsite-backup.mjs"

try {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      materials: { type: "string" },
      "maintenance-repository": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
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
    maintenanceRepository: values["maintenance-repository"]
      ? path.resolve(values["maintenance-repository"])
      : undefined,
    dryRun: values["dry-run"],
  })
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const retention = result.retention || {}
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Website backup\n\n${result.complete ? "Verified backup completed." : "Read-only storage preview completed."}\n\n` +
        `- Retained snapshots: ${retention.retained ?? 0}\n` +
        `- Removed expired snapshots: ${retention.removed ?? 0}\n` +
        `- Removed unreferenced archives: ${retention.removedArchives ?? 0}\n` +
        `- Archive quarantine: ${retention.archiveGraceDays ?? 30} days after last retained reference\n` +
        `- Archive cleanup blocked by incomplete verification: ${Boolean(retention.archiveBlocked)}\n` +
        `- Retained managed storage: ${retention.retainedBytes ?? 0} bytes\n`,
    )
  }
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
  if (process.env.GITHUB_STEP_SUMMARY)
    await fs
      .appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        "## Website backup\n\nBackup failed. Existing verified copies remain preserved. Check this run’s sanitized failure code and the website backup status before retrying.\n",
      )
      .catch(() => {})
  process.exitCode = 1
}
