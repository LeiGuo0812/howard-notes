import { createPanelWindow } from "./panel-window.mjs"
import { createSettingsOutsideClose } from "./settings-outside-close.mjs"

const captions = {
  edit: "编辑文章",
  new: "新建文章",
  articles: "文章管理",
  private: "私密文库",
  drafts: "草稿箱",
  trash: "回收站",
  settings: "页面设置",
}

// The first frame contains only window controls and public loading text. The
// editor, catalogue, credentials and drafts continue to live in the workspace.
export function createMaintenanceOpening({ onHide = () => {}, onRetry = () => {} } = {}) {
  let host,
    heading,
    caption,
    status,
    progress,
    progressText,
    retry,
    reopen,
    windowState,
    outsideClose,
    activeAction = "settings",
    visible = false,
    active = false,
    failed = false,
    disposed = false
  const listeners = new AbortController()
  const paints = new Set()
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal })
  const node = (tag, className, text) => {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text) element.textContent = text
    return element
  }
  function showProgress() {
    if (!active || disposed || !progress) return
    progressText.textContent = status.textContent
    progress.dataset.state = failed ? "error" : "working"
    retry.hidden = !failed
    reopen.textContent = visible ? "收起窗口" : "重新打开"
    reopen.title = visible ? "收起窗口，继续阅读" : "打开正在加载的维护窗口"
    progress.hidden = false
    if (progress.parentNode !== document.body) document.body.append(progress)
  }
  function hide() {
    active = false
    visible = false
    outsideClose?.stop()
    windowState?.detach()
    if (host) {
      host.hidden = true
      host.remove()
    }
    if (progress) {
      progress.hidden = true
      progress.remove()
    }
    for (const finish of [...paints]) finish()
  }
  function userHide() {
    if (!visible || disposed) return
    hide()
    active = true
    showProgress()
    onHide()
  }
  function create() {
    if (host || disposed) return
    host = node("section", "maintenance-host is-panel maintenance-opening")
    host.id = "maintenance-opening"
    host.hidden = true
    host.setAttribute("role", "dialog")
    host.setAttribute("aria-busy", "true")
    heading = node("div", "maintenance-opening-heading")
    caption = node("strong", "maintenance-opening-caption")
    const maximize = node("button", "maintenance-opening-control")
    maximize.type = "button"
    const minimize = node("button", "maintenance-opening-control")
    minimize.type = "button"
    minimize.title = "收起窗口"
    minimize.dataset.tooltip = minimize.title
    minimize.setAttribute("aria-label", minimize.title)
    minimize.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>'
    heading.append(caption, maximize, minimize)
    const body = node("div", "maintenance-opening-body")
    status = node("p", "maintenance-opening-status")
    status.setAttribute("role", "status")
    status.setAttribute("aria-live", "polite")
    const placeholders = node("div", "maintenance-opening-placeholders")
    placeholders.setAttribute("aria-hidden", "true")
    for (let index = 0; index < 3; index++)
      placeholders.append(node("div", "maintenance-opening-placeholder"))
    body.append(status, placeholders)
    host.append(heading, body)
    progress = node("div", "maintenance-progress maintenance-opening-progress")
    progress.id = "maintenance-opening-progress"
    progress.hidden = true
    progress.setAttribute("role", "status")
    progress.setAttribute("aria-live", "polite")
    progressText = node("span")
    retry = node("button", "", "重试")
    retry.type = "button"
    retry.hidden = true
    reopen = node("button")
    reopen.type = "button"
    progress.append(progressText, retry, reopen)
    windowState = createPanelWindow({
      host,
      heading,
      caption,
      toggle: maximize,
      onChange() {},
    })
    outsideClose = createSettingsOutsideClose({
      host,
      isActive: () => visible && activeAction === "settings",
      onClose: userHide,
    })
    listen(minimize, "click", userHide)
    listen(retry, "click", () => onRetry(activeAction))
    listen(reopen, "click", () => (visible ? userHide() : onRetry(activeAction)))
    listen(document, "keydown", (event) => {
      if (event.key !== "Escape" || !visible) return
      if (document.querySelector(".search-container.active,.global-graph-outer.active")) return
      if (windowState.isFullscreen()) windowState.restore()
      else userHide()
    })
  }
  function show(action = "settings") {
    if (disposed) return
    create()
    const wasVisible = visible && host.isConnected && !host.hidden
    const actionChanged = activeAction !== action
    activeAction = action
    active = true
    visible = true
    caption.textContent = captions[action] || "网站维护"
    host.setAttribute("aria-label", caption.textContent)
    if (!wasVisible || actionChanged || failed) {
      failed = false
      host.setAttribute("aria-busy", "true")
      status.textContent = `正在加载${caption.textContent}…`
    }
    host.hidden = false
    if (host.parentNode !== document.body) document.body.append(host)
    windowState.sync(false)
    if (!wasVisible) windowState.center()
    if (activeAction === "settings") outsideClose.start()
    else outsideClose.stop()
    showProgress()
  }
  function afterPaint() {
    if (disposed || !visible) return Promise.resolve()
    return new Promise((resolve) => {
      let first = 0,
        second = 0,
        timer = 0,
        settled = false
      const finish = () => {
        if (settled) return
        settled = true
        if (first) cancelAnimationFrame(first)
        if (second) cancelAnimationFrame(second)
        if (timer) clearTimeout(timer)
        document.removeEventListener("visibilitychange", visibility)
        paints.delete(finish)
        resolve()
      }
      const visibility = () => {
        if (document.visibilityState === "hidden" && !timer) timer = setTimeout(finish, 0)
      }
      paints.add(finish)
      document.addEventListener("visibilitychange", visibility)
      if (document.visibilityState === "hidden") timer = setTimeout(finish, 0)
      else
        first = requestAnimationFrame(() => {
          first = 0
          second = requestAnimationFrame(finish)
        })
    })
  }
  return {
    show,
    hide,
    afterPaint,
    fail(error) {
      if (disposed) return
      create()
      failed = true
      host.setAttribute("aria-busy", "false")
      status.textContent = error?.message || String(error || "维护窗口加载失败，请重试。")
      showProgress()
    },
    setStatus(text) {
      if (disposed) return
      create()
      status.textContent = String(text || "正在加载…")
      showProgress()
    },
    isVisible: () => visible && !!host?.isConnected && !host.hidden,
    capture: () => windowState?.snapshot() || { fullscreen: false, position: null },
    destroy() {
      if (disposed) return
      disposed = true
      hide()
      listeners.abort()
      outsideClose?.destroy()
      windowState?.destroy()
    },
  }
}
