import { fromHtml } from "hast-util-from-html"

export const MAX_EXPORT_IMAGE_BYTES = 10 * 1024 * 1024
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const hosts = new Map([
  ["picture-of-howard.oss-cn-shanghai.aliyuncs.com", "/img/"],
  ["cdn.nlark.com", "/yuque/"],
])
const failure = (message, status) =>
  Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  )

// Only images already present in the active public projection qualify. Never
// accept a caller-provided URL or look up owner snapshots/private documents.
export function publicImageSources(html) {
  if (typeof html !== "string") return []
  const images = []
  const walk = (node) => {
    if (node.type === "element" && node.tagName === "img")
      images.push(typeof node.properties?.src === "string" ? node.properties.src : "")
    for (const child of node.children || []) walk(child)
  }
  walk(fromHtml(html, { fragment: true }))
  return images
}

export function allowedExportImage(value) {
  if (typeof value !== "string" || value.length > 8192) return null
  try {
    const url = new URL(value)
    const prefix = hosts.get(url.hostname)
    if (
      url.protocol !== "https:" ||
      !prefix ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      !url.pathname.startsWith(prefix) ||
      /[\\\u0000-\u001f\u007f]|%(?:00|2f|5c)/i.test(url.pathname) ||
      !/\.(?:png|jpe?g|gif|webp|avif)$/i.test(url.pathname)
    )
      return null
    // Yuque fragments describe cropping/layout; they are not network paths.
    url.hash = ""
    return url.href
  } catch {
    return null
  }
}

export function rasterImageType(bytes) {
  const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end))
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    return "image/png"
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif"
  if (bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp"
  if (
    bytes.length >= 16 &&
    text(4, 8) === "ftyp" &&
    ["avif", "avis"].some((brand) => text(8, Math.min(64, bytes.length)).includes(brand))
  )
    return "image/avif"
  return null
}

async function boundedBytes(response) {
  const declared = response.headers.get("Content-Length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_EXPORT_IMAGE_BYTES)) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_EXPORT_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function exportImageResponse(request, db, route, current, fetcher = fetch) {
  if (request.method !== "GET") return failure("图片导出接口仅支持 GET。", 405)
  const match = /^export-image\/([^/]+)\/(0|[1-9]\d{0,3})$/.exec(route)
  const url = new URL(request.url)
  if (
    !match ||
    !idPattern.test(match[1]) ||
    [...url.searchParams.keys()].some((key) => key !== "revision") ||
    url.searchParams.getAll("revision").length > 1
  )
    return failure("图片引用不正确。", 400)
  const row = await db
    .prepare("SELECT body FROM public_documents WHERE revision = ? AND id = ?")
    .bind(current.revision, match[1])
    .first()
  if (!row) return failure("文章不存在或尚未公开。", 404)
  const revision = url.searchParams.get("revision")
  if (revision !== null && (!/^\d+$/.test(revision) || Number(revision) !== current.revision))
    return failure("文章已更新，请刷新后导出。", 409)
  const document = JSON.parse(row.body)
  if (document.id !== match[1] || typeof document.html !== "string")
    return failure("文章图片暂不可用。", 503)
  const sources = publicImageSources(document.html)
  const index = Number(match[2])
  if (index >= sources.length) return failure("文章没有这张图片。", 404)
  const source = allowedExportImage(sources[index])
  if (!source) return failure("该图片来源不支持安全导出，请使用允许跨域读取的图床。", 422)

  const controller = new AbortController()
  const cancel = () => controller.abort()
  request.signal.addEventListener("abort", cancel, { once: true })
  if (request.signal.aborted) cancel()
  const timeout = setTimeout(cancel, 12000)
  try {
    // No request headers, credentials, cookies or referrer are forwarded.
    // Do not follow redirects: even a known image host cannot redirect us to
    // an internal destination or a private/API address.
    const response = await fetcher(source, {
      method: "GET",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif" },
    })
    if (!response.ok) {
      await response.body?.cancel()
      return failure("原图加载失败或返回重定向，请在原文检查图片。", 502)
    }
    const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase()
    if (!/^image\/(?:png|jpeg|gif|webp|avif)$/.test(type || "")) {
      await response.body?.cancel()
      return failure("原图不是支持的静态图片。", 422)
    }
    const bytes = await boundedBytes(response)
    if (!bytes) return failure("图片超过 10 MiB，无法安全导出。", 413)
    if (rasterImageType(bytes) !== type) return failure("原图格式与内容不一致。", 422)
    const sourceSha = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
    return new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Howard-Image-Source-SHA256": sourceSha,
        "Access-Control-Expose-Headers": "X-Howard-Image-Source-SHA256",
      },
    })
  } catch {
    return failure("原图读取失败或超时，请稍后重试。", 502)
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener("abort", cancel)
  }
}
