import path from "node:path"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit as visitMarkdown } from "unist-util-visit"
import type { Element, Root } from "hast"
// The rendered-copy adapter also serves browser publication and contains no filesystem IO.
// @ts-expect-error The existing shared JavaScript adapter has no declaration file.
import { renderLibrary, splitNote } from "../scripts/lib/library-render.mjs"
import { createMarkdownCompiler, renderArticleFragment } from "./markdown"
import { articleHeadingId, sanitizeArticleTree } from "../quartz/util/article-security"

export type PrivateReadingArticle = {
  id: string
  file: string
  title: string
  published: boolean
  category?: string
  date?: string
  created?: string
  modified?: string
  description?: string
  featured?: boolean
  tags?: string[]
  attachments?: { source: string; aliases?: string[]; publicUrl?: string }[]
}
export type PrivateReadingInput = {
  article: PrivateReadingArticle
  raw: string | Uint8Array
  articles: PrivateReadingArticle[]
  /** Authenticated blob URLs are supplied by the current owner's main-thread reader. */
  assetURLs?: [string, string][]
  siteBase?: string
}
export type PrivateReadingResult = {
  html: string
  toc: { depth: number; text: string; slug: string }[]
  /** The same metadata-only slug format used by Quartz's in-memory graph. */
  links: string[]
}

const encoder = new TextEncoder()
// ignoreBOM preserves an original BOM while decoding a source copy.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
const decode = (value: Uint8Array) => decoder.decode(value)
const classes = (node: Element) =>
  Array.isArray(node.properties.className) ? node.properties.className.map(String) : []

function baseURL(value?: string): URL {
  const url = new URL(value || "https://notes.invalid/")
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("网站地址不正确。")
  url.search = ""
  url.hash = ""
  if (!url.pathname.endsWith("/")) url.pathname += "/"
  return url
}

function assetURL(value: string, base: URL): string | undefined {
  try {
    const url = new URL(value)
    if (url.username || url.password) return
    if (url.protocol === "https:") return url.href
    // A blob is useful only in the page that created it. Do not accept author-provided
    // blob URLs or a blob belonging to another origin through this explicit mapping.
    if (url.protocol === "blob:" && url.origin === base.origin) return url.href
  } catch {
    /* Invalid mappings remain unavailable rather than becoming active HTML. */
  }
}

function sourceAliases(source: string, articleFile: string): string[] {
  let decoded = source
  try {
    decoded = decodeURIComponent(source)
  } catch {
    /* The exact source may still match an attachment mapping. */
  }
  const aliases = new Set([source, decoded])
  if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(decoded)) {
    aliases.add(path.posix.normalize(decoded).replace(/^\//, ""))
    aliases.add(path.posix.normalize(path.posix.join(path.posix.dirname(articleFile), decoded)))
    if (/^(?:notes|assets)\//.test(decoded))
      aliases.add(path.posix.relative(path.posix.dirname(articleFile), decoded))
  }
  return [...aliases]
}

function visit(tree: Root | Element, callback: (node: Element) => void) {
  for (const child of tree.children) {
    if (child.type !== "element") continue
    callback(child)
    visit(child, callback)
  }
}

function resolveRouteLinks(
  source: string,
  owner: PrivateReadingArticle,
  rows: PrivateReadingArticle[],
) {
  const { body } = splitNote(source)
  const tree = unified().use(remarkParse).parse(body)
  const edits: { start: number; end: number; value: string }[] = []
  visitMarkdown(tree, (node) => {
    if (node.type !== "link" && node.type !== "definition") return
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(node.url)) return
    const [target, ...fragments] = node.url.split("#")
    if (/\.md$/i.test(target)) return
    let decoded: string
    try {
      decoded = decodeURIComponent(target)
    } catch {
      return
    }
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(owner.file), decoded))
    const matches = rows.filter((row) =>
      [row.id, `notes/${row.id}`, row.title, row.file.replace(/\.md$/i, "")].some(
        (candidate) => candidate === decoded || candidate === relative,
      ),
    )
    if (matches.length !== 1) return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    const original = body.slice(start, end)
    const offset = original.indexOf(
      node.url,
      node.type === "definition" ? original.indexOf(":") : original.lastIndexOf("]") + 1,
    )
    if (offset < 0) return
    const file = path.posix.relative(path.posix.dirname(owner.file), matches[0].file)
    const href = file.split("/").map(encodeURIComponent).join("/")
    edits.push({
      start: start + offset,
      end: start + offset + node.url.length,
      value: href + (fragments.length ? `#${fragments.join("#")}` : ""),
    })
  })
  let rendered = body
  for (const edit of edits.sort((a, b) => b.start - a.start))
    rendered = rendered.slice(0, edit.start) + edit.value + rendered.slice(edit.end)
  return source.slice(0, source.length - body.length) + rendered
}

