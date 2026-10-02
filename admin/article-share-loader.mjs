let mounted = false,
  loading,
  invocation = 0,
  notice
function removeNotice() {
  notice?.remove()
  notice = null
}
export function setupArticleShare() {
  if (mounted || window.parent !== window) return
  mounted = true
  document.addEventListener("prenav", () => {
    invocation++
    removeNotice()
  })
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button.article-share-button[data-article-share]")
    if (!button || button.closest("article,.popover-hint")) return
    event.preventDefault()
    const serial = ++invocation
    removeNotice()
    notice = document.createElement("p")
    notice.className = "article-export-launch-notice"
    notice.setAttribute("role", "status")
    notice.textContent = "正在打开分享…"
    document.body.append(notice)
    const login = document.querySelector("[data-maintenance-login]")
    const base = new URL("../", login.href)
    loading ??= import(new URL("maintenance-assets/article-share.js", base).href).catch((error) => {
      loading = null
      throw error
    })
    void loading
      .then((module) => {
        if (serial !== invocation || !button.isConnected) return
        removeNotice()
        module.openArticleShare({ button, siteBase: base.href })
      })
      .catch(() => {
        if (serial === invocation && notice) {
          notice.textContent = "分享组件暂时无法加载，请重试"
          setTimeout(removeNotice, 4500)
        }
      })
  })
}
