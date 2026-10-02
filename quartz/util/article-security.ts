import { raw } from "hast-util-raw"
import { sanitize, defaultSchema, type Schema } from "hast-util-sanitize"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import type { Element, Root } from "hast"

// One policy for static pages, live publication, transclusions and private reading.
// Apply it to rendered copies only: original Markdown remains byte-for-byte intact.
const svgTags = [
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "rect",
  "text",
  "tspan",
  "defs",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "stop",
]
const allowedData = [
  "dataSlug",
  "dataBlock",
  "dataCallout",
  "dataCalloutFold",
  "dataCalloutMetadata",
  "dataClipboard",
  "dataLanguage",
  "dataTheme",
  "dataLine",
  "dataHighlightedLine",
  "dataHighlightedChars",
  "dataCharsId",
  "dataRehypePrettyCodeFigure",
  "dataRehypePrettyCodeTitle",
  "dataRehypePrettyCodeCaption",
  "dataFootnotes",
  "dataFootnoteRef",
  "dataFootnoteBackref",
  "dataRouterIgnore",
  "dataNoPopover",
]
const schema: Schema = {
  ...defaultSchema,
  // Raw author IDs are namespaced before this policy runs. Generated heading IDs
  // remain stable, keeping saved heading links and Quartz's TOC compatible.
  clobber: [],
  tagNames: [
    ...defaultSchema.tagNames!,
    ...svgTags,
    "figure",
    "figcaption",
    "mark",
    "button",
    "audio",
    "video",
  ],
  strip: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "template",
    "form",
    "textarea",
    "select",
    "option",
    "foreignObject",
    "animate",
    "set",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...defaultSchema.attributes!["*"].filter(
        (entry) =>
          !["name", "action", "method", "encType", "htmlFor", "accessKey", "tabIndex"].includes(
            String(entry),
          ),
      ),
      "className",
      "class",
      "style",
      "role",
      "ariaHidden",
      "ariaExpanded",
      "ariaControls",
      ...allowedData,
      ...allowedData.map((property) =>
        property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      ),
    ],
    a: [
      "href",
      "target",
      "rel",
      "ariaLabel",
      "ariaDescribedBy",
      "ariaLabelledBy",
      "dataFootnoteRef",
      "dataFootnoteBackref",
    ],
    img: ["src", "alt", "loading", "decoding", "referrerPolicy", "ariaLabel"],
    code: ["className"],
    input: [["disabled", true], ["type", "checkbox"], "checked"],
    button: [["type", "button"], "ariaLabel", "disabled"],
    source: ["src", "type"],
    audio: ["src", "controls", "preload"],
    video: ["src", "controls", "preload", "poster", "playsInline"],
    ...Object.fromEntries(
      svgTags.map((tag) => [
        tag,
        [
          "viewBox",
          "xmlns",
          "d",
          "fill",
          "fillRule",
          "fillOpacity",
          "stroke",
          "strokeWidth",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeOpacity",
          "opacity",
          "x",
          "y",
          "x1",
          "y1",
          "x2",
          "y2",
          "cx",
          "cy",
          "r",
          "rx",
          "ry",
          "dx",
          "dy",
          "points",
          "transform",
          "textAnchor",
          "preserveAspectRatio",
          "offset",
          "stopColor",
          "stopOpacity",
          "gradientUnits",
          "gradientTransform",
          "clipPathUnits",
          "maskUnits",
        ],
      ]),
    ),
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "tel"],
    src: ["http", "https", "data"],
    poster: ["http", "https"],
  },
  required: { ...defaultSchema.required, button: { type: "button" } },
}

