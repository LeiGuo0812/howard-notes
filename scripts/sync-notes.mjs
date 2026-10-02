import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { walk, hash, splitNote, renderLibrary, extractNoteTags } from "./lib/library.mjs"
import { validateCatalog, safeRelative } from "./lib/catalog.mjs"
import { planSync, retiredWebDrafts } from "./lib/sync-plan.mjs"
import { validateSite } from "./lib/site-settings.mjs"
import { sourceDates } from "./lib/note-dates.mjs"

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(project)
const args = new Set(process.argv.slice(2)),
  apply = args.has("--apply"),
  init = args.has("--init")
const runtime = JSON.parse(await fs.readFile("runtime/config.json", "utf8").catch(() => "{}"))
if (apply && runtime.maintenanceMode === "web-primary")
  throw new Error(
    "当前文库以网页为主维护端，已关闭本地双向写入。请使用只读导出和加密备份；本次未修改笔记或推送仓库。",
  )
const git = (...arguments_) =>
  execFileSync("git", arguments_, {
    cwd: project,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
const config = JSON.parse(
  await fs.readFile(".local/sync-config.json", "utf8").catch(() => {
    throw new Error("请先按 README 创建本机 .local/sync-config.json，指定公开文库目录。")
  }),
)
const mirror = path.resolve(config.directory)
if (
  !config.directory ||
  mirror === project ||
  project.startsWith(mirror + path.sep) ||
  mirror.startsWith(project + path.sep)
)
  throw new Error("公开文库必须位于网站工程以外的独立目录。")
async function tree(root) {
  const result = new Map()
  try {
    for (const file of await walk(root))
      result.set(path.relative(root, file).split(path.sep).join("/"), await fs.readFile(file))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  return result
}
async function writeTree(root, before, after, backup) {
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    if (
      !safeRelative(file) ||
      !(
        ["catalog.json", "site.json"].includes(file) ||
        file.startsWith("notes/") ||
        file.startsWith("assets/")
      )
    )
      throw new Error(`不支持的同步文件：${file}`)
    const target = path.join(root, file),
      previous = before.get(file),
      next = after.get(file)
    if (previous !== undefined && next !== undefined && previous.equals(next)) continue
    if (previous && backup) {
      const save = path.join(backup, file)
      await fs.mkdir(path.dirname(save), { recursive: true })
      await fs.writeFile(save, previous)
    }
    if (next === undefined)
      await fs.unlink(target).catch((error) => {
        if (error.code !== "ENOENT") throw error
      })
    else {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, next)
    }
  }
}
async function main() {
  if (git("status", "--porcelain").toString().trim())
    throw new Error("网站工程有未提交的修改。请先处理这些修改，再同步笔记。")
  const remoteUrl = git("config", "--get", "remote.origin.url").toString().trim()
  if (
    !/^(?:https:\/\/github\.com\/|git@github\.com:)LeiGuo0812\/howard-notes(?:\.git)?$/i.test(
      remoteUrl,
    )
  )
    throw new Error("origin 不是预期的博客仓库。")
  console.log("读取 GitHub 最新版本…")
  git("fetch", "origin", "main")
  const remote = new Map()
  const remoteFiles = git("ls-tree", "-r", "--name-only", "-z", "origin/main", "--", "library/")
    .toString()
    .split("\0")
    .filter(Boolean)
  for (const file of remoteFiles)
    remote.set(file.slice("library/".length), git("show", `origin/main:${file}`))
  if (!remote.has("catalog.json")) throw new Error("远端尚未安装原文同步功能。")
  let local = await tree(mirror)
  const base = await tree(".sync/base")
  if (!init && !base.has("catalog.json"))
    throw new Error("首次使用请运行 npm run sync -- --init --apply。")
  if (init && base.size) throw new Error("已经初始化，请使用普通同步，避免重置冲突基线。")
  if (init) {
    for (const [file, bytes] of local)
      if (!remote.get(file)?.equals(bytes))
        throw new Error(`首次同步发现不同的本地文件，未覆盖：${file}`)
    // Missing initial files are additions from the website, not local deletions.
  }
  const plan = planSync(base, local, remote, {
    allowDelete: args.has("--allow-delete"),
    allowDeleteFiles: retiredWebDrafts(base, remote),
  })
  if (plan.conflicts.length) {
    if (apply) {
      const folder = `.sync/conflicts/${Date.now()}`
      for (const conflict of plan.conflicts)
        for (const [label, map] of [
          ["LOCAL", local],
          ["REMOTE", remote],
          ["BASE", base],
        ])
          if (map.has(conflict.file)) {
            const target = path.join(folder, label, conflict.file)
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.writeFile(target, map.get(conflict.file))
          }
      console.error(`冲突副本已保存到 ${folder}`)
    }
    throw new Error(
      plan.conflicts.map((conflict) => `${conflict.file}：${conflict.reason}`).join("\n") +
        "\n没有覆盖本地笔记，也没有向远端推送。",
    )
  }
  const merged = plan.merged
  const catalog = validateCatalog(JSON.parse(merged.get("catalog.json").toString()))
  const registered = new Set(catalog.articles.map((article) => article.file))
  const additions = [...merged.keys()].filter(
    (file) => file.startsWith("notes/") && file.endsWith(".md") && !registered.has(file),
  )
  if (additions.length && !args.has("--include-new"))
    throw new Error(
      `发现未登记的新文章：\n${additions.join("\n")}\n确认这些文件可以进入公开 GitHub 仓库后，使用 --include-new。`,
    )
  for (const file of additions) {
    const { data } = splitNote(merged.get(file).toString("utf8"))
    const dates = sourceDates(data)
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())
    catalog.articles.push({
      id: `note-${hash(Buffer.from(file)).slice(0, 12)}`,
      file,
      title: path.basename(file, ".md"),
      category: "未分类",
      date: today,
      created: dates.created || today,
      modified: dates.modified || dates.created || today,
      published: data.publish === true && data.draft === false,
      featured: false,
      tags: extractNoteTags(merged.get(file).toString("utf8")),
    })
  }
  if (additions.length)
    merged.set("catalog.json", Buffer.from(JSON.stringify(catalog, null, 2) + "\n"))
  // Keep the update list accurate for Obsidian edits without writing metadata into Markdown.
  let changedDates = false
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())
  for (const article of catalog.articles) {
    const bytes = merged.get(article.file)
    if (
      bytes &&
      registered.has(article.file) &&
      !bytes.equals(remote.get(article.file) || Buffer.alloc(0)) &&
      article.modified !== today
    ) {
      article.modified = today
      changedDates = true
    }
  }
  if (changedDates) merged.set("catalog.json", Buffer.from(JSON.stringify(catalog, null, 2) + "\n"))
  // Explicit deletion also removes the corresponding catalog entry. Cross-links remain visible as unavailable references.
  const missing = catalog.articles.filter((article) => !merged.has(article.file))
  if (missing.length && args.has("--allow-delete")) {
    catalog.articles = catalog.articles.filter((article) => merged.has(article.file))
    merged.set("catalog.json", Buffer.from(JSON.stringify(catalog, null, 2) + "\n"))
  }
  validateCatalog(catalog)
  for (const article of catalog.articles)
    if (!merged.has(article.file)) throw new Error(`找不到原文：${article.file}`)
  for (const file of merged.keys())
    if (
      !safeRelative(file) ||
      !(
        ["catalog.json", "site.json"].includes(file) ||
        /^notes\/.+\.md$/.test(file) ||
        /^assets\/.+\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(file)
      )
    )
      throw new Error(`不支持的同步文件：${file}`)
  if (merged.has("site.json")) validateSite(JSON.parse(merged.get("site.json").toString()))
  renderLibrary(catalog, merged)
  console.log(
    JSON.stringify(
      { preview: !apply, changes: plan.changes, newArticles: additions.length },
      null,
      2,
    ),
  )
  if (!apply) return
  git("merge", "--ff-only", "origin/main")
  const before = await tree("library")
  await writeTree("library", before, merged)
  let hasChanges = git("status", "--porcelain", "--", "library").toString().trim()
  if (hasChanges) {
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` }
    try {
      execFileSync("npm", ["run", "build"], { cwd: project, stdio: "inherit", env })
      execFileSync("npm", ["run", "verify:site"], { cwd: project, stdio: "inherit", env })
    } catch {
      await writeTree("library", merged, before)
      throw new Error(
        "构建或检查失败，网站工程中的同步改动已回退。Obsidian 原文和上一次同步基线保持不变。",
      )
    }
    git("add", "--", "library")
    git("commit", "-m", "Sync original notes from Obsidian")
    try {
      git("push", "origin", "HEAD:main")
    } catch {
      throw new Error(
        "推送未成功，本地 Git 提交已保留。请检查网络或远端的新提交后再同步；未覆盖 Obsidian 内容。",
      )
    }
  }
  // The user may have kept writing during the build. Never overwrite those newer keystrokes.
  const rechecked = await tree(mirror)
  for (const file of new Set([...local.keys(), ...rechecked.keys()]))
    if (!local.has(file) || !rechecked.has(file) || !local.get(file).equals(rechecked.get(file)))
      throw new Error("同步期间检测到新的本地编辑，已停止回写。请再次运行同步处理这些改动。")
  const backup = `.sync/backups/${Date.now()}`
  await writeTree(mirror, local, merged, backup)
  await writeTree(".sync/base", base, merged)
  console.log(`同步完成：${catalog.articles.length} 篇原文。备份目录：${backup}`)
}
await fs.mkdir(".sync", { recursive: true })
try {
  await fs.mkdir(".sync/lock")
} catch {
  console.error("另一个同步正在运行。若上次进程异常退出，确认无同步进程后删除 .sync/lock 再试。")
  process.exit(1)
}
try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await fs.rmdir(".sync/lock")
}
