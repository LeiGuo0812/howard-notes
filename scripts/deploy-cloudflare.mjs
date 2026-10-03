import fs from "node:fs/promises"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { assetReferences, manifestName, initialResumeMode } from "./lib/deployment-assets.mjs"
import { verifyDeploymentSchema } from "./lib/deployment-schema.mjs"

const args = new Set(process.argv.slice(2))
for (const arg of args)
  if (!["--resume", "--prepare-only", "--initial"].includes(arg))
    throw new Error(`未知参数: ${arg}`)
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error("请先提交本次更改，再开始可复现部署。")
const remote = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
  encoding: "utf8",
}).split(/\s/)[0]
if (remote !== commit) throw new Error("本地提交与远端 main 不一致，请先同步并推送。")
const config = JSON.parse(await fs.readFile("runtime/config.json", "utf8"))
const api = process.env.CONTENT_API || config.apiBase
const site = new URL("../../", `${api.replace(/\/$/, "")}/`).href
const statePath = ".local/deployment-state.json"
const state = {
  version: 1,
  commit,
  initial: args.has("--initial"),
  phase: "preflight",
  updatedAt: new Date().toISOString(),
}
const save = async (phase) => {
  state.phase = phase
  state.updatedAt = new Date().toISOString()
  await fs.mkdir(".local", { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n")
}
const run = (program, parameters) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, parameters, { stdio: "inherit", env: process.env })
    child.on("error", reject)
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${program} 未完成 (${code})；修复后可使用 --resume 重试。`)),
    )
  })
const request = async (url) => {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new Error(`部署验证失败 (${response.status}): ${new URL(url).pathname}`)
  return response
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
let resumed = false
let resumeState
if (args.has("--resume")) {
  try {
    const previous = JSON.parse(await fs.readFile(statePath, "utf8"))
    resumeState = previous
    resumed =
      previous.commit === commit &&
      ["prepared", "migrated", "deployed", "assets-verified", "synchronized", "verified"].includes(
        previous.phase,
      )
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}
try {
  if (!resumed) {
    await save("checking")
    await run("npm", ["run", "test:publish"])
    await run("node_modules/.bin/tsc", ["--noEmit"])
    await run("npm", ["run", "build"])
    await run("npm", ["run", "verify:site"])
    await run(process.execPath, [
      "--use-env-proxy",
      "scripts/prepare-cloudflare-assets.mjs",
      ...(args.has("--initial") ? ["--initial"] : []),
    ])
    await save("prepared")
  }
  const directory = ".local/cloudflare-assets/howard-notes"
  let manifest = JSON.parse(await fs.readFile(path.join(directory, manifestName), "utf8"))
  if (manifest.commit !== commit) throw new Error("准备的资源不属于当前提交，请重新执行部署。")
  for (const entry of manifest.files) {
    const bytes = await fs.readFile(path.join(directory, entry.path))
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
      throw new Error(`本地部署资源已变化: ${entry.path}；请重新准备。`)
  }
  let reuseInitialAssets = false
  if (resumed && resumeState.initial) {
    args.add("--initial")
    state.initial = true
    const onlineResponse = await fetch(new URL(manifestName, site), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    })
    if (onlineResponse.ok) {
      const onlineManifest = await onlineResponse.json()
      const onlineState = await (await request(`${api}/status`)).json()
      if (initialResumeMode(manifest, onlineManifest, onlineState) === "empty") {
        // An interrupted first publication has no older D1 shell to capture.
        // Only its exact previously uploaded, locally verified asset set may resume.
        reuseInitialAssets = true
        args.add("--initial")
        state.initial = true
      } else {
        args.delete("--initial")
        state.initial = false
      }
    } else if (onlineResponse.status !== 404) {
      throw new Error("无法核实首次部署的线上资源，已停止恢复。")
    }
  }
  if (resumed) {
    // Another deployment may have finished while this one was paused. Re-read
    // online dependencies before reusing a staged build, preserving that shell.
    for (const entry of manifest.files) {
      const bytes = await fs.readFile(path.join("public", entry.path))
      if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
        throw new Error("本地构建已变化，不能继续旧部署；请重新执行部署。")
    }
    if (!reuseInitialAssets)
      await run(process.execPath, [
        "--use-env-proxy",
        "scripts/prepare-cloudflare-assets.mjs",
        ...(args.has("--initial") ? ["--initial"] : []),
      ])
    manifest = JSON.parse(await fs.readFile(path.join(directory, manifestName), "utf8"))
    await save("prepared")
  }
  if (args.has("--prepare-only")) {
    console.log("Prepared and verified; production was not changed.")
    process.exit(0)
  }
  const wrangler = "auth-service/node_modules/.bin/wrangler"
  const worker = JSON.parse(await fs.readFile("content-service/wrangler.json", "utf8"))
  if (worker.d1_databases?.some((binding) => binding.migrations_dir)) {
    await run(wrangler, [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
      "--config",
      "content-service/wrangler.json",
    ])
    await save("migrated")
  }
  const schema = JSON.parse(
    execFileSync(
      wrangler,
      [
        "d1",
        "execute",
        "DB",
        "--remote",
        "--config",
        "content-service/wrangler.json",
        "--command",
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','trigger')",
        "--json",
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
  )
  verifyDeploymentSchema(schema.flatMap((result) => result.results || []))
  await run(wrangler, ["deploy", "--config", "content-service/wrangler.json"])
  await save("deployed")
  const live = await (await request(new URL(manifestName, site))).json()
  if (JSON.stringify(live) !== JSON.stringify(manifest))
    throw new Error("线上资源清单与准备的版本不一致，暂不切换文章模板。")
  // Verify entry points before changing D1. Every emitted file was already hash
  // checked locally; Wrangler uploads the complete directory as one asset set.
  const shell = args.has("--initial") ? {} : await (await request(`${api}/shell`)).json()
  const roots = new Set([
    ...manifest.files
      .filter((file) => !file.path.includes("/"))
      .map((file) => new URL(file.path, site).href),
    ...assetReferences([shell.head, shell.postscript].join("\n"), site, site),
  ])
  for (const url of roots) await request(url)
  await save("assets-verified")
  await run(process.execPath, ["--use-env-proxy", "scripts/content-sync.mjs", "--update-shell"])
  await save("synchronized")
  const [status, activeShell] = await Promise.all([
    request(`${api}/status`).then((response) => response.json()),
    request(`${api}/shell`).then((response) => response.json()),
  ])
  if (status.commit !== commit)
    throw new Error("同步后已有新的文章版本；请核查线上状态并重试验证。")
  const known = new Set(manifest.files.map((file) => new URL(file.path, site).href))
  for (const url of assetReferences(
    [activeShell.head, activeShell.postscript].join("\n"),
    site,
    site,
  ))
    if (!known.has(url)) throw new Error("页面模板尚未使用本次资源，请使用 --resume 重试。")
  await request(site)
  state.revision = status.revision
  await save("verified")
  console.log(`Cloudflare deployment verified: ${commit}; content revision ${status.revision}.`)
} catch (error) {
  console.error(
    `Deployment stopped at ${state.phase}. The previously published content is preserved; a failed template switch can be retried with npm run deploy:cloudflare -- --resume.`,
  )
  throw error
}
