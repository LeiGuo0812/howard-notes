import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const arguments_ = process.argv.slice(2)
const sourceArg = arguments_.indexOf("--source")
const source = sourceArg >= 0 ? arguments_[sourceArg + 1] : process.env.OBSIDIAN_PUBLISH_DIR
const destinationArg = arguments_.indexOf("--destination")
const destination =
  destinationArg >= 0 ? path.resolve(arguments_[destinationArg + 1]) : path.join(project, "content")
const dryRun = arguments_.includes("--dry-run")
const metadataKeys = [
  "title",
  "description",
  "date",
  "created",
  "modified",
  "tags",
  "category",
  "type",
  "featured",
]
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".pdf"])
const inside = (parent, child) => child.startsWith(parent + path.sep)

async function walk(directory) {
  const result = []
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith(".") || item.name === "node_modules") continue
    const filename = path.join(directory, item.name)
    if (item.isSymbolicLink()) continue
    if (item.isDirectory()) result.push(...(await walk(filename)))
    else if (item.isFile() && item.name.endsWith(".md")) result.push(filename)
  }
  return result.sort()
}

function parseNote(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  return {
    data: match ? (YAML.parse(match[1]) ?? {}) : {},
    body: match ? text.slice(match[0].length) : text,
  }
}

function safeRoute(route) {
  if (typeof route !== "string" || !/^notes\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(route)) {
    throw new Error("文章必须设置 notes/ 开头、由小写英文和连字符组成的 permalink。")
  }
  return route
}

async function run() {
  if (!source) throw new Error("请传入 --source <博客发布目录> 或设置 OBSIDIAN_PUBLISH_DIR。")
  const root = await fs.realpath(path.resolve(source))
  const paths = await walk(root)
  const all = []
  const selected = []
  const routes = new Set()
  for (const file of paths) {
    const note = { file, ...parseNote(await fs.readFile(file, "utf8")) }
    all.push(note)
    if (note.data.publish !== true || note.data.draft !== false) continue
    note.route = safeRoute(note.data.permalink)
    if (routes.has(note.route)) throw new Error(`重复地址：${note.route}`)
    if (
      !note.data.title ||
      !note.data.description ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(note.data.date))
    ) {
      throw new Error(`缺少标题、摘要或发布日期：${path.basename(file)}`)
    }
    routes.add(note.route)
    selected.push(note)
  }
  const selectedByPath = new Map(selected.map((note) => [note.file, note]))
  const output = new Map()

  function resolveNote(target, owner) {
    const decoded = decodeURIComponent(target).replace(/\.md$/, "")
    const local = path.resolve(path.dirname(owner.file), decoded + ".md")
    const absolute = path.resolve(root, decoded.replace(/^\//, "") + ".md")
    let matches = all.filter((note) => note.file === local || note.file === absolute)
    if (!matches.length)
      matches = all.filter(
        (note) => path.basename(note.file, ".md") === decoded || note.data.title === decoded,
      )
    if (matches.length !== 1)
      throw new Error(`链接缺失或同名歧义：${path.basename(owner.file)} → ${target}`)
    const result = selectedByPath.get(matches[0].file)
    if (!result) throw new Error(`链接指向未公开笔记：${path.basename(owner.file)} → ${target}`)
    return result
  }

  async function attachment(url, owner) {
    if (/^https?:\/\//i.test(url)) return url
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//"))
      throw new Error(`不支持的附件地址：${url}`)
    const [resource, fragment] = url.split("#")
    const file = await fs.realpath(
      path.resolve(path.dirname(owner.file), decodeURIComponent(resource)),
    )
    if (!inside(root, file)) throw new Error(`附件超出发布目录：${url}`)
    if (!imageExtensions.has(path.extname(file).toLowerCase()))
      throw new Error(`不支持的附件格式：${url}`)
    const bytes = await fs.readFile(file)
    const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12)
    const name = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "-")
    const relative = `assets/${hash}-${name}`
    output.set(relative, bytes)
    const href = path.posix.relative(path.posix.dirname(owner.route), relative)
    return href + (fragment ? "#" + fragment : "")
  }

  for (const note of selected) {
    // Remove unpublished comments before copying any text to a public repository.
    const body = note.body.replace(/%%[\s\S]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "")
    const tree = unified().use(remarkParse).parse(body)
    const edits = []
    const tasks = []
    visit(tree, (node) => {
      if (node.type === "text") {
        const raw = body.slice(node.position.start.offset, node.position.end.offset)
        for (const match of raw.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
          const [reference, label] = match[2].split("|")
          const [target, anchor] = reference.split("#")
          if (!target) continue
          const linked = resolveNote(target, note)
          const value = `${match[1]}[[${linked.route}${anchor ? "#" + anchor : ""}|${label || linked.data.title}]]`
          edits.push({
            start: node.position.start.offset + match.index,
            end: node.position.start.offset + match.index + match[0].length,
            value,
          })
        }
      }
      if (node.type === "image" || node.type === "link" || node.type === "definition") {
        if (/^(https?:\/\/|mailto:|#)/i.test(node.url)) return
        tasks.push(
          (async () => {
            let href
            const [target, anchor] = node.url.split("#")
            if (node.type !== "image" && /\.md$/i.test(target)) {
              const linked = resolveNote(target, note)
              href =
                path.posix.relative(path.posix.dirname(note.route), linked.route) +
                (anchor ? "#" + anchor : "")
            } else href = await attachment(node.url, note)
            const raw = body.slice(node.position.start.offset, node.position.end.offset)
            const offset = raw.indexOf(
              node.url,
              node.type === "definition" ? raw.indexOf(":") : raw.lastIndexOf("]") + 1,
            )
            if (offset < 0) throw new Error(`无法转换链接：${node.url}`)
            edits.push({
              start: node.position.start.offset + offset,
              end: node.position.start.offset + offset + node.url.length,
              value: href,
            })
          })(),
        )
      }
    })
    await Promise.all(tasks)
    let rendered = body
    for (const edit of edits.sort((a, b) => b.start - a.start))
      rendered = rendered.slice(0, edit.start) + edit.value + rendered.slice(edit.end)
    const data = Object.fromEntries(
      metadataKeys
        .filter((key) => note.data[key] !== undefined)
        .map((key) => [key, note.data[key]]),
    )
    data.publish = true
    data.draft = false
    output.set(
      note.route + ".md",
      Buffer.from(`---\n${YAML.stringify(data)}---\n${rendered.trim()}\n`),
    )
  }

  for (const file of await walk(path.join(project, "site"))) {
    const relative = path.relative(path.join(project, "site"), file).split(path.sep).join("/")
    output.set(relative, await fs.readFile(file))
  }
  const manifestPath = path.join(destination, ".publish-manifest.json")
  let previous = []
  try {
    previous = JSON.parse(await fs.readFile(manifestPath, "utf8")).files
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const stale = previous.filter((file) => !output.has(file))
  for (const file of [...output.keys(), ...stale]) {
    if (!inside(destination, path.resolve(destination, file)))
      throw new Error("输出清单中出现非法路径。")
  }
  const report = {
    dryRun,
    articles: selected.length,
    files: output.size,
    remove: stale,
    titles: selected.map((note) => note.data.title),
  }
  if (!dryRun) {
    for (const [file, bytes] of output) {
      const target = path.join(destination, file)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, bytes)
    }
    for (const file of stale)
      await fs.unlink(path.join(destination, file)).catch((error) => {
        if (error.code !== "ENOENT") throw error
      })
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ files: [...output.keys()].sort() }, null, 2) + "\n",
    )
  }
  console.log(JSON.stringify(report, null, 2))
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
