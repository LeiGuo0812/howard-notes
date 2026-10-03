import DOMPurify from "dompurify"
import { createPreviewCompiler } from "./preview-compiler.mjs"
import { loadMermaidViewer } from "./mermaid-loader.mjs"

let serial = 0
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
          // Cancelled renders do not poison a subsequent retry in this editor.
          if (typeof svg !== "string") {
            if (entries.get(key) === entry) discard(key)
            return svg
          }
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
    if (url.pathname === new URL("private/", base).pathname)
      return articles.find((article) => article.id === url.searchParams.get("note")) || null
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
export function createPreview(
  element,
  context,
  {
    loadViewer = loadMermaidViewer,
    sanitize = (...args) => DOMPurify.sanitize(...args),
    compiler: suppliedCompiler,
  } = {},
) {
  let epoch = 0,
    contextEpoch = 0,
    contextController = new AbortController(),
    disposed = false,
    lastMarkdown = null,
    unobserveTheme = null,
    observedTheme = null
  const compiler = suppliedCompiler || createPreviewCompiler({ siteBase: context().siteBase })
  const imageCache = new Map()
  const diagramCache = createDiagramCache()
  const viewers = new Set()
  const removeViewers = () => {
    for (const viewer of viewers) viewer.destroy()
    viewers.clear()
  }
  const clear = () => {
    epoch++
    compiler.clear?.()
    contextEpoch++
    contextController.abort()
    contextController = new AbortController()
    lastMarkdown = null
    observedTheme = null
    unobserveTheme?.()
    unobserveTheme = null
    removeViewers()
    diagramCache.clear()
    element.replaceChildren()
    for (const value of imageCache.values())
      Promise.resolve(value)
        .then((url) => URL.revokeObjectURL(url))
        .catch(() => {})
    imageCache.clear()
  }
  const preview = {
    clear,
    destroy() {
      if (disposed) return
      disposed = true
      clear()
    },
    async render(text) {
      if (disposed) return
      const version = ++epoch,
        generation = contextEpoch,
        contextSignal = contextController.signal,
        scroll = element.scrollTop
      const ctx = context()
      const article = ctx.articles.find((row) => row.file === ctx.articleFile) || {
        id: "editor-preview",
        file: ctx.articleFile || "notes/new.md",
        title: "预览",
        published: false,
      }
      const compiled = await compiler.render({
        raw: text,
        article: {
          id: article.id,
          file: article.file,
          title: article.title,
          published: article.published,
          attachments: (ctx.attachments || []).map(({ source, aliases, publicUrl }) => ({
            source,
            aliases,
            publicUrl,
          })),
        },
        articles: ctx.articles.map(
          ({
            id,
            file,
            title,
            published,
            category,
            date,
            created,
            modified,
            description,
            featured,
            tags,
          }) => ({
            id,
            file,
            title,
            published,
            category,
            date,
            created,
            modified,
            description,
            featured,
            tags,
          }),
        ),
        // URL objects are not structured-cloneable in browsers. Worker
        // messages carry only plain metadata, even though workspace uses URL.
        siteBase: String(ctx.siteBase),
      })
      if (!compiled || version !== epoch || disposed || !element.isConnected) return
      removeViewers()
      // The shared compiler has already sanitized author HTML. Keep its trusted
      // KaTeX/highlighter styles; DOMPurify adds an independent DOM boundary.
      element.innerHTML = sanitize(compiled.html, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        FORBID_TAGS: ["script", "iframe", "form"],
        FORBID_ATTR: ["srcset", "name"],
      })
      for (const input of element.querySelectorAll("input")) {
        if (input.type === "checkbox") input.disabled = true
        else input.remove()
      }
      for (const link of element.querySelectorAll("a")) {
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        const matched = articleForLink(link.getAttribute("href"), context())
        if (matched?.published !== false && matched)
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
      element.scrollTop = scroll
      const imageTasks = [...element.querySelectorAll("img")].map(async (img) => {
        const src = img.getAttribute("data-preview-source") || img.getAttribute("src") || ""
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
        if (version !== epoch || disposed || !img.isConnected) return
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
            if (version === epoch && img.isConnected)
              img.alt = (img.alt || "图片") + "（私密附件加载失败）"
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
          if (version === epoch && img.isConnected) img.alt = (img.alt || "图片") + "（加载失败）"
        }
      })
      const imagesReady = Promise.allSettled(imageTasks)
      const diagrams = [
        ...element.querySelectorAll("pre > code.language-mermaid, pre > code.mermaid"),
      ]
      if (diagrams.length) {
        lastMarkdown = text
        try {
          const diagramViewer = await loadViewer(ctx.siteBase)
          if (version !== epoch || disposed || !element.isConnected) return
          const theme = diagramViewer.diagramThemeKey(element)
          observedTheme = theme
          unobserveTheme ??= diagramViewer.observeDiagramTheme(element, () => {
            const nextTheme = diagramViewer.diagramThemeKey(element)
            if (
              !disposed &&
              element.isConnected &&
              lastMarkdown !== null &&
              nextTheme !== observedTheme
            ) {
              observedTheme = nextTheme
              void preview.render(lastMarkdown).catch(() => {})
            }
          })
          for (const [index, code] of diagrams.entries()) {
            if (version !== epoch || disposed || !element.isConnected) break
            const host = document.createElement("div")
            host.className = "mermaid-viewer-preview"
            const diagramSource = code.getAttribute?.("data-clipboard") || code.textContent
            const diagramId = `preview-diagram-${++serial}`
            try {
              const svg = await diagramCache.get(
                JSON.stringify([theme, index, diagramSource]),
                () =>
                  diagramViewer.renderDiagram(diagramSource, {
                    element,
                    idPrefix: diagramId,
                    signal: contextSignal,
                    isCurrent: () =>
                      !disposed && generation === contextEpoch && element.isConnected,
                  }),
              )
              if (version !== epoch || disposed || !element.isConnected || !svg) break
              code.parentElement.replaceWith(host)
              viewers.add(
                diagramViewer.mountDiagram(host, {
                  source: diagramSource,
                  svg,
                  isCurrent: () =>
                    !disposed && version === epoch && element.isConnected && host.isConnected,
                }),
              )
            } catch {
              if (version === epoch && !disposed && code.isConnected) {
                const error = document.createElement("small")
                error.className = "preview-error"
                error.textContent = "流程图语法有误"
                code.parentElement.after(error)
              }
            }
          }
        } catch {
          if (version === epoch && !disposed && element.isConnected) {
            const error = document.createElement("small")
            error.textContent = "流程图组件加载失败"
            element.append(error)
          }
        }
      } else {
        lastMarkdown = null
        observedTheme = null
        unobserveTheme?.()
        unobserveTheme = null
      }
      await imagesReady
    },
  }
  return preview
}
