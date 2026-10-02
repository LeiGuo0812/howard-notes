import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { unpackBackupBundle, verifyAndRestoreBackup } from "./lib/backup-restore.mjs"

const { values } = parseArgs({
  options: {
    bundle: { type: "string" },
    directory: { type: "string" },
    manifest: { type: "string" },
    staging: { type: "string" },
    output: { type: "string" },
  },
})
if (!process.env.BACKUP_SECRET)
  throw new Error(
    "Provide BACKUP_SECRET through the environment; never pass keys in command arguments.",
  )
if (!values.staging || (!values.bundle && !values.directory))
  throw new Error(
    "Use --bundle <encrypted-bundle> --staging <new-private-directory>, or --directory <encrypted-object-directory> --manifest <key> --staging <new-private-directory>.",
  )
await fs.mkdir(values.staging, { recursive: true, mode: 0o700 })
const unpacked = values.bundle
  ? await unpackBackupBundle(values.bundle, path.join(values.staging, "encrypted"))
  : null
const directory = unpacked?.directory || values.directory
const manifestKey = unpacked ? `snapshots/${unpacked.snapshot}/manifest.hnbackup` : values.manifest
const report = await verifyAndRestoreBackup({
  secret: process.env.BACKUP_SECRET,
  manifestKey,
  readObject: (key) => fs.readFile(path.join(directory, key)),
  databasePath: path.join(values.staging, "restored.sqlite"),
  privateFilesPath: path.join(values.staging, "private-files"),
})
if (values.output)
  await fs.writeFile(values.output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
console.log(JSON.stringify(report))
