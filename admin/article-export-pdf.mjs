import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFString,
  beginText,
  endText,
  pushGraphicsState,
  popGraphicsState,
  setFontAndSize,
  setFillingRgbColor,
  setTextMatrix,
  setGraphicsState,
  showText,
} from "pdf-lib"
import { pdfFontkit } from "./article-export-pdf-fontkit.mjs"
import { ArticleExportError } from "./article-export-renderer-core.mjs"
import {
  PDF_POINT_PER_CSS_PIXEL,
  PDF_MARGIN_POINTS,
  PDF_PAGE_POINTS,
  graphemes,
  supportedTextChunks,
  pdfColor,
  textPageIndex,
  glyphTransform,
} from "./article-export-pdf-core.mjs"

const FONT_FILES = Object.freeze({ regular: "NotoSansSC-Regular.otf", bold: "NotoSansSC-Bold.otf" })
const fontBytesCache = new Map()
const TEXT_ATTRIBUTE = "data-export-text-id"
const NON_TEXT =
  "svg, .katex, .katex-display, script, style, noscript, [hidden], [data-export-ignore]"

function check(signal) {
  if (signal?.aborted) throw new DOMException("已取消导出", "AbortError")
}
function yieldTurn(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      if (signal?.aborted) reject(new DOMException("已取消导出", "AbortError"))
      else resolve()
    }, 0)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      reject(new DOMException("已取消导出", "AbortError"))
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}
function waitFor(promise, signal) {
  check(signal)
  return new Promise((resolve, reject) => {
    const cancel = () => finish(new DOMException("已取消导出", "AbortError"))
    function finish(error, value) {
      signal?.removeEventListener("abort", cancel)
      if (error) reject(error)
      else resolve(value)
    }
    signal?.addEventListener("abort", cancel, { once: true })
    Promise.resolve(promise).then((value) => finish(null, value), finish)
  })
}
async function fontBytes(base, weight, signal) {
  const url = new URL(FONT_FILES[weight], base)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== window.location.origin ||
    url.username ||
    url.password
  )
    throw new ArticleExportError("PDF 字体地址无效，请刷新后重试", "PDF_FONT_FAILED")
  if (!fontBytesCache.has(url.href)) {
    // These are public static assets, not article content. Their bytes can be
    // reused across local exports; only one public font request is in flight.
    const pending = fetch(url.href, {
      credentials: "omit",
      redirect: "error",
      cache: "force-cache",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(30000),
    }).then(async (response) => {
      if (!response.ok) throw new Error("字体未能加载")
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length < 1000 || bytes.length > 24_000_000) throw new Error("字体资源无效")
      return bytes
    })
    pending.catch(() => fontBytesCache.delete(url.href))
    fontBytesCache.set(url.href, pending)
  }
  try {
    return await waitFor(fontBytesCache.get(url.href), signal)
  } catch (error) {
    if (error.name === "AbortError") throw error
    throw new ArticleExportError("PDF 字体未能加载，请检查网络后重试", "PDF_FONT_FAILED")
  }
}

function visibleStyle(span, view) {
  const style = view.getComputedStyle(span)
  if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0)
    return null
  const fontSize = Number.parseFloat(style.fontSize)
  if (!(fontSize > 0)) return null
  return {
    fontSize,
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    fontWeight: Number.parseFloat(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400),
    color: pdfColor(style.color),
    direction: style.direction,
  }
}
function baselineMetrics(style, context, cache) {
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
  if (!cache.has(font)) {
    context.font = font
    const metrics = context.measureText("Hg中")
    const ascent =
      metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || style.fontSize * 0.85
    const descent =
      metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? style.fontSize * 0.2
    cache.set(font, { ascent, descent })
  }
  return cache.get(font)
}

/**
 * Wrap only the export iframe's ordinary text, leaving CSS layout unchanged.
 * A fragment with unsupported glyphs remains in the background snapshot.
 * Returned IDs are the only nodes the screenshot callback may hide.
 */
