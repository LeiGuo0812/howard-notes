import { paginateItems, sampleItems } from "./browsing"
import { setupLayoutPreview } from "./layout-preview"
import { setupTimeline } from "./timeline"
import { mountFrostedSpotlight } from "../../../scripts/lib/frosted-spotlight.mjs"
import { setupMaintenance } from "../../../admin/maintenance-loader.mjs"
import { setupMemories } from "../../../admin/memory-loader.mjs"
import "./runtime-content.inline"

function setupIconHints() {
  const update = () => {
    const dark = document.documentElement.getAttribute("saved-theme") === "dark"
    for (const [selector, label] of [
      [".darkmode", dark ? "切换浅色模式" : "切换深色模式"],
      [".search-button", "搜索笔记"],
      [".global-graph-icon", "展开关系图谱"],
    ]) {
      for (const button of document.querySelectorAll<HTMLElement>(selector)) {
        button.title = label
        button.setAttribute("aria-label", label)
      }
    }
  }
  update()
  document.addEventListener("themechange", update)
  window.addCleanup(() => document.removeEventListener("themechange", update))
}

function setupMaintenanceDock() {
  const dock = document.querySelector<HTMLDetailsElement>(".maintenance-tool-dock")
  if (!dock) return
  const desktop = matchMedia("(min-width: 1240px)")
  const resize = () => {
    dock.open = desktop.matches
  }
  const choose = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest("[data-maintenance-action]")) resize()
  }
  const dismiss = (event: KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      dock.open &&
      !desktop.matches &&
      !document.querySelector(".search-container.active,.global-graph-outer.active")
    ) {
      dock.open = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  resize()
  desktop.addEventListener("change", resize)
  dock.addEventListener("click", choose)
  document.addEventListener("keydown", dismiss)
  window.addCleanup(() => {
    desktop.removeEventListener("change", resize)
    dock.removeEventListener("click", choose)
    document.removeEventListener("keydown", dismiss)
  })
}

