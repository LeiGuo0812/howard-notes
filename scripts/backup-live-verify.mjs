import fs from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { parseArgs } from "node:util"
import { ownerToken, ownerRequest, contentEndpoint } from "./lib/owner-token.mjs"
import { captureLiveBackup } from "./lib/backup-live.mjs"
import { unpackBackupBundle, verifyAndRestoreBackup } from "./lib/backup-restore.mjs"
import { backupKey } from "./lib/backup-crypto.mjs"

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    output: { type: "string" },
    timeout: { type: "string", default: "900" },
  },
})
try {
  if (!values.site || !values.output)
    throw new Error("Use --site <HTTPS-site> --output <new-private-directory>.")
  const seconds = Number(values.timeout)
  if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 3600)
    throw new Error("Timeout must be an integer from 30 to 3600 seconds.")
  backupKey(process.env.BACKUP_SECRET)
  const api = contentEndpoint(values.site)
  // Credentials exist only in memory; a secret is never accepted on argv.
  const token = await ownerToken()
  const output = path.resolve(values.output)
  await fs.mkdir(output, { mode: 0o700 })
  const capture = await captureLiveBackup({
    request: ownerRequest(api, token),
    timeout: seconds * 1000,
    onProgress: (progress) => console.log(JSON.stringify({ status: "progress", ...progress })),
  })
  const id = capture.latest.id
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/.test(id))
    throw new Error("Backup returned an invalid snapshot identifier.")
  const response = await fetch(new URL(`backups/download?id=${id}`, api), {
    redirect: "error",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(seconds * 1000),
  })
  if (!response.ok || !response.body)
    throw new Error(`Encrypted backup download failed (${response.status}).`)
  const bundle = path.join(output, "snapshot.hnbackup")
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(bundle, { flags: "wx", mode: 0o600 }),
  )
  const hash = createHash("sha256")
  for await (const bytes of createReadStream(bundle)) hash.update(bytes)
  const unpacked = await unpackBackupBundle(bundle, path.join(output, "encrypted"))
  if (unpacked.snapshot !== id)
    throw new Error("Downloaded snapshot differs from its pinned identifier.")
  const restored = await verifyAndRestoreBackup({
    secret: process.env.BACKUP_SECRET,
    manifestKey: `snapshots/${id}/manifest.hnbackup`,
    readObject: (key) => fs.readFile(path.join(unpacked.directory, key)),
    databasePath: path.join(output, "restored.sqlite"),
    privateFilesPath: path.join(output, "private-files"),
  })
  const report = {
    ...restored,
    capturedAt: new Date().toISOString(),
    encryptedBundleBytes: (await fs.stat(bundle)).size,
    encryptedBundleSha256: hash.digest("hex"),
    encryptedObjects: unpacked.objects,
    boundedCalls: capture.steps,
    liveDatabaseModifiedByRestore: false,
  }
  await fs.writeFile(
    path.join(output, "verification-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  )
  console.log(JSON.stringify(report))
} catch (error) {
  // No exception stack or HTTP response body: neither may leak owner data.
  console.error(
    error?.code === "EEXIST"
      ? "Output already exists; choose a new private directory. Nothing was overwritten."
      : "Owner backup or isolated restore did not complete; existing backups were preserved. Check owner authorization, bindings and the private progress status before retrying.",
  )
  process.exitCode = 1
}
