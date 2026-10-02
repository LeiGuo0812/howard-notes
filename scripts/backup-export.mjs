import fs from "node:fs/promises"
import { createWriteStream } from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawn, execFileSync } from "node:child_process"
import { parseArgs } from "node:util"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import YAML from "yaml"
import { encryptBackup, encodeBackupJson } from "./lib/backup-crypto.mjs"
import { encryptBackupStream } from "./lib/backup-node-stream.mjs"

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    repositories: { type: "string" },
    site: { type: "string" },
    snapshot: { type: "string" },
  },
})
if (!values.output || !process.env.BACKUP_SECRET)
  throw new Error(
    "Use --output <new-private-directory>; supply BACKUP_SECRET only through the environment.",
  )
const repositories = (values.repositories || "").split(",").filter(Boolean)
if (repositories.some((repository) => !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)))
  throw new Error("Repository identifiers must use owner/repository format.")
await fs.mkdir(values.output, { recursive: false, mode: 0o700 })
const manifest = {
  format: "howard-notes-offsite-export-v1",
  createdAt: new Date().toISOString(),
  archives: [],
  contentBackup: null,
}
for (const repository of repositories) {
  const metadata = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  )
  const branch = encodeURIComponent(metadata.default_branch)
  const sha = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/commits/${branch}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ).sha
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub returned an invalid commit.")
  const key = `archives/${repository.replace("/", "-")}-${sha}.hnbackup`
  const file = path.join(values.output, key)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const processArchive = spawn("gh", ["api", `repos/${repository}/tarball/${sha}`], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  processArchive.stderr.on("data", () => {})
  const completion = new Promise((resolve, reject) => {
    processArchive.on("error", reject)
    processArchive.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("GitHub archive download failed; existing exports are unchanged.")),
    )
  })
  const [encrypted] = await Promise.all([
    encryptBackupStream(processArchive.stdout, file, process.env.BACKUP_SECRET, key),
    completion,
  ])
  manifest.archives.push({ key, repository, commit: sha, ...encrypted })
}
if (values.site) {
  const site = new URL(values.site.endsWith("/") ? values.site : values.site + "/")
  if (site.protocol !== "https:" || site.username || site.password)
    throw new Error("The owner content-service endpoint must use HTTPS without URL credentials.")
  let token = process.env.GITHUB_TOKEN
  if (!token) {
    try {
      token = execFileSync("gh", ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim()
    } catch {
      const configRoot =
        process.env.GH_CONFIG_DIR ||
        path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "gh")
      const config = YAML.parse(await fs.readFile(path.join(configRoot, "hosts.yml"), "utf8"))
      const host = config?.["github.com"]
      token = [host, ...Object.values(host?.users || {})].find(
        (account) => typeof account?.oauth_token === "string",
      )?.oauth_token
    }
  }
  if (!token)
    throw new Error("Use the existing GitHub CLI owner login before exporting the content service.")
  const url = new URL("api/content/backups/download", site)
  if (values.snapshot) url.searchParams.set("id", values.snapshot)
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
  })
  token = null
  if (!response.ok) throw new Error("Owner backup download failed; no private content was logged.")
  const file = "content.hnbackup"
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path.join(values.output, file), { flags: "wx", mode: 0o600 }),
  )
  manifest.contentBackup = { file, snapshot: values.snapshot || "latest" }
}
await fs.writeFile(
  path.join(values.output, "export-manifest.hnbackup"),
  await encryptBackup(encodeBackupJson(manifest), process.env.BACKUP_SECRET, "export-manifest"),
  { flag: "wx", mode: 0o600 },
)
console.log(
  JSON.stringify({
    encrypted: true,
    archives: manifest.archives.length,
    contentBackup: Boolean(manifest.contentBackup),
    createdAt: manifest.createdAt,
  }),
)