function setupNoteBrowser() {
  setupIconHints()
  setupMaintenanceDock()
  setupMaintenance()
  setupMemories()
  const hideThumbnail = (image: HTMLImageElement) => {
    const wrapper = image.closest<HTMLElement>(".article-thumbnail")
    if (wrapper) wrapper.hidden = true
  }
  const hideBrokenThumbnail = (event: Event) => {
    const image = event.target
    if (image instanceof HTMLImageElement && image.hasAttribute("data-article-thumbnail"))
      hideThumbnail(image)
  }
  for (const image of document.querySelectorAll<HTMLImageElement>("img[data-article-thumbnail]"))
    if (image.complete && !image.naturalWidth) hideThumbnail(image)
  document.addEventListener("error", hideBrokenThumbnail, { capture: true })
  window.addCleanup(() =>
    document.removeEventListener("error", hideBrokenThumbnail, { capture: true }),
  )
  const recommendations = document.querySelector<HTMLElement>("#random-notes")
  const pool = document.querySelector<HTMLTemplateElement>("#random-note-pool")
  let redraw = () => {}
  if (recommendations && pool) {
    const notes = [...pool.content.querySelectorAll<HTMLAnchorElement>(".note-preview")]
    const draw = () => {
      let chosen = sampleItems(notes, Number(recommendations.dataset.count) || 3)
      // Always change at least one article when there is a larger pool.
      const previous = new Set(
        [...recommendations.querySelectorAll<HTMLAnchorElement>(".note-preview")].map((note) =>
          note.getAttribute("href"),
        ),
      )
      if (
        notes.length > chosen.length &&
        chosen.every((note) => previous.has(note.getAttribute("href")))
      ) {
        chosen = [
          sampleItems(
            notes.filter((note) => !previous.has(note.getAttribute("href"))),
            1,
          )[0],
          ...chosen.slice(1),
        ]
      }
      recommendations.replaceChildren(
        ...chosen.map((note) => {
          const card = note.cloneNode(true) as HTMLElement
          card.classList.add("frosted-panel")
          card.setAttribute("data-spotlight", "")
          const surface = document.createElement("div")
          surface.className = "frost-environment lucky-preview-surface"
          surface.append(card)
          return surface
        }),
      )
    }
    const refresh = document.querySelector<HTMLButtonElement>("#refresh-random-notes")
    refresh?.addEventListener("click", draw)
    window.addCleanup(() => refresh?.removeEventListener("click", draw))
    draw()
    redraw = draw
  }
  setupLayoutPreview(redraw)
  // Auxiliary reading surfaces share the material. Prose and graph nodes stay
  // still; the global graph/search dialogs keep their viewport positioning.
  for (const panel of document.querySelectorAll<HTMLElement>(".reading-sidebar .toc")) {
    panel.classList.add("frosted-panel")
    panel.setAttribute("data-spotlight", "")
  }
  window.addCleanup(mountFrostedSpotlight(document))
  const scrollControls = document.querySelector<HTMLElement>(".reading-scroll-controls")
  if (scrollControls) {
    const jump = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-scroll]")
      if (!button) return
      window.scrollTo({
        top: button.dataset.scroll === "top" ? 0 : document.documentElement.scrollHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      })
    }
    scrollControls.addEventListener("click", jump)
    window.addCleanup(() => scrollControls.removeEventListener("click", jump))
  }
  const tools = document.querySelector<HTMLDetailsElement>(".reading-tools")
  if (tools) {
    const desktop = matchMedia("(min-width: 1240px)")
    const mobile = matchMedia("(max-width: 800px)")
    const summary = tools.querySelector<HTMLElement>(":scope > summary")
    let initialized = false
    const resize = () => {
      // Mobile starts closed in HTML. Keep an early native summary click
      // while the asynchronously loaded script initializes.
      if (initialized || !mobile.matches) tools.open = desktop.matches
      initialized = true
    }
    const close = (restoreFocus = true) => {
      if (!mobile.matches || !tools.open) return
      tools.open = false
      if (restoreFocus) summary?.focus({ preventScroll: true })
    }
    const choose = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest("[data-reading-close]")) close()
      // Close before the SPA's bubbling anchor handler measures the heading.
      // Existing Unicode anchors, URL history and scroll-padding stay intact.
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        target.closest(".toc a[data-for]")
      )
        close()
    }
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || tools.contains(event.target)) return
      if (document.querySelector(".global-graph-outer.active")) return
      close(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !mobile.matches || !tools.open) return
      if (document.querySelector(".search-container.active,.global-graph-outer.active")) return
      close()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const opened = () => {
      if (!mobile.matches || !tools.open) return
      const dock = document.querySelector<HTMLDetailsElement>(".maintenance-tool-dock")
      if (dock) dock.open = false
      // One scroll surface covers the whole drawer, including long TOCs.
      const panels = tools.querySelector<HTMLElement>(".reading-tool-panels")
      if (panels) panels.scrollTop = 0
    }
    // The local graph is SVG. Expanding it must not reinitialise unrelated
    // Quartz controls or dispatch a render event without the current route.
    desktop.addEventListener("change", resize)
    mobile.addEventListener("change", resize)
    tools.addEventListener("click", choose)
    tools.addEventListener("toggle", opened)
    document.addEventListener("pointerdown", dismiss, { passive: true })
    document.addEventListener("keydown", escape, { capture: true })
    window.addCleanup(() => {
      desktop.removeEventListener("change", resize)
      mobile.removeEventListener("change", resize)
      tools.removeEventListener("click", choose)
      tools.removeEventListener("toggle", opened)
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("keydown", escape, { capture: true })
    })
    resize()
  }
  const year = document.querySelector<HTMLSelectElement>("#activity-period")
  if (year) {
    const chooseYear = () => {
      for (const period of document.querySelectorAll<HTMLElement>("[data-activity-period]"))
        period.hidden = period.dataset.activityPeriod !== year.value
    }
    year.addEventListener("change", chooseYear)
    window.addCleanup(() => year.removeEventListener("change", chooseYear))
    chooseYear()
  }
  const list = document.querySelector<HTMLOListElement>("#sortable-articles")
  const order = document.querySelector<HTMLSelectElement>("#listing-sort")
  const search = document.querySelector<HTMLInputElement>("#listing-search")
  if (!list || !order || !search) return
  const rows = [...list.querySelectorAll<HTMLLIElement>(":scope > li")]
  const rowSearch = new Map(
    rows.map((row) => [row, (row.dataset.search || "").toLocaleLowerCase()]),
  )
  const titleOrder = new Intl.Collator("zh-CN", { numeric: true })
  const sortedRows = new Map<string, HTMLLIElement[]>()
  let appliedOrder = "",
    appliedDateField = "",
    appliedTag: string | undefined,
    appliedPages = ""
  const params = new URLSearchParams(location.search)
  const tagIndex = document.querySelector<HTMLElement>("#listing-tags")
  let selectedTag = params.get("tag") || ""
  const rowTags = new Map(
    rows.map((row) => {
      let tags: string[] = []
      try {
        const parsed: unknown = JSON.parse(row.dataset.tags || "[]")
        if (Array.isArray(parsed))
          tags = parsed.filter((tag): tag is string => typeof tag === "string")
      } catch {
        // Older cached pages do not have the scoped tag metadata.
      }
      return [row, new Set(tags)] as const
    }),
  )
  let currentPage = Number(params.get("page") || 1)
  const validOrders = [...order.options].map((option) => option.value)
  if (validOrders.includes(params.get("sort") || "")) order.value = params.get("sort")!
  search.value = params.get("q") || ""
  let activity = /^\d{4}-\d{2}-\d{2}$/.test(params.get("activity") || "")
    ? params.get("activity")
    : null
  const update = (writeUrl = true, push = false) => {
    const value = order.value,
      query = search.value.trim().toLocaleLowerCase()
    const field = value.startsWith("created") ? "created" : "modified"
    const compareTitle = (a: HTMLLIElement, b: HTMLLIElement) =>
      titleOrder.compare(a.dataset.title || "", b.dataset.title || "") ||
      (a.dataset.noteId || "").localeCompare(b.dataset.noteId || "")
    let sorted = sortedRows.get(value)
    if (!sorted) {
      sorted = [...rows].sort((a, b) => {
        if (value === "title-asc") return compareTitle(a, b)
        if (value === "title-desc") return -compareTitle(a, b)
        return (
          (value.endsWith("asc") ? 1 : -1) *
            (a.dataset[field] || "").localeCompare(b.dataset[field] || "") || compareTitle(a, b)
        )
      })
      sortedRows.set(value, sorted)
    }
    const matching = sorted.filter(
      (row) =>
        rowSearch.get(row)!.includes(query) &&
        (!selectedTag || rowTags.get(row)?.has(selectedTag)) &&
        (!activity || row.dataset.created === activity || row.dataset.modified === activity),
    )
    if (appliedTag !== selectedTag) {
      for (const link of tagIndex?.querySelectorAll<HTMLElement>("[data-listing-tag]") ?? []) {
        const selected = link.dataset.listingTag === selectedTag
        if (selected) link.setAttribute("aria-current", "true")
        else link.removeAttribute("aria-current")
      }
      appliedTag = selectedTag
    }
    const paginated = paginateItems(matching, currentPage)
    currentPage = paginated.page
    const visible = new Set(paginated.items)
    for (const row of sorted) {
      const hidden = !visible.has(row)
      if (row.hidden !== hidden) row.hidden = hidden
      if (appliedDateField !== field) {
        const time = row.querySelector("time")
        if (time) {
          time.dateTime = row.dataset[field] || ""
          time.textContent = time.dateTime
        }
      }
    }
    appliedDateField = field
    if (appliedOrder !== value) {
      list.append(...sorted)
      appliedOrder = value
    }
    list.start = paginated.start + 1
    document.querySelector("#listing-count")!.textContent =
      matching.length === rows.length
        ? `${matching.length} 篇`
        : `${matching.length} / ${rows.length} 篇`
    document.querySelector<HTMLElement>("#listing-empty")!.hidden = matching.length > 0
    timeline?.update(matching, value)
    list.hidden = timeline?.isActive() || false
    document.querySelector<HTMLElement>("#listing-pagination")!.hidden =
      !!timeline?.isActive() || paginated.pages === 1
    previous.disabled = currentPage === 1
    next.disabled = currentPage === paginated.pages
    document.querySelector("#listing-page-state")!.textContent =
      `${currentPage} / ${paginated.pages}`
    const pages = document.querySelector("#listing-pages")!
    const pageSignature = `${currentPage}:${paginated.pages}`
    if (appliedPages !== pageSignature) {
      appliedPages = pageSignature
      pages.replaceChildren()
      const numbers = new Set([1, paginated.pages, currentPage - 1, currentPage, currentPage + 1])
      let last = 0
      for (const number of [...numbers]
        .filter((n) => n > 0 && n <= paginated.pages)
        .sort((a, b) => a - b)) {
        if (last && number - last > 1) {
          const gap = document.createElement("span")
          gap.textContent = "…"
          pages.append(gap)
        }
        const button = document.createElement("button")
        button.type = "button"
        button.dataset.page = String(number)
        button.textContent = String(number)
        button.setAttribute("aria-label", `第 ${number} 页`)
        if (number === currentPage) button.setAttribute("aria-current", "page")
        pages.append(button)
        last = number
      }
    }
    document.querySelector<HTMLElement>("#activity-filter")!.hidden = !activity
    document.querySelector("#activity-filter-date")!.textContent = activity
      ? `${activity} 创建或更新`
      : ""
    if (writeUrl) {
      const url = new URL(location.href)
      if (value !== "modified-desc") url.searchParams.set("sort", value)
      else url.searchParams.delete("sort")
      if (query) url.searchParams.set("q", search.value.trim())
      else url.searchParams.delete("q")
      if (selectedTag) url.searchParams.set("tag", selectedTag)
      else url.searchParams.delete("tag")
      if (activity) url.searchParams.set("activity", activity)
      else url.searchParams.delete("activity")
      if (currentPage > 1) url.searchParams.set("page", String(currentPage))
      else url.searchParams.delete("page")
      if (push) history.pushState(history.state, "", url)
      else history.replaceState(history.state, "", url)
    }
  }
  const timeline = setupTimeline({ onViewChange: () => update() })
  const refresh = () => {
    currentPage = 1
    update()
  }
  const chooseTag = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-listing-tag]")
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    selectedTag = link.dataset.listingTag || ""
    currentPage = 1
    update(true, true)
  }
  const clear = () => {
    activity = null
    currentPage = 1
    update()
  }
  const previous = document.querySelector<HTMLButtonElement>("#listing-previous")!
  const next = document.querySelector<HTMLButtonElement>("#listing-next")!
  const pagination = document.querySelector<HTMLElement>("#listing-pagination")!
  const changePage = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button")
    if (!button || button.disabled) return
    currentPage =
      button === previous
        ? currentPage - 1
        : button === next
          ? currentPage + 1
          : Number(button.dataset.page)
    update(true, true)
    list.scrollIntoView({ block: "start" })
  }
  pagination.addEventListener("click", changePage)
  const clearButton = document.querySelector<HTMLButtonElement>("#clear-activity-filter")!
  order.addEventListener("change", refresh)
  search.addEventListener("input", refresh)
  clearButton.addEventListener("click", clear)
  tagIndex?.addEventListener("click", chooseTag)
  window.addCleanup(() => {
    order.removeEventListener("change", refresh)
    search.removeEventListener("input", refresh)
    clearButton.removeEventListener("click", clear)
    pagination.removeEventListener("click", changePage)
    tagIndex?.removeEventListener("click", chooseTag)
  })
  update()
}
document.addEventListener("nav", setupNoteBrowser)
