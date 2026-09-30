import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import YAML from "yaml"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"
import { slug } from "github-slugger"
import { validateCatalog, safeRelative } from "./catalog.mjs"
import { validateSite } from "./site-settings.mjs"

export const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
export const escapeHTML = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  )

export function splitNote(text) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { data: {}, body: text }
  let data = {}
  try {
    data = YAML.parse(match[1], { uniqueKeys: false }) ?? {}
  } catch {
    /* original YAML is kept in the source file */
  }
  return { data, body: text.slice(match[0].length) }
}

export function extractNoteTags(text) {
  const { body, data } = splitNote(text)
  const tags = new Set(
    Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === "string") : [],
  )
  const tree = unified().use(remarkParse).parse(body)
  function inspect(node) {
    if (
      ["code", "inlineCode", "html", "link", "definition", "image", "heading"].includes(node.type)
    )
      return
    if (node.type === "text")
      for (const match of node.value.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.add(match[1])
    for (const child of node.children || []) inspect(child)
  }
  inspect(tree)
  return [...tags].map((tag) => tag.trim()).filter(Boolean)
}

export async function walk(root) {
  const files = []
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue
    const file = path.join(root, item.name)
    if (item.isSymbolicLink()) throw new Error(`不支持符号链接：${file}`)
    if (item.isDirectory()) files.push(...(await walk(file)))
    else if (item.isFile()) files.push(file)
  }
  return files.sort()
}

export async function readLibrary(root) {
  const catalog = validateCatalog(
    JSON.parse(await fs.readFile(path.join(root, "catalog.json"), "utf8")),
  )
  const sources = new Map()
  for (const file of await walk(root))
    sources.set(path.relative(root, file).split(path.sep).join("/"), await fs.readFile(file))
  if (sources.has("site.json")) validateSite(JSON.parse(sources.get("site.json").toString()))
  for (const article of catalog.articles)
    if (!sources.has(article.file)) throw new Error(`找不到原文：${article.file}`)
  const listed = new Set(catalog.articles.map((article) => article.file))
  for (const file of sources.keys()) {
    if (file.startsWith("notes/") && !listed.has(file)) throw new Error(`尚未登记发布设置：${file}`)
    if (
      !file.startsWith("notes/") &&
      !file.startsWith("assets/") &&
      !["catalog.json", "site.json"].includes(file)
    )
      throw new Error(`不支持的文库文件：${file}`)
  }
  return { catalog, sources }
}

