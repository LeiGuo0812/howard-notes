import { groupTimelineItems, timelineDateField } from "./browsing"

type TimelineView = "list" | "timeline"

export function setupTimeline({ onViewChange }: { onViewChange: () => void }) {
  const surface = document.querySelector<HTMLElement>("#article-timeline")
  const jump = document.querySelector<HTMLSelectElement>("#timeline-jump")
  const controls = [...document.querySelectorAll<HTMLButtonElement>("[data-listing-view]")]
  if (!surface || !jump || !controls.length) return

  let view: TimelineView =
    new URLSearchParams(location.search).get("view") === "timeline" ? "timeline" : "list"
  let lastRender = ""
  const applyView = () => {
    surface.hidden = view !== "timeline"
    const jumpLabel = jump.closest<HTMLElement>(".timeline-jump")
    if (jumpLabel) jumpLabel.hidden = view !== "timeline"
    else jump.hidden = view !== "timeline"
    for (const button of controls) {
      const selected = button.dataset.listingView === view
      button.setAttribute("aria-pressed", String(selected))
    }
  }
  const setView = (next: TimelineView, writeUrl = true) => {
    if (next !== "list" && next !== "timeline") return
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
  const jumpToMonth = () => {
    if (!jump.value) return
    const selector = jump.value.startsWith("year-")
      ? `[data-timeline-year="${jump.value.slice(5)}"]`
      : `#timeline-${jump.value}`
    surface.querySelector<HTMLElement>(selector)?.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    })
    jump.value = ""
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
    const prompt = document.createElement("option")
    prompt.value = ""
    prompt.textContent = "选择时间"
    options.append(prompt)
    const yearOptions = new Map<string, HTMLOptGroupElement>()
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
    }
    const previousMonth = jump.value
    surface.replaceChildren(groups)
    jump.replaceChildren(options)
    if ([...jump.options].some((option) => option.value === previousMonth))
      jump.value = previousMonth
    jump.disabled = months.length === 0
  }
  for (const control of controls) control.addEventListener("click", chooseView)
  jump.addEventListener("change", jumpToMonth)
  window.addCleanup(() => {
    for (const control of controls) control.removeEventListener("click", chooseView)
    jump.removeEventListener("change", jumpToMonth)
  })
  applyView()
  return { isActive: () => view === "timeline", update, setView }
}