const styleProperties = new Set([
  "color",
  "background",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "vertical-align",
  "white-space",
  "display",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "border",
  "border-width",
  "border-color",
  "border-style",
  "border-top-width",
  "border-bottom-width",
  "border-right-width",
  "border-left-width",
  "border-top-style",
  "border-bottom-style",
  "border-radius",
])
export function safeArticleStyle(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const declarations = value.split(";").flatMap((declaration) => {
    const separator = declaration.indexOf(":")
    if (separator < 1) return []
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const content = declaration.slice(separator + 1).trim()
    if (!(
      styleProperties.has(property) ||
      /^--shiki-(?:light|dark)(?:-font-(?:style|weight)|-text-decoration)?$/.test(property)
    ))
      return []
    if (!content || /[\\@{}<>]|\/\*|url\s*\(|expression\s*\(|(?:var|attr)\s*\(/i.test(content))
      return []
    if (!/^[\w\s#.,%()+"'/-]+$/.test(content)) return []
    if (property === "position" && !["relative", "absolute", "static"].includes(content)) return []
    if (
      (property === "background" || property.endsWith("color") || property.startsWith("--shiki")) &&
      !/^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(content)
    )
      return []
    return [`${property}:${content}`]
  })
  return declarations.length ? declarations.join(";") : undefined
}

const prefixed = (id: string) => (id.startsWith("note-html-") ? id : `note-html-${id}`)
const reserved =
  /^(?:__|quartz-|main-content$|search$|search-|maintenance-|memory-|listing-|timeline-|runtime-|editor-|admin-)/i
export const articleHeadingId = (id: string) => (reserved.test(id) ? prefixed(id) : id)
const controls = new Set(["mermaid-container", "mermaid-space"])
function cleanTree(tree: Root, authorHtml: boolean): Root {
  const normalized = raw(tree) as Root
  const ids = new Map<string, string>()
  function visit(node: Root | Element) {
    for (const child of node.children) {
      if (child.type !== "element") continue
      const properties = child.properties
      const id = typeof properties.id === "string" ? properties.id : undefined
      if (id) {
        const generated = !authorHtml && (/^h[1-6]$/.test(child.tagName) || controls.has(id))
        const alias = /^t\d+$/.test(id) || /^user-content-(?:fn|fnref)-/.test(id)
        const next = !reserved.test(id) && (generated || alias) ? id : prefixed(id)
        ids.set(id, next)
        properties.id = next
      }
      if (properties.style) properties.style = safeArticleStyle(properties.style)
      const src = properties.src
      if (
        typeof src === "string" &&
        /^data:/i.test(src) &&
        !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(src)
      )
        delete properties.src
      // SVG paint values can contain url(). Only local fragment paint servers
      // are useful here; never let a pasted graphic fetch an external document.
      for (const property of ["fill", "stroke"]) {
        if (
          typeof properties[property] === "string" &&
          /url\s*\(/i.test(String(properties[property])) &&
          !/^url\(#[\w:-]+\)$/.test(String(properties[property]))
        )
          delete properties[property]
      }
      visit(child)
    }
  }
  visit(normalized)
  function references(node: Root | Element) {
    for (const child of node.children) {
      if (child.type !== "element") continue
      for (const [key, value] of Object.entries(child.properties)) {
        if (typeof value !== "string") continue
        if (key === "href" && value.startsWith("#") && ids.has(value.slice(1)))
          child.properties[key] = `#${ids.get(value.slice(1))}`
        if (["fill", "stroke"].includes(key))
          child.properties[key] = value.replace(/url\(#([\w:-]+)\)/g, (match, id) =>
            ids.has(id) ? `url(#${ids.get(id)})` : match,
          )
      }
      references(child)
    }
  }
  references(normalized)
  return sanitize(normalized, schema) as Root
}

/** Run before plugins generate trusted heading IDs, KaTeX and diagram controls. */
export function sanitizeSourceTree(tree: Root): Root {
  return cleanTree(tree, true)
}
/** Run again after transforms/transclusions, covering every inserted fragment. */
export function sanitizeArticleTree(tree: Root): Root {
  return cleanTree(tree, false)
}
/** Defense at HTML insertion boundaries, including reused compiled documents. */
export function sanitizeArticleHtml(html: string): string {
  return toHtml(sanitizeArticleTree(fromHtml(html, { fragment: true })))
}