export async function collectTextRuns(root, signal, { supportsText = () => true } = {}) {
  check(signal)
  const doc = root.ownerDocument
  const view = doc.defaultView
  const walker = doc.createTreeWalker(root, 4)
  const nodes = []
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.parentElement || node.parentElement.closest(NON_TEXT)) continue
    nodes.push(node)
  }
  const context = doc.createElement("canvas").getContext("2d")
  const metricsCache = new Map()
  const hiddenIds = []
  const runs = []
  const warnings = []
  let serial = 0
  for (let index = 0; index < nodes.length; index++) {
    check(signal)
    const node = nodes[index]
    const fragment = doc.createDocumentFragment()
    const candidates = []
    for (const chunk of supportedTextChunks(node.textContent, supportsText)) {
      if (!chunk.supported) {
        fragment.append(doc.createTextNode(chunk.text))
        if (chunk.text.trim()) warnings.push("部分特殊字符以图形保留，正文文本可选择")
        continue
      }
      const span = doc.createElement("span")
      span.setAttribute(TEXT_ATTRIBUTE, `pdf-text-${serial++}`)
      // No class, inline font or display override: inherit the original style.
      span.textContent = chunk.text
      fragment.append(span)
      candidates.push(span)
    }
    node.replaceWith(fragment)
    const origin = root.getBoundingClientRect()
    for (const span of candidates) {
      const style = visibleStyle(span, view)
      if (!style) continue
      // Bidirectional and vertical layout needs shaping beyond simple PDF
      // placement. Preserve its visual rather than corrupting its text.
      if (
        style.direction === "rtl" ||
        view.getComputedStyle(span).writingMode !== "horizontal-tb"
      ) {
        warnings.push("部分竖排或从右到左的文本以图形保留")
        continue
      }
      const text = span.firstChild
      const range = doc.createRange()
      const { ascent, descent } = baselineMetrics(style, context, metricsCache)
      let visible = false
      let units = 0
      for (const unit of graphemes(text.textContent)) {
        if (++units % 256 === 0) await yieldTurn(signal)
        range.setStart(text, unit.start)
        range.setEnd(text, unit.end)
        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width > 0 && rect.height > 0,
        )
        if (!rects.length) continue
        const rect = rects[0]
        if (/^[\r\n]+$/.test(unit.text)) continue
        // A collapsed line-break space can report the next line's zero-width
        // rectangle. It contributes no glyph and must not duplicate text.
        if (rect.width < 0.02) continue
        const baseline = rect.top - origin.top + (rect.height * ascent) / (ascent + descent)
        runs.push({
          text: unit.text,
          id: span.getAttribute(TEXT_ATTRIBUTE),
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          bottom: rect.bottom - origin.top,
          width: rect.width,
          baseline,
          ...style,
        })
        visible = true
      }
      range.detach()
      if (visible) hiddenIds.push(span.getAttribute(TEXT_ATTRIBUTE))
    }
    if (index % 24 === 0) await yieldTurn(signal)
  }
  return { runs, textNodesToHide: hiddenIds, warnings: [...new Set(warnings)] }
}

function pageLink(pdf, page, rect, url, { mailto = false } = {}) {
  let target
  try {
    target = new URL(url)
  } catch {
    return
  }
  const schemes = mailto ? ["http:", "https:", "mailto:"] : ["http:", "https:"]
  if (
    !schemes.includes(target.protocol) ||
    target.username ||
    target.password ||
    /[\u0000-\u001f\u007f]/.test(url)
  )
    return
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(target.href) },
    }),
  )
  const current = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
  if (current) current.push(annotation)
  else page.node.set(PDFName.of("Annots"), pdf.context.obj([annotation]))
}

/**
 * Create an actual text PDF using the browser's CSS geometry. Only article
 * backgrounds and images are rasterized; text is drawn visibly with embedded
 * Unicode fonts. No private document, HTML or screenshot leaves this browser.
 */
