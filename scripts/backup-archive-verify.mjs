import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"
import { decryptBackup, decodeBackupJson } from "./lib/backup-crypto.mjs"
import { decryptBackupStream } from "./lib/backup-node-stream.mjs"

const { values } = parseArgs({
  options: {
    directory: { type: "string" },
    staging: { type: "string" },
    output: { type: "string" },
  },
})
if (!values.directory || !values.staging || !process.env.BACKUP_SECRET)
  throw new Error(
    "Use --directory <encrypted-export> --staging <new-private-directory>; BACKUP_SECRET must be in the environment.",
  )
const manifest = decodeBackupJson(
  await decryptBackup(
    await fs.readFile(path.join(values.directory, "export-manifest.hnbackup")),
    process.env.BACKUP_SECRET,
    "export-manifest",
  ),
)
if (manifest.format !== "howard-notes-offsite-export-v1" || !Array.isArray(manifest.archives))
  throw new Error("Offsite export manifest is invalid.")
await fs.mkdir(values.staging, { recursive: false, mode: 0o700 })
const reports = []
for (const archive of manifest.archives) {
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(archive.repository) ||
    !/^[a-f0-9]{40}$/.test(archive.commit) ||
    archive.key !== `archives/${archive.repository.replace("/", "-")}-${archive.commit}.hnbackup`
  )
    throw new Error("Offsite archive identity is invalid.")
  const target = path.join(values.staging, `${reports.length}.tar.gz`)
  const actual = await decryptBackupStream(
    path.join(values.directory, archive.key),
    target,
    process.env.BACKUP_SECRET,
    archive.key,
  )
  if (actual.size !== archive.size || actual.sha256 !== archive.sha256)
    throw new Error("Offsite archive checksum does not match.")
  const listing = execFileSync("tar", ["-tzf", target], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\n")
    .filter(Boolean)
  if (
    !listing.length ||
    listing.some(
      (entry) => entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes(".."),
    )
  )
    throw new Error("Offsite archive contains unsafe or empty paths.")
  reports.push({
    repository: archive.repository,
    commit: archive.commit,
    size: actual.size,
    sha256: actual.sha256,
    entries: listing.length,
    archiveVerified: true,
  })
}
const report = {
  encryptedExportVerified: true,
  archives: reports,
  contentBackup: manifest.contentBackup,
}
if (values.output)
  await fs.writeFile(values.output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
console.log(
  JSON.stringify({
    encryptedExportVerified: true,
    archives: reports.length,
    bytes: reports.reduce((sum, archive) => sum + archive.size, 0),
    contentBackup: Boolean(manifest.contentBackup),
  }),
)
