import { requestOwnerAccess } from "./owner-access.mjs"

const PREVIEW_COUNT = 4
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// The home preview is plain text. Cards retain their original Markdown in the
// memory view; neither source content nor attachment URLs are copied to the shell.
export function memoryPreviewText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|[-*>]\s+|\d+\.\s+)/gm, "")
    .replace(/(^|\s)#[\p{L}\p{N}_][\p{L}\p{N}_/.-]*/gu, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220)
}

export function visibleMemoryPreviews(result, { publicOnly = false } = {}) {
  const owner = result?.owner === true && !publicOnly
  return (Array.isArray(result?.memories) ? result.memories : [])
    .filter(
      (memory) =>
        memory &&
        typeof memory.id === "string" &&
        memory.status === "NORMAL" &&
        (owner || memory.visibility === "PUBLIC"),
    )
    .slice(0, PREVIEW_COUNT)
}

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function mountHomeMemoryPreviews(hub, { siteBase }) {
  let alive = true,
    serial = 0,
    pending,
    configPending,
    apiBase,
    forcePublic = window.parent !== window,
    disposedByPageHide = false
  const listeners = new AbortController()
  const module = hub.closest(".home-module")
  let hidden = !!module?.hidden
  const on = (target, name, callback) =>
    target.addEventListener(name, callback, { signal: listeners.signal })
  const clear = () => hub.replaceChildren()
  const showMessage = (text, retry = false) => {
    const message = element("p", "home-memory-message", text)
    message.setAttribute("role", "status")
    if (retry) {
      const button = element("button", "home-memory-retry", "重试")
      button.type = "button"
      button.onclick = () => void load()
      message.append(button)
    }
    hub.replaceChildren(message)
  }
  const render = (memory) => {
    const surface = element("div", "frost-environment home-memory-surface")
    const card = element("a", "internal home-memory-card frosted-panel")
    card.dataset.spotlight = ""
    card.dataset.noPopover = "true"
    const route = new URL(hub.dataset.memoryRoute, location.href)
    route.hash = `memory-card-${encodeURIComponent(memory.id)}`
    card.href = route.href
    const header = element("div", "home-memory-card-heading")
    const timestamp = Date.parse(memory.created)
    const time = element(
      "time",
      "",
      Number.isFinite(timestamp) ? dateFormat.format(timestamp) : "日期未记录",
    )
    if (Number.isFinite(timestamp)) time.dateTime = memory.created
    header.append(time)
    if (memory.visibility !== "PUBLIC") {
      const visibility = element(
        "span",
        "home-memory-visibility",
        memory.visibility === "PRIVATE" ? "私密" : "未公开",
      )
      header.append(visibility)
    }
    card.append(header)
    const text = memoryPreviewText(memory.content)
    card.append(element("p", "home-memory-excerpt", text || "查看记忆卡"))
    if (Array.isArray(memory.tags) && memory.tags.length) {
      const tags = element("div", "home-memory-preview-tags")
      for (const tag of memory.tags.filter((tag) => typeof tag === "string").slice(0, 4))
        tags.append(element("span", "", `#${tag}`))
      card.append(tags)
    }
    surface.append(card)
    return surface
  }
  async function load({ quiet = false } = {}) {
    if (!alive || !apiBase || !hub.isConnected || disposedByPageHide || module?.hidden) return
    const current = ++serial
    pending?.abort()
    pending = new AbortController()
    const access = requestOwnerAccess()
    const publicOnly = forcePublic || access?.loggedOut === true
    if (publicOnly) clear()
    if (!quiet) showMessage("正在加载…")
    try {
      const url = new URL(apiBase)
      url.search = new URLSearchParams({
        page: "1",
        view: "cards",
        status: "NORMAL",
        sort: "created-desc",
      }).toString()
      const response = await fetch(url, {
        cache: "no-store",
        credentials: publicOnly ? "omit" : "same-origin",
        headers: !publicOnly && access?.token ? { Authorization: `Bearer ${access.token}` } : {},
        signal: pending.signal,
      })
      if (!response.ok) throw new Error("记忆卡暂时无法加载。")
      const result = await response.json()
      if (!alive || current !== serial || !hub.isConnected) return
      const memories = visibleMemoryPreviews(result, { publicOnly })
      if (!memories.length) showMessage("暂无记忆卡")
      else hub.replaceChildren(...memories.map(render))
    } catch (error) {
      if (!alive || current !== serial || !hub.isConnected || error.name === "AbortError") return
      clear()
      showMessage(error.message || "记忆卡暂时无法加载。", true)
    }
  }
  on(document, "howard-owner-statechange", (event) => {
    // Clear synchronously. A delayed owner response cannot paint after logout.
    forcePublic = window.parent !== window || event.detail?.loggedIn === false
    serial++
    pending?.abort()
    clear()
    void load()
  })
  on(document, "howard:content-updated", () => void load({ quiet: true }))
  on(window, "focus", () => void load({ quiet: true }))
  on(window, "pagehide", () => {
    disposedByPageHide = true
    serial++
    pending?.abort()
    clear()
  })
  on(window, "pageshow", () => {
    if (disposedByPageHide) {
      disposedByPageHide = false
      void load()
    }
  })
  const visibilityObserver = module
    ? new MutationObserver(() => {
        if (hidden === module.hidden) return
        hidden = module.hidden
        serial++
        pending?.abort()
        clear()
        if (!module.hidden) void load()
      })
    : null
  visibilityObserver?.observe(module, { attributes: true, attributeFilter: ["hidden"] })
  void (async () => {
    try {
      configPending = new AbortController()
      const response = await fetch(new URL("runtime-config.json", siteBase), {
        cache: "no-store",
        signal: configPending.signal,
      })
      if (!response.ok) throw new Error("记忆卡服务暂时无法连接。")
      const config = await response.json()
      const base = new URL(config.apiBase, siteBase)
      if (!config.enabled || !["https:", "http:"].includes(base.protocol))
        throw new Error("记忆卡服务尚未配置。")
      if (!alive || !hub.isConnected) return
      apiBase = `${base.href.replace(/\/$/, "")}/memories`
      await load()
    } catch (error) {
      if (alive && hub.isConnected && error.name !== "AbortError")
        showMessage(error.message || "记忆卡暂时无法加载。")
    }
  })()
  return {
    destroy() {
      alive = false
      serial++
      pending?.abort()
      configPending?.abort()
      visibilityObserver?.disconnect()
      listeners.abort()
      clear()
    },
  }
}
