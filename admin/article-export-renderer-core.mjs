export const EXPORT_WIDTH = 900
export const MAX_PDF_PAGES = 80
export const PDF_MARGIN = 12
export const PDF_WIDTH = 210 - PDF_MARGIN * 2
export const PDF_HEIGHT = 297 - PDF_MARGIN * 2
export const PAGE_HEIGHT = (PDF_HEIGHT / PDF_WIDTH) * EXPORT_WIDTH
export const MIN_IMAGE_SCALE = 1.5
export const IMAGE_PIXEL_BUDGET = Object.freeze({ desktop: 48_000_000, mobile: 16_000_000 })
export const IMAGE_SIDE_LIMIT = Object.freeze({ desktop: 32760, mobile: 16384 })
export const EXPORT_IMAGE_BYTE_LIMIT = 10 * 1024 * 1024

export class ArticleExportError extends Error {
  constructor(message, code = "EXPORT_FAILED") {
    super(message)
    this.name = "ArticleExportError"
    this.code = code
  }
}

// The server resolves an image from the current public article, never from a
// URL supplied to an open proxy. Keep the same narrow source allowlist here so
// private blobs/data, arbitrary remote hosts and credential-bearing URLs never
// enter the public fallback path. A normal CORS image remains the first choice.
export function publicImageExportPlan(article, index, source, { pageUrl, trustedApiBase } = {}) {
  if (
    article?.private !== false ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.id || "") ||
    String(article.id).length > 120 ||
    (article.revision != null &&
      article.revision !== "" &&
      (!/^\d+$/.test(String(article.revision)) ||
        !Number.isSafeInteger(Number(article.revision)) ||
        Number(article.revision) < 1)) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= 10000 ||
    typeof source !== "string" ||
    source.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(source)
  )
    return null
  try {
    const image = new URL(source)
    image.hash = ""
    const allowed =
      (image.hostname === "picture-of-howard.oss-cn-shanghai.aliyuncs.com" &&
        image.pathname.startsWith("/img/") &&
        image.pathname !== "/img/") ||
      (image.hostname === "cdn.nlark.com" &&
        image.pathname.startsWith("/yuque/") &&
        image.pathname !== "/yuque/")
    if (
      image.protocol !== "https:" ||
      !allowed ||
      image.port ||
      image.username ||
      image.password ||
      image.search ||
      image.hash
    )
      return null
    const page = new URL(pageUrl)
    const base = new URL(article.siteBase)
    if (
      !/^https?:$/.test(base.protocol) ||
      base.origin !== page.origin ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.pathname.endsWith("/")
    )
      return null
    const apis = [new URL("api/content/", base)]
    // This optional address must come from the bundled, trusted runtime
    // configuration. Do not pass an article field, URL query or fetched
    // third-party value as trustedApiBase.
    if (trustedApiBase) {
      const trusted = new URL(trustedApiBase)
      if (
        trusted.protocol === "https:" &&
        !trusted.username &&
        !trusted.password &&
        !trusted.search &&
        !trusted.hash &&
        trusted.pathname.replace(/\/$/, "").endsWith("/api/content")
      ) {
        trusted.pathname = `${trusted.pathname.replace(/\/$/, "")}/`
        if (trusted.href !== apis[0].href) apis.push(trusted)
      }
    }
    const urls = apis.map((api) => {
      const url = new URL(`export-image/${article.id}/${index}`, api)
      if (article.revision != null && article.revision !== "")
        url.searchParams.set("revision", String(article.revision))
      return url.href
    })
    return { source: image.href, urls }
  } catch {
    return null
  }
}

export async function exportImageSourceDigest(source) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Validate the public image response before creating a local object URL. A
// mislabeled HTML error/login page must never become an export image.
export function exportImageMime(bytes, declaredType) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > EXPORT_IMAGE_BYTE_LIMIT)
    throw new ArticleExportError("图片文件为空或超过 10 MiB，无法安全导出", "IMAGE_INVALID")
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end))
  let mime
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  )
    mime = "image/png"
  else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    mime = "image/jpeg"
  else if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) mime = "image/gif"
  else if (bytes.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    mime = "image/webp"
  else if (
    bytes.length >= 16 &&
    ascii(4, 8) === "ftyp" &&
    ["avif", "avis"].some((brand) => ascii(8, Math.min(64, bytes.length)).includes(brand))
  )
    mime = "image/avif"
  const declared = String(declaredType || "")
    .split(";")[0]
    .trim()
    .toLowerCase()
  if (!mime || declared !== mime)
    throw new ArticleExportError("图片返回格式不正确，已阻止非图片内容", "IMAGE_INVALID")
  return mime
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

// Include visible overflow in the final capture height. A layout box alone can
// be shorter than the last code/formula line; keep the reading bottom padding
// after that content as well. Values are relative to the export root.
export function finalDocumentHeight({
  boxHeight = 0,
  scrollHeight = 0,
  contentBottom = 0,
  paddingBottom = 0,
} = {}) {
  const finite = (value) => (Number.isFinite(value) && value > 0 ? value : 0)
  return Math.ceil(
    Math.max(
      finite(boxHeight),
      finite(scrollHeight),
      finite(contentBottom) + finite(paddingBottom),
    ),
  )
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
  while (start < height) {
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
    end = Math.min(height, Math.max(start + 1, end))
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
