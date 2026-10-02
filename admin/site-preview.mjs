import { publicLibrarySnapshot } from "./public-library.mjs"
export function createSitePreview(
  getSettings,
  getSnapshot,
  { root = document, siteBase = new URL("../", location.href) } = {},
) {
  const ownerSnapshot = getSnapshot
  getSnapshot = () => publicLibrarySnapshot(ownerSnapshot())
  const $ = (id) => root.querySelector(`[data-admin-id="${id}"]`) || root.querySelector(`#${id}`)
  const listeners = new AbortController()
  let disposed = false
  const frame = $("site-preview-frame"),
    stage = $("site-preview-stage"),
    panel = $("site-preview-panel")
  let ready = false,
    timer,
    active = false,
    pendingOpen = false
  const sizes = { desktop: [1440, 960], tablet: [820, 1000], mobile: [390, 844] }
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
        { type: "howard-layout-preview", settings: getSettings(), theme: $("preview-theme").value },
        location.origin,
      )
    } catch {
      $("site-preview-state").textContent = "预览失败"
    }
  }
  const open = () => {
    if (disposed) return
    pendingOpen = true
    if (!active || !stage.isConnected || !stage.getClientRects().length) return
    pendingOpen = false
    const type = $("preview-page").value
    $("preview-article").hidden = type !== "article"
    const routes = {
      home: "",
      topics: "topics/",
      notes: "notes/",
      article: `notes/${$("preview-article").value}`,
    }
    if (type === "article" && !$("preview-article").value) {
      $("site-preview-state").textContent = "暂无已发布文章"
      return
    }
    ready = false
    $("site-preview-state").textContent = "正在加载…"
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!ready) $("site-preview-state").textContent = "加载失败，可重试"
    }, 15000)
    const url = new URL(routes[type], siteBase)
    url.searchParams.set("site-preview", "1")
    frame.src = url.href
    resize()
  }
  const suspend = () => {
    clearTimeout(timer)
    ready = false
    pendingOpen = true
    // Removing the browsing context releases the embedded site's graphs,
    // observers, image surfaces and scripts while leaving layout edits and
    // preview controls in the parent workspace intact.
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
  $("retry-site-preview").onclick = open
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
      const articles = getSnapshot().catalog.articles.filter((article) => article.published)
      const select = $("preview-article"),
        previous = select.value
      select.replaceChildren(...articles.map((article) => new Option(article.title, article.id)))
      if (articles.some((article) => article.id === previous)) select.value = previous
      open()
    },
  }
}
