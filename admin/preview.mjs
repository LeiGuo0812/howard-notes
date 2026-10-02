import { Marked } from "marked"
import DOMPurify from "dompurify"
import katex from "katex"

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  )
let mermaidPromise,
  serial = 0
function loadMermaid() {
  return (mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: 50000,
      maxEdges: 300,
      suppressErrorRendering: true,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "htmlLabels",
        "flowchart",
        "themeCSS",
        "themeVariables",
        "theme",
        "dompurifyConfig",
        "fontFamily",
        "fontSize",
      ],
    })
    return mermaid
  }))
}
// A preview reuses only sanitized output for an unchanged diagram at the same
// position. Position scopes Mermaid IDs; identical diagrams elsewhere in the
// same document still receive independent IDs. The cache belongs to one editor
// and is cleared when its article/context changes, never persisted to storage.
export function createDiagramCache({ maxEntries = 12, maxBytes = 1_000_000 } = {}) {
  const entries = new Map()
  let bytes = 0
  const discard = (key) => {
    const entry = entries.get(key)
    if (!entry) return
    bytes -= entry.bytes
    entries.delete(key)
  }
  return {
    get(key, render) {
      const existing = entries.get(key)
      if (existing) {
        entries.delete(key)
        entries.set(key, existing)
        return existing.promise
      }
      const entry = { bytes: 0 }
      entry.promise = Promise.resolve()
        .then(render)
        .then((svg) => {
          if (entries.get(key) === entry) {
            entry.bytes = svg.length * 2
            bytes += entry.bytes
            while (bytes > maxBytes && entries.size) discard(entries.keys().next().value)
          }
          return svg
        })
        .catch((error) => {
          if (entries.get(key) === entry) discard(key)
          throw error
        })
      entries.set(key, entry)
      while (entries.size > maxEntries) discard(entries.keys().next().value)
      return entry.promise
    },
    clear() {
      entries.clear()
      bytes = 0
    },
  }
}
export function assetPath(source, articleFile) {
  let decoded
  try {
    decoded = decodeURIComponent(source)
  } catch {
    return null
  }
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(decoded)) return null
  const segments = articleFile?.split("/").slice(0, -1) || ["notes", "网页新建"]
  for (const segment of decoded.split("/")) {
    if (segment === "..") segments.pop()
    else if (segment && segment !== ".") segments.push(segment)
  }
  const joined = segments.join("/")
  if (/^assets\/.+\.(png|jpe?g|gif|webp|avif)$/i.test(joined)) return joined
  if (/^assets\/.+\.(png|jpe?g|gif|webp|avif)$/i.test(decoded)) return decoded
  return null
}
export function articleForLink(source, { articles = [], siteBase, articleFile } = {}) {
  if (!source || source.startsWith("#")) return null
  const base = new URL(siteBase || "../", globalThis.location?.href || "https://notes.invalid/")
  let value
  try {
    value = decodeURIComponent(source.split("#")[0])
  } catch {
    return null
  }
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
    let url
    try {
      url = new URL(value, base)
    } catch {
      return null
    }
    if (url.origin !== base.origin) return null
    return (
      articles.find((article) => url.pathname === new URL(`notes/${article.id}`, base).pathname) ||
      null
    )
  }
  const segments = (articleFile || "notes/new.md").split("/").slice(0, -1)
  for (const segment of value.split("/")) {
    if (segment === "..") segments.pop()
    else if (segment && segment !== ".") segments.push(segment)
  }
  const relative = segments.join("/").replace(/\.md$/i, "")
  const target = value.replace(/^\//, "").replace(/\.md$/i, "")
  const matches = articles.filter((article) =>
    [
      article.file.replace(/\.md$/i, ""),
      article.file.replace(/^notes\//, "").replace(/\.md$/i, ""),
      article.id,
    ].some((path) => path === relative || path === target),
  )
  return matches.length === 1 ? matches[0] : null
}
export function createPreview(element, context) {
  let epoch = 0
  const imageCache = new Map()
  const diagramCache = createDiagramCache()
  const mathToken = (raw, expression, display) => ({
    type: display ? "displayMath" : "inlineMath",
    raw,
    expression,
    display,
  })
  const mathRenderer = (token) =>
    `<span class="math-placeholder" data-expression="${encodeURIComponent(token.expression)}" data-display="${token.display}"></span>`
  const parser = new Marked({ gfm: true, breaks: false })
  parser.use({
    extensions: [
      {
        name: "displayMath",
        level: "block",
        start: (src) => src.indexOf("$$"),
        tokenizer(src) {
          const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$(?:\n|$)/.exec(src)
          if (m) return mathToken(m[0], m[1], true)
        },
        renderer: mathRenderer,
      },
      {
        name: "inlineMath",
        level: "inline",
        start: (src) => src.indexOf("$"),
        tokenizer(src) {
          const m = /^\$(?!\$)((?:\\.|[^$\n\\])+?)\$(?!\$)/.exec(src)
          if (m) return mathToken(m[0], m[1], false)
        },
        renderer: mathRenderer,
      },
      {
        name: "wiki",
        level: "inline",
        start: (src) => src.search(/!?\[\[/),
        tokenizer(src) {
          const m = /^(!?)\[\[([^\]\n]+)\]\]/.exec(src)
          if (m) return { type: "wiki", raw: m[0], embed: !!m[1], value: m[2] }
        },
        renderer(token) {
          const [reference, alias] = token.value.split("|"),
            [target, anchor] = reference.split("#"),
            label = alias || target
          if (token.embed && /\.(png|jpe?g|gif|webp|avif)$/i.test(target))
            return `<img alt="${escape(alias || target)}" src="${escape(target)}">`
          const resolved = articleForLink(target, context())
          const matches = resolved
            ? [resolved]
            : context().articles.filter(
                (article) =>
                  article.title === target ||
                  article.file.replace(/^notes\//, "").replace(/\.md$/, "") === target ||
                  article.file.split("/").pop().replace(/\.md$/, "") === target,
              )
          return matches.length === 1
            ? `<a ${matches[0].published === false ? `data-private-article="${escape(matches[0].id)}"` : ""} href="${escape(new URL(`notes/${matches[0].id}${anchor ? "#" + encodeURIComponent(anchor) : ""}`, context().siteBase || new URL("../", location.href)).href)}">${escape(label)}</a>`
            : `<span class="unavailable-note">${escape(label)}</span>`
        },
      },
      {
        name: "highlight",
        level: "inline",
        start: (src) => src.indexOf("=="),
        tokenizer(src) {
          const m = /^==([^=\n]+)==/.exec(src)
          if (m) return { type: "highlight", raw: m[0], text: m[1] }
        },
        renderer: (token) => `<mark>${escape(token.text)}</mark>`,
      },
    ],
  })
  return {
    clear() {
      epoch++
      diagramCache.clear()
      for (const value of imageCache.values())
        Promise.resolve(value)
          .then((url) => URL.revokeObjectURL(url))
          .catch(() => {})
      imageCache.clear()
    },
    async render(text) {
      const version = ++epoch,
        scroll = element.scrollTop
      const source = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
      element.innerHTML = DOMPurify.sanitize(parser.parse(source), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["style", "iframe", "form", "button"],
        FORBID_ATTR: ["style", "srcset", "id", "name"],
      })
      for (const input of element.querySelectorAll("input")) {
        if (input.type === "checkbox") input.disabled = true
        else input.remove()
      }
      for (const link of element.querySelectorAll("a")) {
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        const matched = articleForLink(link.getAttribute("href"), context())
        if (matched)
          link.href = new URL(
            `notes/${matched.id}${new URL(link.href).hash}`,
            context().siteBase,
          ).href
        const privateId =
          link.dataset.privateArticle || (matched?.published === false ? matched.id : null)
        if (privateId)
          link.addEventListener("click", (event) => {
            event.preventDefault()
            void context().openArticle?.(privateId)
          })
      }
      for (const span of element.querySelectorAll(".math-placeholder")) {
        try {
          katex.render(decodeURIComponent(span.dataset.expression), span, {
            displayMode: span.dataset.display === "true",
            throwOnError: false,
            trust: false,
            maxExpand: 1000,
            strict: "ignore",
          })
        } catch {
          span.textContent = "公式格式有误"
        }
      }
      element.scrollTop = scroll
      const ctx = context()
      const imageTasks = [...element.querySelectorAll("img")].map(async (img) => {
        const src = img.getAttribute("src") || ""
        img.referrerPolicy = "no-referrer"
        img.loading = "lazy"
        const file = assetPath(src, ctx.articleFile),
          staged = ctx.images.find((item) => item.url === src || (file && item.file === file))
        if (staged?.preview) {
          img.src = staged.preview
          return
        }
        const attachment = (ctx.attachments || []).find((item) =>
          [item.source, item.sourcePath, ...(item.aliases || [])].includes(src),
        )
        if (attachment?.publicUrl) {
          if (/^https:\/\//i.test(attachment.publicUrl)) img.src = attachment.publicUrl
          else img.removeAttribute("src")
          return
        }
        const privateSource =
          attachment?.fileId && !attachment.publicUrl
            ? await ctx.client.privateFileUrl(attachment.fileId)
            : /\/api\/content\/personal\/files\//.test(src)
              ? src
              : null
        if (privateSource) {
          img.removeAttribute("src")
          try {
            if (!imageCache.has(privateSource))
              imageCache.set(
                privateSource,
                ctx.client.readPrivateFile(privateSource).then((blob) => URL.createObjectURL(blob)),
              )
            const url = await imageCache.get(privateSource)
            if (version === epoch && img.isConnected) img.src = url
          } catch {
            if (img.isConnected) img.alt = (img.alt || "图片") + "（私密附件加载失败）"
          }
          return
        }
        if (!file) {
          if (!/^(https?:|data:|blob:)/i.test(src)) img.removeAttribute("src")
          return
        }
        img.removeAttribute("src")
        try {
          const sha = ctx.snapshot.entries.get("library/" + file)?.sha
          if (!sha) return
          if (!imageCache.has(sha))
            imageCache.set(
              sha,
              ctx.client.readAsset(file, ctx.snapshot).then((blob) => URL.createObjectURL(blob)),
            )
          const url = await imageCache.get(sha)
          if (version === epoch && img.isConnected) img.src = url
        } catch {
          if (img.isConnected) img.alt = (img.alt || "图片") + "（加载失败）"
        }
      })
      const diagrams = [...element.querySelectorAll("pre > code.language-mermaid")]
      if (diagrams.length) {
        try {
          const mermaid = await loadMermaid()
          for (const [index, code] of diagrams.entries()) {
            if (version !== epoch) break
            const host = document.createElement("div")
            host.className = "mermaid-preview"
            const diagramId = `preview-diagram-${++serial}`
            try {
              const svg = await diagramCache.get(
                JSON.stringify([index, code.textContent]),
                async () => {
                  const { svg } = await mermaid.render(diagramId, code.textContent)
                  return DOMPurify.sanitize(svg, {
                    USE_PROFILES: { svg: true, svgFilters: true },
                    FORBID_TAGS: ["foreignObject"],
                  })
                },
              )
              if (version !== epoch) break
              host.innerHTML = svg
              code.parentElement.replaceWith(host)
            } catch {
              document.getElementById("d" + diagramId)?.remove()
              if (version === epoch) {
                const error = document.createElement("small")
                error.className = "preview-error"
                error.textContent = "流程图语法有误"
                code.parentElement.after(error)
              }
            }
          }
        } catch {
          if (version === epoch) {
            const error = document.createElement("small")
            error.textContent = "流程图组件加载失败"
            element.append(error)
          }
        }
      }
      await Promise.allSettled(imageTasks)
    },
  }
}