export function renderLibrary(catalog, sources) {
  validateCatalog(catalog)
  const articles = catalog.articles.filter((article) => article.published)
  const output = new Map(),
    warnings = [],
    records = []
  const byFile = new Map(articles.map((article) => [article.file, article]))
  const notFound = (owner, target, label) => {
    warnings.push({ article: owner.id, target, kind: "unavailable-link" })
    return `<span class="unavailable-note" title="此引用尚未公开或无法解析">${escapeHTML(label)}</span>`
  }
  function resolve(target, owner) {
    let decoded
    try {
      decoded = decodeURIComponent(target).replace(/\.md$/i, "")
    } catch {
      return null
    }
    const paths = [
      path.posix.normalize(path.posix.join(path.posix.dirname(owner.file), decoded + ".md")),
      "notes/" + decoded.replace(/^\//, "") + ".md",
    ]
    for (const file of paths) if (byFile.has(file)) return byFile.get(file)
    const matches = articles.filter(
      (article) =>
        path.posix.basename(article.file, ".md") === decoded ||
        article.title === decoded ||
        "notes/" + article.id === decoded,
    )
    return matches.length === 1 ? matches[0] : null
  }
  function asset(target, owner) {
    let decoded
    try {
      decoded = decodeURIComponent(target)
    } catch {
      return null
    }
    const candidates = [
      path.posix.normalize(path.posix.join(path.posix.dirname(owner.file), decoded)),
      decoded.replace(/^\//, ""),
      "assets/" + decoded,
    ]
    const file = candidates.find(
      (item) =>
        safeRelative(item) &&
        sources.has(item) &&
        /\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(item),
    )
    if (!file) return null
    const bytes = sources.get(file)
    const name = `assets/${hash(bytes).slice(0, 16)}${path.posix.extname(file).toLowerCase()}`
    output.set(name, bytes)
    return "../" + name
  }
  for (const article of articles) {
    const bytes = sources.get(article.file)
    if (!bytes) throw new Error(`找不到原文：${article.file}`)
    const { body } = splitNote(bytes.toString("utf8"))
    const tree = unified().use(remarkParse).parse(body)
    const edits = []
    // Some clipped source notes have #t0-style TOCs but no surviving named anchors.
    // Restore invisible anchor aliases at matching headings in the rendered copy only.
    const textOf = (node) => node.value ?? node.children?.map(textOf).join("") ?? ""
    const normalize = (text) => text.replace(/\s+/g, "").trim()
    const headings = [],
      aliases = new Set()
    visit(tree, "heading", (node) => {
      headings.push(node)
    })
    visit(tree, "link", (node) => {
      if (!/^#t\d+$/.test(node.url) || aliases.has(node.url)) return
      const matches = headings.filter(
        (heading) => normalize(textOf(heading)) === normalize(textOf(node)),
      )
      if (matches.length !== 1) return
      aliases.add(node.url)
      edits.push({
        start: matches[0].position.start.offset,
        end: matches[0].position.start.offset,
        value: `<span id="${node.url.slice(1)}"></span>\n\n`,
      })
    })
    const replace = (node, value) =>
      edits.push({ start: node.position.start.offset, end: node.position.end.offset, value })
    visit(tree, (node) => {
      if (node.type === "text") {
        const raw = body.slice(node.position.start.offset, node.position.end.offset)
        for (const match of raw.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          const [reference, alias] = match[2].split("|")
          const [target, anchor] = reference.split("#")
          if (!target) continue
          const linked = resolve(target, article)
          const label = alias || target
          let value
          if (linked)
            value = `${match[1]}[[notes/${linked.id}${anchor ? "#" + anchor : ""}|${label}]]`
          else if (match[1] && asset(target, article))
            value = `![${alias || path.posix.basename(target)}](${asset(target, article)})`
          else value = notFound(article, target, label)
          edits.push({
            start: node.position.start.offset + match.index,
            end: node.position.start.offset + match.index + match[0].length,
            value,
          })
        }
      }
      if (node.type === "link" || node.type === "image" || node.type === "definition") {
        if (/^(https?:\/\/|mailto:|#|\/\/)/i.test(node.url)) return
        const [target, anchor] = node.url.split("#")
        const linked = /\.md$/i.test(target) ? resolve(target, article) : null
        const href = linked
          ? linked.id + (anchor ? "#" + slug(anchor) : "")
          : asset(target, article)
        if (!href) {
          if (node.type !== "definition")
            replace(
              node,
              notFound(
                article,
                node.url,
                node.alt ||
                  node.children?.map((child) => child.value ?? "").join("") ||
                  path.posix.basename(target),
              ),
            )
          return
        }
        const raw = body.slice(node.position.start.offset, node.position.end.offset)
        const offset = raw.indexOf(
          node.url,
          node.type === "definition" ? raw.indexOf(":") : raw.lastIndexOf("]") + 1,
        )
        if (offset >= 0)
          edits.push({
            start: node.position.start.offset + offset,
            end: node.position.start.offset + offset + node.url.length,
            value: href,
          })
      }
    })
    let rendered = body
    let boundary = body.length + 1
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      if (edit.end > boundary) continue
      rendered = rendered.slice(0, edit.start) + edit.value + rendered.slice(edit.end)
      boundary = edit.start
    }
    const metadata = {
      title: article.title,
      description: article.description || `${article.category} · ${article.title}`,
      date: article.date,
      ...(article.created ? { created: article.created } : {}),
      ...(article.modified ? { modified: article.modified } : {}),
      category: article.category,
      tags: article.tags || [],
      type: "article",
      featured: article.featured === true,
      publish: true,
      draft: false,
      sourceFile: article.file,
      sourceHash: hash(bytes),
    }
    output.set(
      `notes/${article.id}.md`,
      Buffer.from(`---\n${YAML.stringify(metadata)}---\n${rendered}`),
    )
    records.push({ id: article.id, file: article.file, sha256: hash(bytes) })
  }
  return { output, warnings, records }
}
