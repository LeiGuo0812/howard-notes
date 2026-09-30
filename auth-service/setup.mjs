// Run once on the owner's computer. No personal access token or client secret
// needs to be copied. Cloudflare and GitHub collect their own account consent.
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

const directory = path.dirname(fileURLToPath(import.meta.url))
const project = path.dirname(directory)
const localConfig = path.join(directory, "wrangler.local.json")
const stateFile = path.join(project, ".local", "account-login.json")
const wrangler = path.join(directory, "node_modules", "wrangler", "bin", "wrangler.js")
const environment = {
  ...process.env,
  PATH: "/home/howard/.local/bin:/usr/local/bin:/usr/bin:/bin",
  NO_COLOR: "1",
  BROWSER: "/home/howard/.local/bin/wsl-browser",
  WRANGLER_SEND_METRICS: "false",
}
function run(
  command,
  args,
  { cwd = directory, capture = false, input, allowFailure = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "inherit"],
    })
    let output = ""
    if (capture)
      child.stdout.on("data", (chunk) => {
        output += chunk
      })
    if (input !== undefined) child.stdin.end(input)
    child.on("error", reject)
    child.on("close", (code) =>
      code && !allowFailure
        ? reject(
            new Error(
              `步骤未完成：${path.basename(command)} ${args.slice(0, 2).join(" ")}。修复后可再次运行开通入口。`,
            ),
          )
        : resolve({ code, output }),
    )
  })
}
const wr = (args, options) => run(process.execPath, [wrangler, ...args], options)
const git = async (...args) =>
  (await run("git", args, { cwd: project, capture: true })).output.trim()
const saveState = (state) =>
  fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const open = (url) => run("/home/howard/.local/bin/wsl-browser", [url])
async function health(origin) {
  // curl honors the desktop/WSL proxy, unlike Node's default direct fetch.
  const result = await run(
    "curl",
    ["--fail", "--silent", "--show-error", "--max-time", "15", `${origin}/health`],
    { capture: true, allowFailure: true },
  )
  return result.code ? null : JSON.parse(result.output)
}

