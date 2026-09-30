import type { Element, Node, Parent } from "hast"

const restrictedImageHosts = new Set(["cdn.nlark.com", "img-blog.csdnimg.cn"])
const isElement = (node: Node): node is Element => node.type === "element"

// Change only the rendered image attributes; retain the source URL and note bytes.
export function prepareArticleImages<T extends Node>(node: T): T {
  let rendered = node
  if ("children" in node) {
    rendered = {
      ...node,
      children: (node as Parent).children.map((child) => prepareArticleImages(child)),
    }
  }
  if (!isElement(node)) return rendered
  const image = node
  if (image.tagName !== "img" || typeof image.properties.src !== "string") return rendered
  let url: URL
  try {
    url = new URL(image.properties.src)
  } catch {
    return rendered
  }
  if (!["http:", "https:"].includes(url.protocol) || !restrictedImageHosts.has(url.hostname))
    return rendered
  return {
    ...rendered,
    properties: { ...image.properties, referrerPolicy: "no-referrer" },
  }
}
