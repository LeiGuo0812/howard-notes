const stylesByDocument = new WeakMap()
const MAX_PRELOADS = 8
const loadError = () =>
  new Error("维护界面未能加载，请重试；若仍失败，请先保存当前草稿再刷新页面。")

function preloadStyle(doc, href) {
  if (!doc?.head || typeof doc.createElement !== "function") return
  let styles = stylesByDocument.get(doc)
  if (!styles) stylesByDocument.set(doc, (styles = new Map()))
  if (styles.has(href)) return
  const existing = Array.from(doc.querySelectorAll?.('link[rel="preload"][as="style"]') || []).find(
    (link) => link.href === href,
  )
  const link = existing || doc.createElement("link")
  if (!existing) {
    link.rel = "preload"
    link.as = "style"
    link.href = href
    link.setAttribute?.("data-maintenance-preload", "")
  }
  styles.set(href, { link, owned: !existing })
  link.addEventListener?.(
    "error",
    () => {
      if (styles.get(href)?.link === link) styles.delete(href)
      if (!existing) link.remove()
    },
    { once: true },
  )
  if (!existing) doc.head.append(link)
  while (styles.size > MAX_PRELOADS) {
    const oldest = styles.keys().next().value
    const record = styles.get(oldest)
    styles.delete(oldest)
    if (record.owned) record.link.remove()
  }
}

// Creating this loader performs no work. Only the owner opening a maintenance
// window calls prepare(); the public reader never preloads editor resources.
export function createMaintenanceAssetLoader({
  siteBase,
  version,
  fetcher = (...args) => globalThis.fetch(...args),
  doc = globalThis.document,
} = {}) {
  const base = new URL(siteBase)
  const templateFile =
    typeof __HOWARD_WORKSPACE_TEMPLATE__ !== "undefined"
      ? __HOWARD_WORKSPACE_TEMPLATE__
      : "maintenance-assets/workspace.txt"
  const styleFile =
    typeof __HOWARD_WORKSPACE_STYLE__ !== "undefined"
      ? __HOWARD_WORKSPACE_STYLE__
      : "maintenance-assets/workspace.css"
  const templateUrl = new URL(templateFile, base)
  const styleUrls = [styleFile, "admin/katex/katex.min.css"].map((file) => {
    const url = new URL(file, base)
    if (!file.includes("/workspace-")) url.searchParams.set("v", version)
    return url.href
  })
  let templatePromise = null
  return {
    prepare() {
      for (const url of styleUrls) preloadStyle(doc, url)
      if (!templatePromise) {
        const pending = (async () => {
          const response = await fetcher(templateUrl, { credentials: "omit" })
          if (!response.ok) throw loadError()
          const text = await response.text()
          if (typeof text !== "string" || !text.trim() || text.length > 512 * 1024)
            throw loadError()
          return text
        })()
        templatePromise = pending
        // Import can fail or the user can close before the factory consumes
        // this request. Observe rejection while retaining it for the caller.
        void pending.catch(() => {
          if (templatePromise === pending) templatePromise = null
        })
      }
      return { templatePromise }
    },
  }
}
