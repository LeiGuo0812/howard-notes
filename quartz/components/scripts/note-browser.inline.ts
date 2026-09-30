import { paginateItems, sampleItems } from "./browsing"
import { setupLayoutPreview } from "./layout-preview"

function setupNoteBrowser() {
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
      recommendations.replaceChildren(...chosen.map((note) => note.cloneNode(true)))
    }
    const refresh = document.querySelector<HTMLButtonElement>("#refresh-random-notes")
    refresh?.addEventListener("click", draw)
    window.addCleanup(() => refresh?.removeEventListener("click", draw))
    draw()
    redraw = draw
  }
  setupLayoutPreview(redraw)
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
    const desktop = matchMedia("(min-width: 1000px)")
    const resize = () => {
      tools.open = desktop.matches
    }
    const expand = () => {
      if (tools.open) document.dispatchEvent(new CustomEvent("render", { detail: {} }))
    }
    tools.addEventListener("toggle", expand)
    desktop.addEventListener("change", resize)
    window.addCleanup(() => desktop.removeEventListener("change", resize))
    window.addCleanup(() => tools.removeEventListener("toggle", expand))
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
  const params = new URLSearchParams(location.search)
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
      (a.dataset.title || "").localeCompare(b.dataset.title || "", "zh-CN", { numeric: true }) ||
      (a.dataset.noteId || "").localeCompare(b.dataset.noteId || "")
    const sorted = [...rows].sort((a, b) => {
      if (value === "title-asc") return compareTitle(a, b)
      if (value === "title-desc") return -compareTitle(a, b)
      return (
        (value.endsWith("asc") ? 1 : -1) *
          (a.dataset[field] || "").localeCompare(b.dataset[field] || "") || compareTitle(a, b)
      )
    })
    const matching = sorted.filter(
      (row) =>
        (row.dataset.search || "").toLocaleLowerCase().includes(query) &&
        (!activity || row.dataset.created === activity || row.dataset.modified === activity),
    )
    const paginated = paginateItems(matching, currentPage)
    currentPage = paginated.page
    const visible = new Set(paginated.items)
    for (const row of sorted) {
      row.hidden = !visible.has(row)
      const time = row.querySelector("time")
      if (time) {
        time.dateTime = row.dataset[field] || ""
        time.textContent = time.dateTime
      }
    }
    list.append(...sorted)
    list.start = paginated.start + 1
    document.querySelector("#listing-count")!.textContent =
      matching.length === rows.length
        ? `${matching.length} 篇`
        : `${matching.length} / ${rows.length} 篇`
    document.querySelector<HTMLElement>("#listing-empty")!.hidden = matching.length > 0
    document.querySelector<HTMLElement>("#listing-pagination")!.hidden = paginated.pages === 1
    previous.disabled = currentPage === 1
    next.disabled = currentPage === paginated.pages
    document.querySelector("#listing-page-state")!.textContent =
      `${currentPage} / ${paginated.pages}`
    const pages = document.querySelector("#listing-pages")!
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
      if (activity) url.searchParams.set("activity", activity)
      else url.searchParams.delete("activity")
      if (currentPage > 1) url.searchParams.set("page", String(currentPage))
      else url.searchParams.delete("page")
      if (push) history.pushState(history.state, "", url)
      else history.replaceState(history.state, "", url)
    }
  }
  const refresh = () => {
    currentPage = 1
    update()
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
  window.addCleanup(() => {
    order.removeEventListener("change", refresh)
    search.removeEventListener("input", refresh)
    clearButton.removeEventListener("click", clear)
    pagination.removeEventListener("click", changePage)
  })
  update()
}
document.addEventListener("nav", setupNoteBrowser)
