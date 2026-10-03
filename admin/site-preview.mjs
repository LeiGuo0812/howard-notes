import { sitePreviewSettings } from "./site-preview-settings.mjs"
export function createSitePreview(
  getSettings,
  _getSnapshot,
  {
    root = document,
    siteBase = new URL("../", location.href),
    previewEntry = typeof __HOWARD_SITE_PREVIEW__ !== "undefined"
      ? __HOWARD_SITE_PREVIEW__
      : "admin/site-preview.html",
  } = {},
) {
  const $ = (id) => root.querySelector(`[data-admin-id="${id}"]`) || root.querySelector(`#${id}`)
  const listeners = new AbortController()
  let disposed = false
  const frame = $("site-preview-frame"),
    stage = $("site-preview-stage"),
    panel = $("site-preview-panel")
  frame.title = "页面样稿预览"
  let ready = false,
    mounted = false,
    timer,
    active = false,
    pendingOpen = false
  const sizes = { desktop: [1440, 960], tablet: [768, 1000], mobile: [390, 844] }
  const resize = () => {
    const [width, height] = sizes[$("preview-device").value]
    const scale = Math.min(1, stage.clientWidth / width)
    frame.style.width = width + "px"
    frame.style.height = height + "px"
    frame.style.transform = `scale(${scale})`
    frame.style.left = Math.max(0, (stage.clientWidth - width * scale) / 2) + "px"
    stage.style.height = height * scale + "px"
  }
  const update = () => {
    if (disposed || !active || !ready || !getSettings()) return
    try {
      frame.contentWindow.postMessage(
        {
          type: "howard-layout-preview",
          settings: sitePreviewSettings(getSettings()),
          theme: $("preview-theme").value,
          scene: $("preview-page").value,
        },
        location.origin,
      )
    } catch {
      $("site-preview-state").textContent = "预览失败"
    }
  }
  const open = ({ reload = false } = {}) => {
    if (disposed) return
    pendingOpen = true
    if (!active || !stage.isConnected || !stage.getClientRects().length) return
    pendingOpen = false
    $("preview-article").hidden = true
    resize()
    if (mounted && !reload) {
      update()
      return
    }
    ready = false
    $("site-preview-state").textContent = "正在加载…"
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!ready) $("site-preview-state").textContent = "加载失败，可重试"
    }, 15000)
    const url = new URL(previewEntry, siteBase)
    if (
      url.origin !== location.origin ||
      !/\/admin\/site-preview(?:-[a-f0-9]{16})?\.html$/.test(url.pathname)
    ) {
      $("site-preview-state").textContent = "预览地址不正确"
      clearTimeout(timer)
      return
    }
    // Request the clean route directly. Static hosts may redirect .html to an
    // extensionless path and otherwise discard a site's deployment prefix.
    url.pathname = url.pathname.replace(/\.html$/, "")
    frame.src = url.href
    mounted = true
  }
  const suspend = () => {
    clearTimeout(timer)
    ready = false
    mounted = false
    pendingOpen = true
    // Release the sample document while keeping unsaved layout and selectors.
    frame.src = "about:blank"
  }
  window.addEventListener(
    "message",
    (event) => {
      if (!active || event.origin !== location.origin || event.source !== frame.contentWindow)
        return
      if (event.data?.type === "howard-preview-ready") {
        ready = true
        clearTimeout(timer)
        update()
      }
      if (event.data?.type === "howard-preview-applied") $("site-preview-state").textContent = ""
      if (event.data?.type === "howard-preview-error")
        $("site-preview-state").textContent = "请检查设置"
    },
    { signal: listeners.signal },
  )
  $("preview-page").onchange = open
  $("preview-article").onchange = open
  $("preview-device").onchange = resize
  $("preview-theme").onchange = update
  $("retry-site-preview").onclick = () => open({ reload: true })
  $("expand-site-preview").onclick = () => {
    panel.classList.toggle("expanded")
    $("expand-site-preview").textContent = panel.classList.contains("expanded")
      ? "收起预览"
      : "展开预览"
    resize()
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && panel.classList.contains("expanded"))
        $("expand-site-preview").click()
    },
    { signal: listeners.signal },
  )
  const observer = new ResizeObserver(() => {
    resize()
    if (active && pendingOpen) open()
  })
  observer.observe(stage)
  return {
    update,
    setActive(value) {
      if (disposed) return
      const next = !!value
      if (active === next) return
      active = next
      if (!active) suspend()
      else if (pendingOpen && getSettings()) open()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      listeners.abort()
      observer.disconnect()
      frame.src = "about:blank"
    },
    load() {
      const select = $("preview-article")
      select.hidden = true
      select.replaceChildren(new Option("固定阅读样稿", "sample"))
      open()
    },
  }
}
