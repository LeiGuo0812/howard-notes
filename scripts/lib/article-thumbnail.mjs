import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { fromHtml } from "hast-util-from-html"
import { transformLink } from "@quartz-community/utils"
import { splitNote } from "./library-render.mjs"

// Independent of syntax highlighting: upgrading thumbnail metadata must not force
// all unchanged documents through the expensive Markdown compiler again.
export const THUMBNAIL_VERSION = "article-image-v1"
const placeholderOrigin = "https://thumbnail.invalid"
const projectPrefix = "/__site__/"
const markdown = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true })

/** Return a URL safe for an img src, with relative paths based at the article route. */
export function thumbnailSource(value, slug = "notes/article") {
  if (typeof value !== "string") return undefined
  const source = value.trim()
  if (!source || /[\u0000-\u001f\u007f\\]/.test(source) || source.startsWith("#")) return undefined
  const scheme = source.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme && !["http", "https"].includes(scheme)) return undefined
  if (scheme && !/^https?:\/\//i.test(source)) return undefined
  try {
    const url = new URL(source, `${placeholderOrigin}${projectPrefix}${slug}`)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return undefined
    if (scheme) return url.href
    if (source.startsWith("//")) return `//${url.host}${url.pathname}${url.search}${url.hash}`
    if (source.startsWith("/")) return `${url.pathname}${url.search}${url.hash}`
    if (!url.pathname.startsWith(projectPrefix)) return undefined
    return `${url.pathname.slice(projectPrefix.length)}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

/** Read the first actual image, excluding code, comments, and unsafe URL schemes. */
export function extractArticleThumbnail(tree, slug, { resolveMarkdownImages = false } = {}) {
  function inspect(node, rawHtml = false) {
    if (node.type === "raw") return inspect(fromHtml(node.value, { fragment: true }), true)
    if (node.type === "element") {
      if (["script", "style", "template", "pre", "code"].includes(node.tagName)) return
      if (node.tagName === "img") {
        let source = node.properties?.src
        if (resolveMarkdownImages && !rawHtml && typeof source === "string") {
          // Match Quartz CrawlLinks' absolute strategy before resolving to a
          // website-relative URL. Raw HTML retains its browser-relative URLs.
          if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source))
            source = transformLink(slug, source, { strategy: "absolute", allSlugs: [] })
        }
        const src = thumbnailSource(source, slug)
        if (src) {
          const originalAlt = typeof node.properties?.alt === "string" ? node.properties.alt : ""
          // Obsidian's image dimensions are presentation hints, not image labels.
          const alt = originalAlt.replace(/\|\d+(?:x\d+)?$/, "").trim()
          return { src, alt }
        }
      }
    }
    for (const child of node.children || []) {
      const found = inspect(child, rawHtml)
      if (found) return found
    }
  }
  return inspect(tree)
}

/** Static builds use the already-resolved Markdown copies, never the original notes. */
export function renderedArticleThumbnails(output) {
  const thumbnails = new Map()
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
  for (const [file, bytes] of output) {
    const match = file.match(/^notes\/([^/]+)\.md$/)
    if (!match) continue
    const { body } = splitNote(decoder.decode(bytes))
    const tree = markdown.runSync(markdown.parse(body))
    const thumbnail = extractArticleThumbnail(tree, `notes/${match[1]}`, {
      resolveMarkdownImages: true,
    })
    if (thumbnail) thumbnails.set(match[1], thumbnail)
  }
  return thumbnails
}
