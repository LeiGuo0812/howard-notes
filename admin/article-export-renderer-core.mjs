export const EXPORT_WIDTH = 900
export const MAX_PDF_PAGES = 80
export const PDF_MARGIN = 12
export const PDF_WIDTH = 210 - PDF_MARGIN * 2
export const PDF_HEIGHT = 297 - PDF_MARGIN * 2
export const PAGE_HEIGHT = (PDF_HEIGHT / PDF_WIDTH) * EXPORT_WIDTH
const MIN_IMAGE_SCALE = 0.85

export class ArticleExportError extends Error {
  constructor(message, code = "EXPORT_FAILED") {
    super(message)
    this.name = "ArticleExportError"
    this.code = code
  }
}
// A single PNG must fit in one browser canvas. PDF captures one page at a time.
export function imageCaptureScale(height, { mobile = false, preferredScale = 1.5 } = {}) {
  if (!Number.isFinite(height) || height < 1)
    throw new ArticleExportError("文章没有可导出的内容", "EMPTY_ARTICLE")
  const pixelBudget = mobile ? 12_000_000 : 24_000_000
  const sideLimit = mobile ? 16384 : 32760
  const scale = Math.min(
    preferredScale,
    Math.sqrt(pixelBudget / (EXPORT_WIDTH * height)),
    sideLimit / height,
  )
  if (scale < MIN_IMAGE_SCALE)
    throw new ArticleExportError(
      "文章太长，长图会超过浏览器安全限制，请改为导出 PDF",
      "IMAGE_TOO_LONG",
    )
  return Math.floor(scale * 100) / 100
}

// `intervals` describe visible text lines, table rows and image bounds. Never
// cut through one unless it is itself taller than a complete page.
export function pageSlices(height, intervals = [], pageHeight = PAGE_HEIGHT) {
  if (!Number.isFinite(height) || height < 1) return []
  const spans = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .map(([start, end]) => [Math.max(0, start - 1), Math.min(height, end + 1)])
    .sort((a, b) => a[0] - b[0])
  const pages = []
  let start = 0
  while (start < height - 0.5) {
    let end = Math.min(height, start + pageHeight)
    if (end < height) {
      // Moving backward can enter the previous line/row, so repeat until safe.
      let changed = true
      while (changed) {
        changed = false
        for (const [top, bottom] of spans) {
          if (top < end && bottom > end && top > start + pageHeight * 0.42) {
            end = top
            changed = true
            break
          }
        }
      }
    }
    end = Math.max(start + 1, end)
    pages.push([start, end])
    if (pages.length > MAX_PDF_PAGES)
      throw new ArticleExportError(
        `文章超过 ${MAX_PDF_PAGES} 页，请分段导出或选择 Markdown`,
        "PDF_TOO_LONG",
      )
    start = end
  }
  return pages
}
