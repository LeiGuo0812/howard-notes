import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { renderPrivateReading, type PrivateReadingInput } from "./private-reading"

// Reuse the official resolver/compiler/sanitizer. Only image IO remains on the
// authorized main thread; compiler messages carry metadata, never credentials.
export async function compileEditorPreview(input: PrivateReadingInput) {
  const raw = typeof input.raw === "string" ? input.raw : new TextDecoder().decode(input.raw)
  const sources = new Set<string>()
  const tree = unified().use(remarkParse).parse(raw)
  const imageReferences = new Set<string>()
  visit(tree, (node) => {
    if (node.type === "imageReference") imageReferences.add(node.identifier)
  })
  visit(tree, (node) => {
    if (
      node.type === "image" ||
      (node.type === "definition" && imageReferences.has(node.identifier))
    )
      sources.add(node.url)
    if (node.type === "text")
      for (const match of node.value.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
        if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(match[1])) sources.add(match[1])
    if (node.type === "html")
      visit(fromHtml(node.value, { fragment: true }), (element) => {
        if (
          element.type === "element" &&
          element.tagName === "img" &&
          typeof element.properties.src === "string"
        )
          sources.add(element.properties.src)
      })
  })
  const mapping = new Map<string, string>()
  const assetURLs: [string, string][] = []
  for (const source of sources) {
    if (
      /^(?:https?:|data:|blob:|\/\/)/i.test(source) &&
      !input.article.attachments?.some((item) =>
        [item.source, ...(item.aliases || [])].includes(source),
      )
    )
      continue
    const placeholder = `https://editor-preview.invalid/${mapping.size}.png`
    mapping.set(placeholder, source)
    assetURLs.push([source, placeholder])
  }
  const compiled = await renderPrivateReading({ ...input, assetURLs })
  const output = fromHtml(compiled.html, { fragment: true })
  visit(output, (node) => {
    if (node.type !== "element" || node.tagName !== "img") return
    const original = mapping.get(String(node.properties.src || ""))
    if (!original) return
    delete node.properties.src
    node.properties.dataPreviewSource = original
  })
  return { ...compiled, html: toHtml(output) }
}
