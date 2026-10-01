import type { Element, Node, Parent } from "hast"

const isElement = (node: Node): node is Element => node.type === "element"

// Only the article's rendered tree is transformed. Source Markdown, navigation,
// article lists and the independently rendered table of contents stay unchanged.
export function prepareArticleLinks<T extends Node>(node: T): T {
  let rendered = node
  if ("children" in node) {
    rendered = {
      ...node,
      children: (node as Parent).children.map((child) => prepareArticleLinks(child)),
    }
  }
  if (!isElement(node)) return rendered
  const element = node
  if (element.tagName !== "a" || typeof element.properties.href !== "string") return rendered
  const existing = element.properties.rel
  const relations = (Array.isArray(existing) ? existing : [existing]).flatMap((value) =>
    typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [],
  )
  return {
    ...rendered,
    properties: {
      ...element.properties,
      target: "_blank",
      rel: [...new Set([...relations, "noopener", "noreferrer"])],
      dataRouterIgnore: "",
    },
  }
}
