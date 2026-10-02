export function exportFilename(title, extension) {
  const name =
    [
      ...String(title || "文章")
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
        .replace(/^\.+|[.\s]+$/g, ""),
    ]
      .slice(0, 60)
      .join("") || "文章"
  return `${name}.${extension}`
}

export function sourceLink(value) {
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("原文链接不正确")
  url.hash = ""
  return url.href
}

export function markdownBytes(source, { includeSource = false, url } = {}) {
  if (typeof source !== "string") throw new Error("文章原文不可用")
  const newline = source.includes("\r\n") ? "\r\n" : "\n"
  const footer = includeSource
    ? `${source.endsWith("\n") ? newline : newline + newline}---${newline}原文链接：<${sourceLink(url)}>${newline}`
    : ""
  return new TextEncoder().encode(source + footer)
}

export function usesMobileShare(device = globalThis.navigator, media = globalThis.matchMedia) {
  if (typeof device?.userAgentData?.mobile === "boolean") return device.userAgentData.mobile
  if (/Android|iPhone|iPad|iPod/i.test(device?.userAgent || "")) return true
  return !!media?.("(pointer: coarse) and (max-width: 1100px)")?.matches
}

export function canShareFile(file, device = globalThis.navigator) {
  try {
    return typeof device?.share === "function" && !!device?.canShare?.({ files: [file] })
  } catch {
    return false
  }
}

// Call directly from the ready button. Do not await generation, imports or a
// permission query here: navigator.share requires transient user activation.
export function shareFile(file, { title, includeSource = false, url } = {}, device = navigator) {
  return device.share({ files: [file], title, ...(includeSource ? { url: sourceLink(url) } : {}) })
}

export function downloadFile(file, { document: doc = document, urls = URL } = {}) {
  const url = urls.createObjectURL(file)
  const anchor = doc.createElement("a")
  anchor.href = url
  anchor.download = file.name
  anchor.dataset.routerIgnore = ""
  anchor.style.display = "none"
  doc.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
  const timer = setTimeout(() => urls.revokeObjectURL(url), 1500)
  return () => {
    clearTimeout(timer)
    urls.revokeObjectURL(url)
  }
}
