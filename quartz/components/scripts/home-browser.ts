// @ts-expect-error Shared browser-safe activity helper is implemented in JavaScript.
import { buildActivity } from "../../../scripts/lib/activity.mjs"
import { paletteCategory } from "../../../scripts/lib/site-palettes.mjs"
import { sampleItems } from "./browsing"

export type HomeNote = [string, string, string, string, string, string, string]
type HomeData = {
  noteBase: string
  listing: string
  asOf: string
  notes: HomeNote[]
  featuredIds?: string[]
}
const cache = new WeakMap<Element, HomeData>()
export function homeData(): HomeData | null {
  const element = document.getElementById("home-browse-data")
  if (!element) return null
  if (!cache.has(element)) {
    try {
      cache.set(element, JSON.parse(element.textContent || "null"))
    } catch {
      return null
    }
  }
  return cache.get(element) || null
}
const node = (tag: string, className = "", text = "") => {
  const element = document.createElement(tag)
  element.className = className
  if (text) element.textContent = text
  return element
}
export function homePreview(row: HomeNote, { compact = false, frosted = false } = {}) {
  const data = homeData()!
  const [id, title, created, modified, excerpt, category, categoryKey] = row
  const card = node(
    "a",
    `internal note-preview${compact ? " compact-preview" : ""}${frosted ? " frosted-panel" : ""}`,
  ) as HTMLAnchorElement
  card.href = `${data.noteBase}${id}`
  card.dataset.noPopover = "true"
  card.dataset.noteId = id
  card.dataset.paletteCategory = paletteCategory(categoryKey || category)
  const heading = node("div", "preview-note-heading")
  const time = node("time", "", modified) as HTMLTimeElement
  time.dateTime = modified
  time.title = `创建 ${created} · 更新 ${modified}`
  heading.append(node("h3", "", title), time)
  card.append(heading)
  if (excerpt) card.append(node("p", "", excerpt))
  if (!compact) {
    const tag = node("small", "", category)
    tag.dataset.category = categoryKey
    card.append(tag)
  }
  if (!frosted) return card
  card.dataset.spotlight = ""
  const surface = node("div", "frost-environment lucky-preview-surface")
  surface.dataset.paletteCategory = card.dataset.paletteCategory
  surface.append(card)
  return surface
}
export function curatedNotes(data: HomeData): HomeNote[] {
  const ids = new Set(data.featuredIds || [])
  return data.notes.filter(([id]) => ids.has(id))
}

export function sampleHomeNotes(
  notes: HomeNote[],
  count: number,
  previous: string[] = [],
  random = Math.random,
) {
  let chosen = sampleItems(notes, count, random)
  const previousIds = new Set(previous)
  if (notes.length > chosen.length && chosen.every(([id]) => previousIds.has(id))) {
    // Refresh must change an article whenever the pool can supply a new one.
    chosen = [
      sampleItems(
        notes.filter(([id]) => !previousIds.has(id)),
        1,
        random,
      )[0],
      ...chosen.slice(1),
    ]
  } else if (
    chosen.length > 1 &&
    chosen.length === previous.length &&
    chosen.every(([id], index) => previous[index] === id)
  ) {
    // A small pool can still visibly refresh without inventing duplicate cards.
    chosen = [...chosen.slice(1), chosen[0]]
  }
  return chosen
}

export function mountHomeRecommendations(addCleanup: (cleanup: () => void) => void) {
  const data = homeData()
  if (!data) return () => {}
  const draws: (() => void)[] = []
  for (const [selector, refreshSelector, curated] of [
    ["#random-notes", "#refresh-random-notes", false],
    ["#curated-notes", "#refresh-curated-notes", true],
  ] as const) {
    const container = document.querySelector<HTMLElement>(selector)
    if (!container) continue
    const notes = curated ? curatedNotes(data) : data.notes
    const draw = () => {
      const previous = [...container.querySelectorAll<HTMLElement>(".note-preview")].map(
        (card) => card.dataset.noteId || "",
      )
      const count = Math.max(
        1,
        Math.min(curated ? 8 : 6, Number(container.dataset.count) || (curated ? 4 : 3)),
      )
      const chosen = sampleHomeNotes(notes, count, previous)
      container.replaceChildren(
        ...(chosen.length
          ? chosen.map((note) => homePreview(note, { frosted: true }))
          : [node("p", "empty-list", curated ? "暂无精选文章" : "暂无文章")]),
      )
    }
    const refresh = document.querySelector<HTMLButtonElement>(refreshSelector)
    if (refresh) {
      refresh.disabled = notes.length < 2
      refresh.addEventListener("click", draw)
      addCleanup(() => refresh.removeEventListener("click", draw))
    }
    draws.push(draw)
    draw()
  }
  return () => draws.forEach((draw) => draw())
}
export function selectActivity(year: string) {
  const data = homeData(),
    chart = document.querySelector(".activity-chart")
  if (!data || !chart || !(year === "recent" || /^\d{4}$/.test(year))) return
  const existing = chart.querySelector<HTMLElement>("[data-activity-period]")
  if (existing?.dataset.activityPeriod === year) return
  const period = buildActivity(
    data.notes.map(([id, , created, modified]) => ({ id, created, modified, published: true })),
    new Date(`${data.asOf}T12:00:00+08:00`),
    year === "recent" ? undefined : year,
  )
  const root = node("div", "activity-period")
  root.dataset.activityPeriod = year
  const summary = node("div", "activity-summary")
  summary.append(
    node("span", "", `${period.total} 次笔记活动`),
    node("span", "", `${period.from} — ${period.asOf}`),
  )
  const scroll = node("div", "heatmap-scroll")
  scroll.tabIndex = 0
  scroll.setAttribute("role", "group")
  scroll.setAttribute(
    "aria-label",
    `${year === "recent" ? "近一年" : year}共 ${period.total} 次笔记创建或更新`,
  )
  const weekdays = node("div", "heatmap-weekdays")
  weekdays.setAttribute("aria-hidden", "true")
  weekdays.append(...["一", "三", "五"].map((text) => node("span", "", text)))
  const weeks = node("div", "heatmap-weeks")
  for (const week of period.weeks) {
    const column = node("div", "heatmap-week")
    column.append(node("span", "heatmap-month", week.month))
    for (const day of week.days) {
      const label = `${day.date} · ${day.count} 篇 · 创建 ${day.created} / 更新 ${day.modified}`
      const cell = node(
        day.count > 0 ? "a" : "span",
        `heatmap-day level-${day.level}${day.inRange ? "" : " outside"}${day.count > 0 ? " internal" : ""}`,
      )
      cell.dataset.date = day.date
      cell.dataset.count = String(day.count)
      if (day.inRange) cell.title = label
      if (day.count > 0) {
        ;(cell as HTMLAnchorElement).href = `${data.listing}?activity=${day.date}`
        cell.dataset.noPopover = "true"
        cell.setAttribute("aria-label", label)
      } else cell.setAttribute("aria-hidden", "true")
      column.append(cell)
    }
    weeks.append(column)
  }
  scroll.append(weekdays, weeks)
  root.append(summary, scroll)
  if (existing) existing.replaceWith(root)
  else chart.querySelector(".heatmap-legend")?.before(root)
}
