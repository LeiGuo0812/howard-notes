import { groupTimelineItems, timelineDateField } from "./browsing"

type TimelineView = "list" | "timeline"

export function setupTimeline({ onViewChange }: { onViewChange: () => void }) {
  const surface = document.querySelector<HTMLElement>("#article-timeline")
  const jump = document.querySelector<HTMLSelectElement>("#timeline-jump")
  const sidebar = document.querySelector<HTMLDetailsElement>("#timeline-sidebar")
  const sidebarAnchor = sidebar?.closest<HTMLElement>(".listing-sidebar-anchor")
  const listingControls = document.querySelector<HTMLElement>(".listing-controls")
  const search = document.querySelector<HTMLElement>("#listing-search")
  const navigation = document.querySelector<HTMLElement>("#timeline-navigation")
  const tagNavigation = document.querySelector<HTMLElement>("#listing-tags")
  const sidebarTabs = sidebar?.querySelector<HTMLElement>(".listing-sidebar-tabs")
  const tabButtons = [
    ...(sidebarTabs?.querySelectorAll<HTMLButtonElement>("[data-listing-sidebar-tab]") ?? []),
  ]
  const sidebarSummary = sidebar?.querySelector<HTMLElement>(":scope > summary")
  const header = document.querySelector<HTMLElement>(".blog-header")
  const pageHeader = document.querySelector<HTMLElement>(".page-header")
  const desktopSidebar = matchMedia("(min-width: 1400px)")
  const controls = [...document.querySelectorAll<HTMLButtonElement>("[data-listing-view]")]
  if (!surface || !jump || !controls.length) return

  let view: TimelineView =
    new URLSearchParams(location.search).get("view") === "timeline" ? "timeline" : "list"
  let lastRender = ""
  let sidebarTab: "tags" | "time" = view === "timeline" ? "time" : "tags"
  let sidebarInitialized = false
  let currentPeriod = ""
  const applyView = () => {
    surface.hidden = view !== "timeline"
    const jumpLabel = jump.closest<HTMLElement>(".timeline-jump")
    if (jumpLabel) jumpLabel.hidden = view !== "timeline"
    else jump.hidden = view !== "timeline"
    if (sidebar) {
      sidebar.hidden = false
      const timeSelected = sidebarTab === "time" && view === "timeline"
      if (navigation) navigation.hidden = !timeSelected
      if (tagNavigation) tagNavigation.hidden = timeSelected
      const label = timeSelected ? "年月" : "标签"
      const summaryLabel = sidebar.querySelector<HTMLElement>("[data-listing-sidebar-label]")
      if (summaryLabel) summaryLabel.textContent = label
      sidebarSummary
        ?.querySelector("path")
        ?.setAttribute(
          "d",
          timeSelected
            ? "M5 5h14v15H5zM8 3v4M16 3v4M5 10h14M9 14h.01M15 14h.01M9 17h.01M15 17h.01"
            : "M5 8h14M4 16h14M10 3 7 21M17 3l-3 18",
        )
      sidebarSummary?.setAttribute("aria-label", `展开文章${label}导航`)
      sidebarSummary?.setAttribute("title", `文章${label}`)
      for (const button of tabButtons) {
        button.hidden = button.dataset.listingSidebarTab === "time" && view !== "timeline"
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.listingSidebarTab === (timeSelected ? "time" : "tags")),
        )
      }
      if (sidebarTabs) sidebarTabs.hidden = view !== "timeline"
    }
    for (const button of controls) {
      const selected = button.dataset.listingView === view
      button.setAttribute("aria-pressed", String(selected))
    }
  }
  const setView = (next: TimelineView, writeUrl = true) => {
    if (next !== "list" && next !== "timeline") return
    if (view !== next) sidebarTab = next === "timeline" ? "time" : "tags"
    view = next
    applyView()
    if (writeUrl) {
      const url = new URL(location.href)
      if (view === "timeline") url.searchParams.set("view", "timeline")
      else url.searchParams.delete("view")
      history.replaceState(history.state, "", url)
    }
    onViewChange()
  }
  const chooseView = (event: MouseEvent) => {
    const button = event.currentTarget as HTMLButtonElement
    setView(button.dataset.listingView as TimelineView)
  }
  const highlightPeriod = () => {
    for (const link of navigation?.querySelectorAll<HTMLElement>("[data-timeline-jump]") ?? []) {
      if (link.dataset.timelineJump === currentPeriod) link.setAttribute("aria-current", "location")
      else link.removeAttribute("aria-current")
    }
  }
  const closeSidebar = (restoreFocus = false) => {
    if (!sidebar || desktopSidebar.matches || !sidebar.open) return
    sidebar.open = false
    if (restoreFocus) sidebarSummary?.focus({ preventScroll: true })
  }
  const scrollToPeriod = (period: string) => {
    const selector = period.startsWith("year-")
      ? `[data-timeline-year="${period.slice(5)}"]`
      : `#timeline-${period}`
    const target = surface.querySelector<HTMLElement>(selector)
    if (!target) return
    target.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    })
    currentPeriod = period
    highlightPeriod()
  }
  const jumpToMonth = () => {
    if (!jump.value) return
    scrollToPeriod(jump.value)
    jump.value = ""
  }
  const choosePeriod = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-timeline-jump]")
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    closeSidebar(true)
    scrollToPeriod(link.dataset.timelineJump ?? "")
  }
  const chooseSidebarTab = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-listing-sidebar-tab]",
    )
    if (!button) return
    sidebarTab = button.dataset.listingSidebarTab === "time" ? "time" : "tags"
    applyView()
  }
  const chooseSidebarTag = (event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if ((event.target as Element).closest("a[data-listing-tag]")) closeSidebar(true)
  }
  const resizeSidebar = () => {
    if (!sidebar) return
    if (sidebarInitialized || desktopSidebar.matches) sidebar.open = desktopSidebar.matches
    sidebarInitialized = true
    if (desktopSidebar.matches) sidebarSummary?.setAttribute("tabindex", "-1")
    else sidebarSummary?.removeAttribute("tabindex")
  }
  const measureLayout = () => {
    if (!sidebar || !sidebarAnchor || !header) return
    const setProperty = (name: string, value: string) => {
      if (sidebarAnchor.style.getPropertyValue(name) !== value)
        sidebarAnchor.style.setProperty(name, value)
    }
    setProperty("--timeline-header-bottom", `${Math.ceil(header.getBoundingClientRect().bottom)}px`)
    if (search && listingControls) {
      const searchBox = search.getBoundingClientRect()
      setProperty(
        "--listing-search-offset",
        `${searchBox.top - listingControls.getBoundingClientRect().top}px`,
      )
      // Keep the initial rail inside even a short window. Sticky positioning
      // only moves it upwards, so this limit stays safe without scroll work.
      setProperty("--listing-search-start", `${searchBox.top + window.scrollY}px`)
    }
  }
  const layoutResize =
    sidebar && header && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measureLayout)
      : undefined
  const dismissSidebar = (event: PointerEvent) => {
    if (event.target instanceof Node && !sidebar?.contains(event.target)) closeSidebar()
  }
  const escapeSidebar = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      desktopSidebar.matches ||
      !sidebar?.open ||
      document.querySelector(".search-container.active,.global-graph-outer.active")
    )
      return
    closeSidebar(true)
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const update = (matchingRows: HTMLLIElement[], sort: string) => {
    applyView()
    if (view !== "timeline") return
    const signature = `${sort}:${matchingRows.map((row) => row.dataset.noteId).join(",")}`
    if (signature === lastRender) return
    lastRender = signature
    const field = timelineDateField(sort)
    const months = groupTimelineItems(
      matchingRows,
      (row) => row.dataset[field],
      sort.endsWith("-asc") && !sort.startsWith("title-") ? "asc" : "desc",
    )
    const groups = document.createDocumentFragment()
    const options = document.createDocumentFragment()
    const sidebarGroups = document.createDocumentFragment()
    const prompt = document.createElement("option")
    prompt.value = ""
    prompt.textContent = "选择时间"
    options.append(prompt)
    const yearOptions = new Map<string, HTMLOptGroupElement>()
    const yearNavigation = new Map<string, HTMLUListElement>()
    const periodLink = (period: string, title: string, count: number, target: string) => {
      const link = document.createElement("a")
      link.className = "timeline-nav-link"
      link.href = `#timeline-${target}`
      link.dataset.timelineJump = period
      link.setAttribute("data-router-ignore", "")
      link.setAttribute("aria-label", `跳转到${title}，${count} 篇文章`)
      const label = document.createElement("span")
      label.textContent = title
      const total = document.createElement("small")
      total.textContent = String(count)
      link.append(label, total)
      return link
    }
    let entryIndex = 0
    for (const month of months) {
      const section = document.createElement("section")
      section.className = "timeline-month"
      section.id = `timeline-${month.month}`
      if (month.month !== "undated") section.dataset.timelineYear = month.month.slice(0, 4)
      const heading = document.createElement("h2")
      heading.className = "timeline-month-header"
      heading.textContent = month.label
      section.setAttribute("aria-labelledby", `${section.id}-heading`)
      heading.id = `${section.id}-heading`
      const entries = document.createElement("ol")
      entries.className = "timeline-entries"
      for (const row of month.entries) {
        const source = row.querySelector<HTMLAnchorElement>(".article-row")
        if (!source) continue
        const entry = document.createElement("li")
        entry.className = `timeline-entry${entryIndex++ % 2 ? " is-right" : ""}`
        entry.dataset.noteId = row.dataset.noteId
        const card = source.cloneNode(true) as HTMLAnchorElement
        card.classList.remove("article-row")
        card.classList.add("timeline-card")
        const time = card.querySelector("time")
        if (time) {
          time.dateTime = row.dataset[field] ?? ""
          time.textContent = time.dateTime || "日期未记录"
        }
        entry.append(card)
        entries.append(entry)
      }
      section.append(heading, entries)
      groups.append(section)
      const option = document.createElement("option")
      option.value = month.month
      option.textContent = `${month.label} · ${month.entries.length} 篇`
      if (month.month === "undated") options.append(option)
      else {
        const year = month.month.slice(0, 4)
        let yearGroup = yearOptions.get(year)
        if (!yearGroup) {
          yearGroup = document.createElement("optgroup")
          yearGroup.label = `${year} 年`
          const yearOption = document.createElement("option")
          yearOption.value = `year-${year}`
          yearOption.textContent = `${year} 年 · 全年`
          yearGroup.append(yearOption)
          yearOptions.set(year, yearGroup)
          options.append(yearGroup)
        }
        yearGroup.append(option)
      }
      if (navigation) {
        if (month.month === "undated") {
          const unknown = document.createElement("div")
          unknown.className = "timeline-nav-year"
          unknown.append(periodLink(month.month, month.label, month.entries.length, month.month))
          sidebarGroups.append(unknown)
        } else {
          const year = month.month.slice(0, 4)
          let monthList = yearNavigation.get(year)
          if (!monthList) {
            const yearGroup = document.createElement("div")
            yearGroup.className = "timeline-nav-year"
            const count = months
              .filter((item) => item.month.startsWith(`${year}-`))
              .reduce((total, item) => total + item.entries.length, 0)
            const yearLink = periodLink(`year-${year}`, `${year} 年`, count, month.month)
            yearLink.classList.add("timeline-nav-year-link")
            monthList = document.createElement("ul")
            monthList.className = "timeline-nav-months"
            yearGroup.append(yearLink, monthList)
            yearNavigation.set(year, monthList)
            sidebarGroups.append(yearGroup)
          }
          const item = document.createElement("li")
          const link = periodLink(month.month, month.label, month.entries.length, month.month)
          link.querySelector("span")!.textContent = `${Number(month.month.slice(5))} 月`
          item.append(link)
          monthList.append(item)
        }
      }
    }
    const previousMonth = jump.value
    surface.replaceChildren(groups)
    jump.replaceChildren(options)
    if ([...jump.options].some((option) => option.value === previousMonth))
      jump.value = previousMonth
    jump.disabled = months.length === 0
    navigation?.replaceChildren(sidebarGroups)
    highlightPeriod()
    applyView()
  }
  for (const control of controls) control.addEventListener("click", chooseView)
  jump.addEventListener("change", jumpToMonth)
  navigation?.addEventListener("click", choosePeriod)
  sidebarTabs?.addEventListener("click", chooseSidebarTab)
  sidebar?.addEventListener("click", chooseSidebarTag, { capture: true })
  desktopSidebar.addEventListener("change", resizeSidebar)
  layoutResize?.observe(header!)
  if (listingControls) layoutResize?.observe(listingControls)
  if (search) layoutResize?.observe(search)
  if (pageHeader) layoutResize?.observe(pageHeader)
  window.addEventListener("resize", measureLayout, { passive: true })
  document.addEventListener("pointerdown", dismissSidebar, { passive: true })
  document.addEventListener("keydown", escapeSidebar, { capture: true })
  window.addCleanup(() => {
    for (const control of controls) control.removeEventListener("click", chooseView)
    jump.removeEventListener("change", jumpToMonth)
    navigation?.removeEventListener("click", choosePeriod)
    sidebarTabs?.removeEventListener("click", chooseSidebarTab)
    sidebar?.removeEventListener("click", chooseSidebarTag, { capture: true })
    desktopSidebar.removeEventListener("change", resizeSidebar)
    layoutResize?.disconnect()
    window.removeEventListener("resize", measureLayout)
    document.removeEventListener("pointerdown", dismissSidebar)
    document.removeEventListener("keydown", escapeSidebar, { capture: true })
  })
  resizeSidebar()
  measureLayout()
  applyView()
  return { isActive: () => view === "timeline", update, setView }
}
