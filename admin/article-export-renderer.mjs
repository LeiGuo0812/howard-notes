import exportStyles from "./article-export-renderer.css"
import mathStyles from "katex/dist/katex.min.css"
import { mermaidConfiguration } from "./mermaid-theme.mjs"
import { safeDiagramCss } from "./mermaid-svg-style.mjs"
import { sourceLink } from "./article-share-core.mjs"

import {
  ArticleExportError,
  EXPORT_WIDTH,
  PAGE_HEIGHT,
  imageCapturePlan,
  pageSlices,
} from "./article-export-renderer-core.mjs"
export {
  ArticleExportError,
  EXPORT_WIDTH,
  imageCaptureScale,
  pageSlices,
} from "./article-export-renderer-core.mjs"
const MAX_IMAGE_PIXELS = 32_000_000

function abortError() {
  return new DOMException("已取消导出", "AbortError")
}
function check(signal) {
  if (signal?.aborted) throw abortError()
}
function yieldTurn(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(done, 0)
    function done() {
      signal?.removeEventListener("abort", cancel)
      resolve()
    }
    function cancel() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      reject(abortError())
    }
    signal?.addEventListener("abort", cancel, { once: true })
  })
}
function wait(promise, signal, timeout = 12000) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => finish(new Error("资源加载超时")), timeout)
    const cancel = () => finish(abortError())
    function finish(error, value) {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      if (error) reject(error)
      else resolve(value)
    }
    signal?.addEventListener("abort", cancel, { once: true })
    Promise.resolve(promise).then((value) => finish(null, value), finish)
  })
}