/**
 * Compile one authorized original into an ephemeral reading fragment. Private metadata
 * joins the resolver only in this request; no public projection, raw cache or IO is used.
 */
export async function renderPrivateReading(
  input: PrivateReadingInput,
): Promise<PrivateReadingResult> {
  const { article, articles, raw } = input
  if (
    !article ||
    !Array.isArray(articles) ||
    !(typeof raw === "string" || raw instanceof Uint8Array)
  )
    throw new Error("文章读取信息不完整。")
  const source = typeof raw === "string" ? encoder.encode(raw) : raw.slice()
  if (source.byteLength > 1_500_000) throw new Error("文章原文过大。")
  const base = baseURL(input.siteBase)
  const bytes = await crypto.subtle.digest("SHA-256", source)
  const sourceHash = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  const originals = new Map(articles.map((row) => [row.id, row]))
  originals.set(article.id, article)
  const mappedImages = new Map<string, string>()
  const placeholders = new Map<string, string>()
  const mappedAttachments: NonNullable<PrivateReadingArticle["attachments"]> = []
  for (const entry of input.assetURLs || []) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "string")
      continue
    const url = assetURL(entry[1], base)
    if (!url) continue
    const aliases = sourceAliases(entry[0], article.file)
    const placeholder = `https://private-render.invalid/asset/${placeholders.size}.png`
    placeholders.set(placeholder, url)
    for (const alias of aliases) mappedImages.set(alias, url)
    mappedAttachments.push({ source: entry[0], aliases, publicUrl: placeholder })
  }

  // Only resolver copies are marked published. Whitelisting metadata also omits draft
  // baselines, recovery text and any accidental source fields from a caller's rows.
  const resolver = [...originals.values()].map((row) => {
    const attachments = (row.attachments || []).map((attachment) => {
      const aliases = [attachment.source, ...(attachment.aliases || [])]
      const mapped =
        row.id === article.id
          ? mappedAttachments.find((candidate) =>
              aliases.some((alias) => candidate.aliases?.includes(alias)),
            )
          : undefined
      return {
        source: attachment.source,
        aliases: attachment.aliases ? [...attachment.aliases] : [],
        ...(mapped
          ? { publicUrl: mapped.publicUrl }
          : attachment.publicUrl
            ? { publicUrl: attachment.publicUrl }
            : {}),
      }
    })
    return {
      id: row.id,
      file: row.file,
      title: row.title,
      category: row.category || "未分类",
      date: row.date || row.modified || row.created || "1970-01-01",
      ...(row.created ? { created: row.created } : {}),
      ...(row.modified ? { modified: row.modified } : {}),
      description: row.description || "",
      tags: [...(row.tags || [])],
      featured: row.featured === true,
      published: true,
      attachments: row.id === article.id ? [...attachments, ...mappedAttachments] : attachments,
    }
  })
  const rendered = renderLibrary(
    { version: 2, articles: resolver },
    new Map([[article.file, encoder.encode(resolveRouteLinks(decode(source), article, resolver))]]),
    {
      path,
      hash: () => sourceHash,
      encode: (text: string) => encoder.encode(text),
      decode,
      articleIds: new Set([article.id]),
    },
  )
  const projected = rendered.output.get(`notes/${article.id}.md`)
  if (!(projected instanceof Uint8Array)) throw new Error("文章读取信息不完整。")
  const note = splitNote(decode(projected))
  const slugs = resolver.map((row) => `notes/${row.id}`)
  const compile = createMarkdownCompiler(slugs)
  const compiled = await compile(note.body, note.data, `notes/${article.id}`)

  // Resolving an embed does not grant permission to fetch other originals. Keep a
  // clear link to that original instead of expanding a partial or cached private body.
  visit(compiled.tree, (node) => {
    if (node.tagName !== "blockquote" || !classes(node).includes("transclude")) return
    const link = node.children.find(
      (child): child is Element => child.type === "element" && child.tagName === "a",
    )
    node.properties.className = ["private-transclusion-link"]
    if (!link) return
    const slug = String(link.properties.dataSlug || link.properties["data-slug"] || "")
    const linked = originals.get(slug.replace(/^notes\//, ""))
    node.children = [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [{ type: "text", value: "引用内容请在原文中查看。" }],
      },
      { ...link, children: [{ type: "text", value: linked?.title || "查看引用原文" }] },
    ]
  })
  const html = renderArticleFragment(
    compiled.tree,
    `notes/${article.id}`,
    resolver.map((row) => ({ slug: `notes/${row.id}`, frontmatter: { title: row.title } })),
  )
  const safe = sanitizeArticleTree(fromHtml(html, { fragment: true }))
  const links = new Set<string>()
  const compilerBase = new URL(`notes/${article.id}`, base)
  visit(safe, (node) => {
    if (node.tagName === "img" && typeof node.properties.src === "string") {
      const src = node.properties.src
      const mapped =
        placeholders.get(src) ||
        sourceAliases(src, article.file)
          .map((alias) => mappedImages.get(alias))
          .find(Boolean)
      // Blob URLs enter only here, after the shared author-HTML sanitizer. This
      // narrowly trusted image assignment does not broaden its global protocols.
      if (mapped) node.properties.src = mapped
      return
    }
    if (node.tagName !== "a" || typeof node.properties.href !== "string") return
    const href = node.properties.href
    if (href.startsWith("#")) {
      delete node.properties.target
      delete node.properties.dataRouterIgnore
      delete node.properties["data-router-ignore"]
      return
    }
    let target = originals.get(
      String(node.properties.dataSlug || node.properties["data-slug"] || "").replace(
        /^notes\//,
        "",
      ),
    )
    let resolved: URL | undefined
    try {
      resolved = new URL(href, compilerBase)
      if (!target && resolved.origin === base.origin) {
        const id = decodeURIComponent(resolved.pathname).replace(/\/$/, "").split("/").at(-1)
        target = id ? originals.get(id) : undefined
      }
    } catch {
      /* A sanitized but unresolvable link remains a normal external link. */
    }
    if (target) {
      const url = target.published ? new URL(`notes/${target.id}`, base) : new URL("private/", base)
      if (!target.published) url.searchParams.set("note", target.id)
      let anchor = resolved?.hash || ""
      try {
        if (anchor) anchor = `#${articleHeadingId(decodeURIComponent(anchor.slice(1)))}`
      } catch {
        /* Preserve an already safe encoded fragment when decoding is impossible. */
      }
      url.hash = anchor
      node.properties.href = url.href
      links.add(`notes/${target.id}`)
    }
    node.properties.target = "_blank"
    node.properties.rel = ["noopener", "noreferrer"]
    node.properties.dataRouterIgnore = ""
  })
  return {
    html: toHtml(safe),
    toc: (compiled.data.toc || []).map(({ depth, text, slug }) => ({ depth, text, slug })),
    links: [...links],
  }
}
