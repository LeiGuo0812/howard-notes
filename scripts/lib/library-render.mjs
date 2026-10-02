// Pure rendered-copy projection shared by the static build and live content compiler.
// The adapters preserve the existing Node/Buffer API while accepting browser Uint8Arrays.
import YAML from "yaml"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"
import { slug } from "github-slugger"
import { validateCatalog, safeRelative } from "./catalog.mjs"

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

export function renderLibrary(
  catalog,
  sources,
  { path, hash, encode, decode, assetURLs, articleIds },
) {
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
    const mapped = owner.attachments?.find((attachment) =>
      [attachment.source, ...(attachment.aliases || [])].some(
        (source) => source === target || source === decoded,
      ),
    )
    if (mapped?.publicUrl) {
      try {
        const url = new URL(mapped.publicUrl)
        if (url.protocol === "https:" && !url.username && !url.password) return url.href
      } catch {}
    }
    const candidates = [
      path.posix.normalize(path.posix.join(path.posix.dirname(owner.file), decoded)),
      decoded.replace(/^\//, ""),
      "assets/" + decoded,
    ]
    const file = candidates.find(
      (item) =>
        safeRelative(item) &&
        (sources.has(item) || assetURLs?.has(item)) &&
        /\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(item),
    )
    if (!file) return null
    if (assetURLs?.has(file)) return assetURLs.get(file)
    const bytes = sources.get(file)
    const name = `assets/${hash(bytes).slice(0, 16)}${path.posix.extname(file).toLowerCase()}`
    output.set(name, bytes)
    return "../" + name
  }
  for (const article of articles) {
    if (articleIds && !articleIds.has(article.id)) continue
    const bytes = sources.get(article.file)
    if (!bytes) throw new Error(`找不到原文：${article.file}`)
    const { body } = splitNote(decode(bytes))
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
        const attachment = article.attachments?.find((item) =>
          [item.source, ...(item.aliases || [])].includes(node.url),
        )
        if (!attachment && /^(https?:\/\/|mailto:|#|\/\/)/i.test(node.url)) return
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
    output.set(`notes/${article.id}.md`, encode(`---\n${YAML.stringify(metadata)}---\n${rendered}`))
    records.push({ id: article.id, file: article.file, sha256: hash(bytes) })
  }
  return { output, warnings, records }
}
