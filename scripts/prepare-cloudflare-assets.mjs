import fs from "node:fs/promises"
import { execFileSync } from "node:child_process"
import {
  captureDeployedAssets,
  localAssetManifest,
  manifestName,
  generationIdentity,
  retentionPolicy,
  assertInitialSiteEmpty,
} from "./lib/deployment-assets.mjs"

const root = ".local/cloudflare-assets"
const stage = `${root}-stage`
const config = JSON.parse(await fs.readFile("runtime/config.json", "utf8"))
const api = process.env.CONTENT_API || config.apiBase
const site = new URL("../../", `${api.replace(/\/$/, "")}/`).href
const initial = process.argv.includes("--initial")
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const manifest = await localAssetManifest("public", commit)
await fs.rm(stage, { recursive: true, force: true })
await fs.mkdir(`${stage}/howard-notes`, { recursive: true })
try {
  let retained = { generations: [], historyLimited: false }
  if (initial) await assertInitialSiteEmpty({ site, api })
  if (!initial) {
    retained = await captureDeployedAssets({
      site,
      api,
      destination: `${stage}/howard-notes`,
      nextGeneration: manifest,
      caches: [`${root}/howard-notes`, `${root}-current/howard-notes`, "public"],
    })
    console.log(`Preserved ${retained.files} deployed resources (${retained.bytes} bytes).`)
    if (retained.historyLimited)
      console.log(
        "Online history reached the 8-generation cap; older open tabs may need a refresh after preserving drafts.",
      )
  }
  await fs.cp("public", `${stage}/howard-notes`, { recursive: true, force: true })
  // New inventory plus bounded history comes only from actual online releases.
  // Repeated local builds never create or replace a deployed generation.
  manifest.previousGenerations = retained.generations.filter(
    (generation) => generationIdentity(generation) !== generationIdentity(manifest),
  )
  manifest.retention = retentionPolicy
  const staged = await localAssetManifest(`${stage}/howard-notes`, commit)
  const stagedEntries = new Map(staged.files.map((file) => [file.path, file]))
  if (
    manifest.files.some(
      (file) =>
        stagedEntries.get(file.path)?.sha256 !== file.sha256 ||
        stagedEntries.get(file.path)?.bytes !== file.bytes,
    )
  )
    throw new Error("准备过程中本机构建资源已有变化，已停止部署。")
  if (
    staged.files.length > 5000 ||
    staged.files.reduce((sum, file) => sum + file.bytes, 0) > 200 * 1024 * 1024
  )
    throw new Error(
      "本次与保留版本的运行资源超过5000文件或200MiB，已停止部署；请先调整保留策略，不会自动丢弃受保护资源。",
    )
  await fs.writeFile(`${stage}/howard-notes/${manifestName}`, JSON.stringify(manifest))
  await fs.rm(root, { recursive: true, force: true })
  await fs.rename(stage, root)
} catch (error) {
  await fs.rm(stage, { recursive: true, force: true })
  throw error
}
console.log("Prepared Cloudflare assets at /howard-notes/.")