function element(doc, tag, className, text) {
  const value = doc.createElement(tag)
  if (className) value.className = className
  if (text != null) value.textContent = text
  return value
}
function resources() {
  const urls = new Set()
  return {
    add(blob) {
      const url = URL.createObjectURL(blob)
      urls.add(url)
      return url
    },
    clear() {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}
function copyStyles(source, doc, signal, siteBase) {
  const login = source.querySelector("[data-maintenance-login]")
  const base =
    siteBase || (login ? new URL("../", login.href).href : new URL("./", source.baseURI).href)
  const fontBase = new URL("maintenance-assets/article-export-fonts/", base).href
  const mathematics = element(doc, "style")
  mathematics.textContent = mathStyles
    .replace(/url\(["']?fonts\/([^\)"']+\.woff2)["']?\)/g, (_, file) => `url("${fontBase}${file}")`)
    .replace(/,\s*url\(["']?fonts\/[^\)"']+\.(?:woff|ttf)["']?\)\s*format\([^\)]*\)/g, "")

  const ready = []
  for (const style of source.querySelectorAll("style")) {
    const copy = element(doc, "style")
    copy.textContent = style.textContent
    doc.head.append(copy)
  }
  for (const link of source.querySelectorAll('link[rel="stylesheet"]')) {
    let url
    try {
      url = new URL(link.href, source.baseURI)
    } catch {
      continue
    }
    // Site assets and bundled KaTeX fonts are self-hosted. Do not introduce a
    // new third-party font or CSS request just for exporting a private article.
    if (url.origin !== new URL(source.baseURI).origin) continue
    const copy = element(doc, "link")
    copy.rel = "stylesheet"
    copy.href = url.href
    ready.push(
      wait(
        new Promise((resolve) => {
          copy.onload = copy.onerror = resolve
        }),
        signal,
        6000,
      ).catch((error) => {
        if (error.name === "AbortError") throw error
      }),
    )
    doc.head.append(copy)
  }
  doc.head.append(mathematics)
  const styles = element(doc, "style")
  styles.textContent = exportStyles
  doc.head.append(styles)
  return Promise.all(ready)
}
function createDocument(article, includeSource, format, signal, warnings) {
  const source = article.body
  if (!source?.ownerDocument || !source.isConnected)
    throw new ArticleExportError("文章已离开当前页面，请重新打开文章后导出", "ARTICLE_CHANGED")
  const frame = document.createElement("iframe")
  frame.title = "文章导出排版"
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  Object.assign(frame.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${EXPORT_WIDTH}px`,
    height: "1800px",
    border: "0",
    pointerEvents: "none",
  })
  document.body.append(frame)
  const doc = frame.contentDocument
  doc.documentElement.setAttribute("saved-theme", "light")
  const root = element(doc, "main", "article-export-document")
  const title = element(doc, "h1", "article-export-title", article.title || "未命名文章")
  const body = source.cloneNode(true)
  body.className = "article-export-body"
  root.append(title, body)
  if (includeSource && article.sourceUrl) {
    const footer = element(doc, "p", "article-export-source")
    footer.append(doc.createTextNode("原文链接："), doc.createTextNode(article.sourceUrl))
    root.append(footer)
  }
  const ready = copyStyles(source.ownerDocument, doc, signal, article.siteBase)
  for (const code of body.querySelectorAll("code.mermaid, code.language-mermaid")) {
    if (code.parentElement.querySelector(".howard-diagram svg")) code.remove()
    else {
      code.hidden = false
      code.style.removeProperty("display")
      warnings.push("有图表尚未渲染，已在导出中保留图表源码")
    }
  }
  for (const embedded of body.querySelectorAll("iframe, object, embed, video, audio")) {
    embedded.replaceWith(
      element(doc, "div", "article-export-image-missing", "嵌入式音视频或外部页面：请在原文中查看"),
    )
    warnings.push("嵌入式音视频或外部页面无法放入静态文稿，已保留提示")
  }
  // Original reader controls, popover helpers and hidden Markdown source are
  // not article content. The complete rendered diagram is retained below.
  for (const node of body.querySelectorAll(
    "script, button, .clipboard-button, .anchor, a[role=anchor], .external-icon, .howard-diagram-toolbar, .howard-diagram-status, .katex-mathml, [data-export-ignore]",
  ))
    node.remove()
  for (const details of body.querySelectorAll("details")) details.open = true
  for (const callout of body.querySelectorAll(".is-collapsed"))
    callout.classList.remove("is-collapsed")
  for (const node of [body, ...body.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (attr.name.startsWith("on")) node.removeAttribute(attr.name)
    }
    node.removeAttribute("contenteditable")
    if (!node.closest("svg, .katex, .katex-display")) {
      for (const property of [
        "transform",
        "filter",
        "backdrop-filter",
        "position",
        "color",
        "background-color",
        "background",
        "max-height",
        "height",
        "width",
        "overflow",
      ])
        node.style.removeProperty(property)
    }
    const light = node.style.getPropertyValue("--shiki-light")
    if (light) node.style.setProperty("color", light, "important")
  }
  // Remove image URLs before adoption into the export document; preparation
  // later loads the original URLs with anonymous CORS checks.
  for (const image of body.querySelectorAll("img")) {
    image.removeAttribute("src")
    image.removeAttribute("srcset")
    image.removeAttribute("sizes")
  }
  doc.body.replaceChildren(root)
  // One image fits on one PDF page; this also avoids splitting a diagram.
  if (format === "pdf") {
    const cap = element(doc, "style")
    cap.textContent = `.article-export-body img { max-height: ${Math.floor(PAGE_HEIGHT - 96)}px !important; object-fit: contain !important; }`
    doc.head.append(cap)
  }
  return { frame, doc, root, body, ready }
}

function loadImage(source, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.referrerPolicy = "no-referrer"
    const timer = setTimeout(() => finish(new Error("图片加载超时")), 12000)
    const cancel = () => finish(abortError())
    function finish(error) {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      image.onload = image.onerror = null
      if (error) {
        image.src = ""
        reject(error)
      } else resolve(image)
    }
    image.onload = () => finish()
    image.onerror = () => finish(new Error("图片不允许跨域导出或暂时无法加载"))
    signal?.addEventListener("abort", cancel, { once: true })
    image.src = source
  })
}
function canvasBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new ArticleExportError("浏览器无法生成图片，请改为导出 Markdown")),
      type,
      quality,
    ),
  )
}
async function normalizedImage(source, doc, assets, signal, scale = 1.5) {
  const image = await loadImage(source, signal)
  check(signal)
  const width = image.naturalWidth,
    height = image.naturalHeight
  if (!width || !height || width * height > MAX_IMAGE_PIXELS)
    throw new Error("图片尺寸过大，无法安全导出")
  const factor = Math.min(1, (EXPORT_WIDTH * scale) / width, 4096 / height)
  const canvas = doc.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * factor))
  canvas.height = Math.max(1, Math.round(height * factor))
  try {
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器不支持图片处理")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { url: assets.add(await canvasBlob(canvas)), width, height }
  } finally {
    canvas.width = canvas.height = 1
    image.src = ""
  }
}
function imagePlaceholder(doc, image, warnings, description) {
  const alt = image.getAttribute("alt")?.trim()
  const label = alt ? `图片未能导出：${alt}` : "图片未能导出（原图无法加载或不允许跨域读取）"
  image.replaceWith(element(doc, "div", "article-export-image-missing", label))
  warnings.push(description || label)
}
async function prepareImages(source, body, doc, assets, signal, warnings, progress, imageScale) {
  const originals = [...source.querySelectorAll("img")]
  const clones = [...body.querySelectorAll("img")]
  let completed = 0
  // Do not let cloned remote images start a credentialed request. CORS-safe
  // loading below uses Image, which respects the site's existing img-src CSP.
  for (const image of clones) {
    image.removeAttribute("srcset")
    image.removeAttribute("sizes")
    image.removeAttribute("src")
    image.loading = "eager"
  }
  const entries = clones.map((image, index) => ({ image, original: originals[index] }))
  for (let offset = 0; offset < entries.length; offset += 3) {
    check(signal)
    await Promise.all(
      entries.slice(offset, offset + 3).map(async ({ image, original }) => {
        const sourceUrl = original?.currentSrc || original?.src
        try {
          if (!sourceUrl || !/^(?:https?:|blob:|data:image\/)/i.test(sourceUrl))
            throw new Error("图片地址不支持导出")
          const normalized = await normalizedImage(sourceUrl, doc, assets, signal, imageScale)
          check(signal)
          image.src = normalized.url
          image.width = Math.min(normalized.width, EXPORT_WIDTH - 96)
          image.removeAttribute("height")
          image.style.aspectRatio = `${normalized.width} / ${normalized.height}`
        } catch (error) {
          if (error.name === "AbortError") throw error
          imagePlaceholder(doc, image, warnings)
        } finally {
          completed++
          progress(`准备图片 ${completed}/${entries.length}`)
        }
      }),
    )
    await yieldTurn(signal)
  }
}
function lightDiagramColor(value) {
  const dark = mermaidConfiguration({ dark: true }).themeVariables
  const light = mermaidConfiguration({ dark: false }).themeVariables
  let result = value
  for (const [key, color] of Object.entries(dark)) {
    if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) continue
    const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
    result = result.replace(new RegExp(color, "ig"), light[key])
    result = result.replace(
      new RegExp(
        `rgba?\\(\\s*${rgb[0]}\\s*,?\\s*${rgb[1]}\\s*,?\\s*${rgb[2]}(?:\\s*,\\s*1)?\\s*\\)`,
        "ig",
      ),
      light[key],
    )
  }
  return result
}
function svgMarkup(original, clone, diagram) {
  const nodes = [clone, ...clone.querySelectorAll("*")]
  const originals = [original, ...original.querySelectorAll("*")]
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (
      ["script", "image", "foreignobject", "animate", "set"].includes(node.tagName.toLowerCase())
    ) {
      node.remove()
      continue
    }
    for (const attr of [...node.attributes]) {
      if (
        attr.name.startsWith("on") ||
        (["href", "xlink:href"].includes(attr.name) && !/^#[\w:.-]+$/.test(attr.value))
      )
        node.removeAttribute(attr.name)
      else if (
        [
          "style",
          "fill",
          "stroke",
          "filter",
          "clip-path",
          "mask",
          "marker-start",
          "marker-mid",
          "marker-end",
        ].includes(attr.name)
      ) {
        const value = safeDiagramCss(attr.value)
        if (value) node.setAttribute(attr.name, diagram ? lightDiagramColor(value) : value)
        else node.removeAttribute(attr.name)
      }
    }
    if (node.tagName.toLowerCase() === "style")
      node.textContent = diagram
        ? lightDiagramColor(safeDiagramCss(node.textContent))
        : safeDiagramCss(node.textContent)
    // CSS for KaTeX paths and site icons may live in the page rather than SVG.
    if (originals[index]?.isConnected && node.tagName.toLowerCase() !== "style") {
      const computed = original.ownerDocument.defaultView.getComputedStyle(originals[index])
      for (const property of [
        "color",
        "fill",
        "stroke",
        "stroke-width",
        "font-family",
        "font-size",
        "font-weight",
        "text-anchor",
        "dominant-baseline",
      ]) {
        const value = safeDiagramCss(computed.getPropertyValue(property))
        if (value) node.style.setProperty(property, diagram ? lightDiagramColor(value) : value)
      }
    }
  }
  const box = original.viewBox?.baseVal
  const bounds = original.getBoundingClientRect()
  const width =
    (diagram ? box?.width : bounds.width) ||
    bounds.width ||
    Number(original.getAttribute("width")) ||
    800
  const height =
    (diagram ? box?.height : bounds.height) ||
    bounds.height ||
    Number(original.getAttribute("height")) ||
    400
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.maxWidth = "none"
  clone.style.transform = "none"
  clone.style.background = diagram ? "#f8f9fb" : "transparent"
  return { markup: new XMLSerializer().serializeToString(clone), width, height }
}
async function prepareSvgs(source, body, doc, assets, signal, warnings, imageScale) {
  const originals = [...source.querySelectorAll("svg")]
  const clones = [...body.querySelectorAll("svg")]
  // The cloned article has had toolbars/icons removed, so align by retained SVG
  // IDs first; DOM order remains a fallback for inline KaTeX SVG without IDs.
  let next = 0
  for (const clone of clones) {
    check(signal)
    const id = clone.id
    const original =
      (id && originals.find((svg) => svg.id === id)) ||
      originals.slice(next).find((svg) => svg.outerHTML === clone.outerHTML) ||
      originals[next]
    if (!original) continue
    next = originals.indexOf(original) + 1
    const diagram = !!clone.closest(
      ".howard-diagram, .mermaid-reader-frame, .private-mermaid, .mermaid-viewer-preview",
    )
    const wrapper = diagram ? clone.closest(".howard-diagram") || clone : clone
    try {
      const { markup, width, height } = svgMarkup(original, clone.cloneNode(true), diagram)
      const rawUrl = assets.add(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }))
      const normalized = await normalizedImage(rawUrl, doc, assets, signal, imageScale)
      check(signal)
      const image = element(doc, "img", diagram ? "" : "article-export-svg")
      image.src = normalized.url
      image.alt = diagram ? "Mermaid 图表" : "公式图形"
      image.width = Math.min(width, EXPORT_WIDTH - 96)
      image.style.aspectRatio = `${width} / ${height}`
      if (!diagram && original.closest(".katex")) {
        const computed = original.ownerDocument.defaultView.getComputedStyle(original)
        image.style.position = computed.position
        image.style.left = computed.left
        image.style.top = computed.top
        image.style.width = `${width}px`
        image.style.height = `${height}px`
      }
      if (diagram) {
        const panel = element(doc, "div", "article-export-diagram")
        panel.append(image)
        wrapper.replaceWith(panel)
      } else clone.replaceWith(image)
    } catch (error) {
      if (error.name === "AbortError") throw error
      imagePlaceholder(
        doc,
        wrapper,
        warnings,
        diagram ? "有一张图表未能导出" : "有一个公式图形未能导出",
      )
    }
    await yieldTurn(signal)
  }
}
async function measureIntervals(root, signal) {
  const doc = root.ownerDocument
  const top = root.getBoundingClientRect().top
  const intervals = []
  const walker = doc.createTreeWalker(root, 4)
  let node,
    count = 0
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim() || node.parentElement.closest("style, script")) continue
    const range = doc.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects())
      if (rect.width > 0 && rect.height > 0) intervals.push([rect.top - top, rect.bottom - top])
    range.detach()
    if (++count % 500 === 0) await yieldTurn(signal)
  }
  for (const node of root.querySelectorAll("img, tr, .article-export-diagram")) {
    const rect = node.getBoundingClientRect()
    if (rect.height <= PAGE_HEIGHT * 0.95) intervals.push([rect.top - top, rect.bottom - top])
  }
  return intervals
}
async function capture(html2canvas, root, [start, end], scale, signal, textNodesToHide = []) {
  check(signal)
  const canvas = await html2canvas(root, {
    backgroundColor: "#ffffff",
    scale,
    width: EXPORT_WIDTH,
    height: Math.ceil(end - start),
    x: 0,
    y: start,
    windowWidth: EXPORT_WIDTH,
    windowHeight: 1800,
    scrollX: 0,
    scrollY: 0,
    logging: false,
    useCORS: true,
    allowTaint: false,
    imageTimeout: 8000,
    removeContainer: true,
    onclone: (doc, clone) => {
      const hidden = new Set(textNodesToHide)
      const scope = clone || doc
      for (const span of scope.querySelectorAll("[data-export-text-id]")) {
        if (hidden.has(span.dataset.exportTextId))
          span.style.setProperty("opacity", "0", "important")
      }
    },
  })
  if (signal?.aborted) {
    canvas.width = canvas.height = 1
    throw abortError()
  }
  return canvas
}

/**
 * Render a connected article in an isolated, temporary reading document.
 * Everything stays in browser memory; no network upload or persistent cache.
 * Progress is a short Chinese string suitable for the site's task indicator.
 */
export async function exportArticle({
  article,
  format,
  includeSource = false,
  signal,
  onProgress = () => {},
  mobile = false,
  quality = "high",
} = {}) {
  if (!["pdf", "png"].includes(format))
    throw new ArticleExportError("不支持的导出格式", "INVALID_FORMAT")
  check(signal)
  if (includeSource && article.sourceUrl) sourceLink(article.sourceUrl)
  onProgress("准备导出排版")
  const assets = resources()
  let layout
  const cleanup = () => {
    layout?.frame.remove()
    assets.clear()
  }
  signal?.addEventListener("abort", cleanup, { once: true })
  const warnings = []
  try {
    layout = createDocument(article, includeSource, format, signal, warnings)
    const [{ default: html2canvas }, pdfModule] = await Promise.all([
      import("html2canvas"),
      format === "pdf" ? import("./article-export-pdf.mjs") : null,
      layout.ready,
    ])
    check(signal)
    const imageScale = format === "png" ? (quality === "standard" ? 2 : mobile ? 2.5 : 3) : 3
    await prepareImages(
      article.body,
      layout.body,
      layout.doc,
      assets,
      signal,
      warnings,
      onProgress,
      imageScale,
    )
    await prepareSvgs(article.body, layout.body, layout.doc, assets, signal, warnings, imageScale)
    await wait(layout.doc.fonts.ready, signal, 6000).catch((error) => {
      if (error.name === "AbortError") throw error
      warnings.push("部分字体未能加载，已使用系统字体")
    })
    await Promise.all(
      [...layout.body.querySelectorAll("img")].map((image) =>
        wait(image.decode(), signal, 8000).catch((error) => {
          if (error.name === "AbortError") throw error
          imagePlaceholder(layout.doc, image, warnings)
        }),
      ),
    )
    check(signal)
    // Display formulas do not wrap. Scale an unusually wide equation instead
    // of silently cropping the rightmost terms at the reading edge.
    for (const formula of layout.body.querySelectorAll(".katex-display > .katex")) {
      const width = Math.max(formula.scrollWidth, formula.getBoundingClientRect().width)
      const available = layout.body.clientWidth
      if (width > available) {
        const fontSize = parseFloat(layout.doc.defaultView.getComputedStyle(formula).fontSize)
        formula.style.setProperty("font-size", `${(fontSize * available) / width}px`, "important")
      }
    }
    await yieldTurn(signal)
    const height = Math.ceil(layout.root.getBoundingClientRect().height)
    let blob, dimensions
    if (format === "png") {
      const plan = imageCapturePlan(height, { mobile, quality })
      onProgress(`生成长图（${plan.width} × ${plan.height}）`)
      const canvas = await capture(html2canvas, layout.root, [0, height], plan.scale, signal)
      try {
        dimensions = { width: canvas.width, height: canvas.height }
        blob = await wait(canvasBlob(canvas), signal, 30000)
      } finally {
        canvas.width = canvas.height = 1
      }
    } else {
      const pages = pageSlices(height, await measureIntervals(layout.root, signal))
      const login = article.body.ownerDocument.querySelector("[data-maintenance-login]")
      const siteBase =
        article.siteBase ||
        (login
          ? new URL("../", login.href).href
          : new URL("./", article.body.ownerDocument.baseURI).href)
      const result = await pdfModule.renderSelectablePDF({
        root: layout.root,
        pages,
        title: article.title,
        sourceUrl: article.sourceUrl,
        includeSource,
        signal,
        onProgress,
        mobile,
        fontBaseUrl: new URL("maintenance-assets/article-pdf-fonts/", siteBase).href,
        capturePage: (slice, scale, hidden) =>
          capture(html2canvas, layout.root, slice, scale, signal, hidden),
      })
      blob = result.blob
      warnings.push(...result.warnings)
    }
    check(signal)
    return {
      blob,
      mime: format === "pdf" ? "application/pdf" : "image/png",
      extension: format,
      warnings: [...new Set(warnings)],
      ...(dimensions ? { dimensions } : {}),
    }
  } finally {
    signal?.removeEventListener("abort", cleanup)
    cleanup()
  }
}
