export const EXPORT_WIDTH = 900
export const MAX_PDF_PAGES = 80
export const PDF_MARGIN = 12
export const PDF_WIDTH = 210 - PDF_MARGIN * 2
export const PDF_HEIGHT = 297 - PDF_MARGIN * 2
export const PAGE_HEIGHT = (PDF_HEIGHT / PDF_WIDTH) * EXPORT_WIDTH
export const MIN_IMAGE_SCALE = 1.5
export const IMAGE_PIXEL_BUDGET = Object.freeze({ desktop: 48_000_000, mobile: 16_000_000 })
export const IMAGE_SIDE_LIMIT = Object.freeze({ desktop: 32760, mobile: 16384 })

export class ArticleExportError extends Error {
  constructor(message, code = "EXPORT_FAILED") {
    super(message)
    this.name = "ArticleExportError"
    this.code = code
  }
}
// One RGBA canvas can consume 192 MB on desktop / 64 MB on mobile before
// encoding. Keep a quality floor: a huge, blurry image is not a useful export.
// These are conservative application budgets, not claimed browser limits.
export function imageCapturePlan(
  height,
  { mobile = false, quality = "high", preferredScale } = {},
) {
  if (!Number.isFinite(height) || height < 1)
    throw new ArticleExportError("文章没有可导出的内容", "EMPTY_ARTICLE")
  if (!["standard", "high"].includes(quality))
    throw new ArticleExportError("请选择有效的长图清晰度", "INVALID_IMAGE_QUALITY")
  const requestedScale = preferredScale ?? (quality === "standard" ? 2 : mobile ? 2.5 : 3)
  if (!Number.isFinite(requestedScale) || requestedScale < MIN_IMAGE_SCALE)
    throw new ArticleExportError("长图清晰度不能低于 1.5 倍", "INVALID_IMAGE_QUALITY")
  const pixelBudget = mobile ? IMAGE_PIXEL_BUDGET.mobile : IMAGE_PIXEL_BUDGET.desktop
  const sideLimit = mobile ? IMAGE_SIDE_LIMIT.mobile : IMAGE_SIDE_LIMIT.desktop
  let scale =
    Math.floor(
      Math.min(
        requestedScale,
        Math.sqrt(pixelBudget / (EXPORT_WIDTH * height)),
        sideLimit / height,
        sideLimit / EXPORT_WIDTH,
      ) * 100,
    ) / 100
  // Round actual bitmap dimensions upward when checking the budget. Fractional
  // CSS heights must not allocate a canvas just above the promised memory cap.
  while (
    scale >= MIN_IMAGE_SCALE &&
    (Math.ceil(EXPORT_WIDTH * scale) * Math.ceil(height * scale) > pixelBudget ||
      Math.ceil(height * scale) > sideLimit ||
      Math.ceil(EXPORT_WIDTH * scale) > sideLimit)
  )
    scale = Math.round((scale - 0.01) * 100) / 100
  if (scale < MIN_IMAGE_SCALE)
    throw new ArticleExportError(
      "文章太长，无法在安全范围内生成清晰长图，请改为导出 PDF",
      "IMAGE_TOO_LONG",
    )
  return {
    scale,
    width: Math.ceil(EXPORT_WIDTH * scale),
    height: Math.ceil(height * scale),
    requestedScale,
    reduced: scale < requestedScale,
    pixelBudget,
    sideLimit,
  }
}

// Keep the original scalar interface for renderers using html2canvas.
export function imageCaptureScale(height, options) {
  return imageCapturePlan(height, options).scale
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