export async function renderSelectablePDF({
  root,
  pages,
  title,
  sourceUrl,
  includeSource = false,
  signal,
  onProgress = () => {},
  mobile = false,
  fontBaseUrl,
  capturePage,
}) {
  check(signal)
  onProgress("加载 PDF 中文字体")
  const [regularBytes, boldBytes] = await Promise.all([
    fontBytes(fontBaseUrl, "regular", signal),
    fontBytes(fontBaseUrl, "bold", signal),
  ])
  check(signal)
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(pdfFontkit)
  pdf.setTitle(title || "未命名文章")
  pdf.setCreator("Howard Notes")
  pdf.setSubject("保留排版的可选择文本文章导出")
  pdf.setLanguage("zh-CN")
  const [regular, bold] = await Promise.all([
    pdf.embedFont(regularBytes, { subset: true, customName: "HWREGU+NotoSansSC-Regular" }),
    pdf.embedFont(boldBytes, { subset: true, customName: "HWBOLD+NotoSansSC-Bold" }),
  ])
  check(signal)
  const supported = new Set(regular.getCharacterSet())
  const supportedBold = new Set(bold.getCharacterSet())
  const supportsText = (text) =>
    Array.from(text).every((character) => {
      const value = character.codePointAt(0)
      return /[\t\r\n]/.test(character) || (supported.has(value) && supportedBold.has(value))
    })
  onProgress("准备可选择文字与分页")
  const prepared = await collectTextRuns(root, signal, { supportsText })
  const pageRuns = pages.map(() => [])
  for (const run of prepared.runs) {
    const index = textPageIndex(run, pages)
    if (index >= 0) pageRuns[index].push(run)
  }
  const rootRect = root.getBoundingClientRect()
  const footerRect = root.querySelector(".article-export-source")?.getBoundingClientRect()
  const links = [...root.querySelectorAll("a[href]")].flatMap((link) => {
    if (link.closest(NON_TEXT)) return []
    let url
    try {
      // The export iframe deliberately has no <base> (the site's CSP forbids
      // one). Resolve preserved relative article links against its reader URL.
      url = new URL(link.getAttribute("href"), sourceUrl || root.ownerDocument.baseURI).href
    } catch {
      return []
    }
    return [...link.getClientRects()].map((rect) => ({
      url,
      left: rect.left - rootRect.left,
      right: rect.right - rootRect.left,
      top: rect.top - rootRect.top,
      bottom: rect.bottom - rootRect.top,
    }))
  })
  for (let index = 0; index < pages.length; index++) {
    check(signal)
    onProgress(`生成可选择文本 PDF ${index + 1}/${pages.length}`)
    const slice = pages[index]
    const canvas = await capturePage(slice, mobile ? 1.5 : 2, prepared.textNodesToHide)
    try {
      check(signal)
      const imageBytes = await waitFor(
        new Promise((resolve, reject) =>
          canvas.toBlob(async (blob) => {
            if (!blob) return reject(new Error("无法生成 PDF 背景"))
            try {
              resolve(new Uint8Array(await blob.arrayBuffer()))
            } catch (error) {
              reject(error)
            }
          }, "image/png"),
        ),
        signal,
      )
      const image = await pdf.embedPng(imageBytes)
      check(signal)
      const page = pdf.addPage(PDF_PAGE_POINTS)
      const fontKeys = {
        regular: page.node.newFontDictionary(regular.name, regular.ref),
        bold: page.node.newFontDictionary(bold.name, bold.ref),
      }
      const opacityKeys = new Map()
      const imageHeight = (slice[1] - slice[0]) * PDF_POINT_PER_CSS_PIXEL
      page.drawImage(image, {
        x: PDF_MARGIN_POINTS,
        y: PDF_PAGE_POINTS[1] - PDF_MARGIN_POINTS - imageHeight,
        width: 900 * PDF_POINT_PER_CSS_PIXEL,
        height: imageHeight,
      })
      for (let offset = 0; offset < pageRuns[index].length; offset++) {
        const run = pageRuns[index][offset]
        const weight = run.fontWeight >= 600 ? "bold" : "regular"
        const font = weight === "bold" ? bold : regular
        // Whitespace placement remains reflected in the following glyph's
        // position. A literal space helps copy/paste preserve English/code.
        const encoded = font.encodeText(run.text.replace(/[\t\r\n]/g, " "))
        const size = run.fontSize * PDF_POINT_PER_CSS_PIXEL
        const naturalWidth = font.widthOfTextAtSize(run.text.replace(/[\t\r\n]/g, " "), size)
        const transform = glyphTransform(run, naturalWidth, slice[0])
        const key = fontKeys[weight]
        const opacity = run.color.opacity
        if (!opacityKeys.has(opacity)) {
          const state = pdf.context.register(pdf.context.obj({ Type: "ExtGState", ca: opacity }))
          opacityKeys.set(opacity, page.node.newExtGState("TextOpacity", state))
        }
        page.pushOperators(
          pushGraphicsState(),
          setGraphicsState(opacityKeys.get(opacity)),
          setFillingRgbColor(run.color.red, run.color.green, run.color.blue),
          beginText(),
          setFontAndSize(key, size),
          setTextMatrix(transform.horizontal, 0, transform.italic, 1, transform.x, transform.y),
          showText(encoded),
          endText(),
          popGraphicsState(),
        )
        if (offset % 320 === 0) await yieldTurn(signal)
      }
      if (includeSource && sourceUrl && footerRect) {
        const top = Math.max(slice[0], footerRect.top - rootRect.top)
        const bottom = Math.min(slice[1], footerRect.bottom - rootRect.top)
        if (bottom > top) {
          const x = PDF_MARGIN_POINTS + (footerRect.left - rootRect.left) * PDF_POINT_PER_CSS_PIXEL
          const y =
            PDF_PAGE_POINTS[1] - PDF_MARGIN_POINTS - (bottom - slice[0]) * PDF_POINT_PER_CSS_PIXEL
          pageLink(
            pdf,
            page,
            [
              x,
              y,
              x + footerRect.width * PDF_POINT_PER_CSS_PIXEL,
              y + (bottom - top) * PDF_POINT_PER_CSS_PIXEL,
            ],
            sourceUrl,
          )
        }
      }
      for (const link of links) {
        const top = Math.max(slice[0], link.top)
        const bottom = Math.min(slice[1], link.bottom)
        if (bottom <= top) continue
        const x = PDF_MARGIN_POINTS + link.left * PDF_POINT_PER_CSS_PIXEL
        const y =
          PDF_PAGE_POINTS[1] - PDF_MARGIN_POINTS - (bottom - slice[0]) * PDF_POINT_PER_CSS_PIXEL
        pageLink(
          pdf,
          page,
          [
            x,
            y,
            PDF_MARGIN_POINTS + link.right * PDF_POINT_PER_CSS_PIXEL,
            y + (bottom - top) * PDF_POINT_PER_CSS_PIXEL,
          ],
          link.url,
          { mailto: true },
        )
      }
    } finally {
      canvas.width = canvas.height = 1
    }
    await yieldTurn(signal)
  }
  check(signal)
  onProgress("整理 PDF 字体与文件")
  const bytes = await pdf.save({ useObjectStreams: true })
  check(signal)
  return { blob: new Blob([bytes], { type: "application/pdf" }), warnings: prepared.warnings }
}