async function main() {
  console.log("开通 GitHub 账号登录。文章原文不会改变。")
  const status = await git("status", "--porcelain")
  let previousState
  try {
    previousState = JSON.parse(await fs.readFile(stateFile, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  // A failed build may leave only the generated public origin pending. Resume that exact state.
  const pendingConfig =
    /^[ M]{1,2} admin\/auth-config\.json$/.test(status) &&
    previousState?.origin &&
    (await fs.readFile(path.join(project, "admin/auth-config.json"), "utf8")) ===
      JSON.stringify({ brokerOrigin: previousState.origin }, null, 2) + "\n"
  if (status && !pendingConfig)
    throw new Error("网站工程有未提交的改动，请先保存网站代码，再运行开通入口。")
  await git("fetch", "origin", "main")
  await git("merge-base", "--is-ancestor", "origin/main", "HEAD")
  let identity = await wr(["whoami", "--json"], { capture: true, allowFailure: true })
  if (identity.code) {
    console.log("请在 Cloudflare 官方页面注册或登录，并允许部署登录服务。只需开通一次。")
    await wr([
      "login",
      "--device",
      "--scopes",
      "account:read",
      "user:read",
      "workers:write",
      "workers_scripts:write",
      "d1:write",
    ])
    identity = await wr(["whoami", "--json"], { capture: true })
  }
  const user = JSON.parse(identity.output)
  const accounts = user.accounts || []
  if (!accounts.length) throw new Error("请先在 Cloudflare 完成账号开通，再运行此入口。")
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  let state
  try {
    state = JSON.parse(await fs.readFile(stateFile, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (!state && accounts.length > 1)
    throw new Error("检测到多个 Cloudflare 账号，请让维护工具指定用于登录服务的账号。")
  state ||= {
    accountId: accounts[0].id,
    encryptionKey: randomBytes(32).toString("base64url"),
    setupKey: randomBytes(32).toString("base64url"),
  }
  if (!accounts.some((account) => account.id === state.accountId))
    throw new Error("当前 Cloudflare 账号与之前的配置不同。")
  await saveState(state)
  const config = JSON.parse(await fs.readFile(path.join(directory, "wrangler.json"), "utf8"))
  config.account_id = state.accountId
  try {
    const previous = JSON.parse(await fs.readFile(localConfig, "utf8"))
    if (previous.d1_databases) config.d1_databases = previous.d1_databases
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  await fs.writeFile(localConfig, JSON.stringify(config, null, 2) + "\n")
  if (!config.d1_databases?.length) {
    const listed = await wr(["d1", "list", "--json", "--config", localConfig], { capture: true })
    const existing = JSON.parse(listed.output).find((db) => db.name === "howard-notes-login")
    if (existing) {
      config.d1_databases = [
        { binding: "DB", database_name: existing.name, database_id: existing.uuid },
      ]
      await fs.writeFile(localConfig, JSON.stringify(config, null, 2) + "\n")
    } else
      await wr([
        "d1",
        "create",
        "howard-notes-login",
        "--binding",
        "DB",
        "--update-config",
        "--config",
        localConfig,
      ])
  }
  await wr([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--file",
    "schema.sql",
    "--yes",
    "--config",
    localConfig,
  ])
  console.log("正在部署登录服务…")
  const deployed = await wr(["deploy", "--config", localConfig], { capture: true })
  const workerUrl = deployed.output.match(
    /https:\/\/howard-notes-login\.[a-z0-9-]+\.workers\.dev\b/,
  )?.[0]
  if (!workerUrl)
    throw new Error("未取得登录服务地址，请检查 Cloudflare Workers 子域名是否已启用。")
  state.origin = workerUrl
  await saveState(state)
  await wr(["secret", "bulk", "--config", localConfig], {
    input: JSON.stringify({ ENCRYPTION_KEY: state.encryptionKey, SETUP_KEY: state.setupKey }),
  })
  let configured = false
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await health(workerUrl)
      if (response?.ok) {
        configured = response.configured
        break
      }
    } catch {}
    await pause(5000)
  }
  if (!configured) {
    console.log(
      "浏览器将打开 GitHub 首次开通页。创建应用后，仅选择 howard-notes 仓库安装；保留本窗口。",
    )
    await open(`${workerUrl}/setup#${state.setupKey}`)
    const deadline = Date.now() + 30 * 60000
    while (Date.now() < deadline) {
      await pause(5000)
      try {
        const response = await health(workerUrl)
        if (response?.ok && response.configured) {
          configured = true
          break
        }
      } catch {}
    }
    if (!configured) throw new Error("首次开通尚未完成。配置已保存，稍后重新运行此入口即可继续。")
  }
  const destination = path.join(project, "admin", "auth-config.json")
  const publicConfig = JSON.stringify({ brokerOrigin: workerUrl }, null, 2) + "\n"
  if ((await fs.readFile(destination, "utf8")) !== publicConfig)
    await fs.writeFile(destination, publicConfig)
  console.log("正在检查并发布新版后台…")
  await run("npm", ["run", "test:publish"], { cwd: project })
  await run("npx", ["tsc", "--noEmit"], { cwd: project })
  await run("npm", ["run", "build"], { cwd: project })
  await run("npm", ["run", "verify:site"], { cwd: project })
  await git("add", "admin/auth-config.json")
  const staged = await git("diff", "--cached", "--name-only")
  if (staged && staged !== "admin/auth-config.json")
    throw new Error("检测到其他暂存改动，已停止发布。")
  if (staged) await git("commit", "-m", "Configure GitHub account login service")
  await git("push", "origin", "HEAD:main")
  const commit = await git("rev-parse", "HEAD")
  let runId
  for (let attempt = 0; attempt < 12 && !runId; attempt++) {
    await pause(5000)
    const result = await run(
      "gh",
      [
        "run",
        "list",
        "--repo",
        config.vars.REPOSITORY,
        "--commit",
        commit,
        "--limit",
        "1",
        "--json",
        "databaseId",
      ],
      { capture: true },
    )
    runId = JSON.parse(result.output)[0]?.databaseId
  }
  if (!runId) throw new Error("GitHub 已收到新版后台，请在 Actions 页面查看部署进度。")
  await run("gh", [
    "run",
    "watch",
    String(runId),
    "--repo",
    config.vars.REPOSITORY,
    "--exit-status",
  ])
  console.log("账号登录已上线。点击“使用 GitHub 登录”即可进入后台。")
  await open(config.vars.ADMIN_URL)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
