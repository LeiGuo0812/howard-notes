// Pure helpers for the local, selectable-text PDF exporter.
export const PDF_POINT_PER_CSS_PIXEL = ((210 - 24) * 72) / (25.4 * 900)
export const PDF_MARGIN_POINTS = (12 * 72) / 25.4
export const PDF_PAGE_POINTS = Object.freeze([595.2755905512, 841.8897637795])

export function graphemes(text) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].map(
      ({ segment, index }) => ({ text: segment, start: index, end: index + segment.length }),
    )
  }
  let offset = 0
  return Array.from(text, (text) => {
    const start = offset
    offset += text.length
    return { text, start, end: offset }
  })
}

export function supportedTextChunks(text, supports) {
  const chunks = []
  for (const unit of graphemes(text)) {
    const supported = supports(unit.text)
    const previous = chunks.at(-1)
    if (previous && previous.supported === supported) previous.text += unit.text
    else chunks.push({ text: unit.text, supported })
  }
  return chunks
}

export function pdfColor(value) {
  const match = String(value).match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
  )
  if (!match) return { red: 32 / 255, green: 42 / 255, blue: 53 / 255, opacity: 1 }
  return {
    red: Math.min(1, Math.max(0, Number(match[1]) / 255)),
    green: Math.min(1, Math.max(0, Number(match[2]) / 255)),
    blue: Math.min(1, Math.max(0, Number(match[3]) / 255)),
    opacity: match[4] == null ? 1 : Math.min(1, Math.max(0, Number(match[4]))),
  }
}

export function textPageIndex(run, pages) {
  // Pagination protects ordinary lines. Using the baseline assigns an
  // oversized atomic line once instead of duplicating text on two pages.
  const position = run.baseline ?? (run.top + run.bottom) / 2
  const index = pages.findIndex(([start, end]) => position >= start && position < end)
  return index < 0 && pages.length && position === pages.at(-1)[1] ? pages.length - 1 : index
}

export function pdfFontRole(text, { code = false, weight = 400, monospaceCharacters } = {}) {
  if (weight >= 600) return "bold"
  if (
    code &&
    Array.from(text).every((character) => {
      const point = character.codePointAt(0)
      return point >= 0x20 && point <= 0x7e && monospaceCharacters?.has(point)
    })
  )
    return "mono"
  return "regular"
}

export function glyphTransform(run, naturalWidth, pageStart = 0) {
  const scale = PDF_POINT_PER_CSS_PIXEL
  const size = run.fontSize * scale
  return {
    size,
    x: PDF_MARGIN_POINTS + run.left * scale,
    y: PDF_PAGE_POINTS[1] - PDF_MARGIN_POINTS - (run.baseline - pageStart) * scale,
    // FontFace and the PDF now use the same font at the same CSS size. Never
    // stretch proportional glyphs into measured monospace cells: that changes
    // stem thickness and can make adjacent i/m characters look inconsistent.
    horizontal: 1,
    italic: /italic|oblique/.test(run.fontStyle || "") ? 0.18 : 0,
  }
}
