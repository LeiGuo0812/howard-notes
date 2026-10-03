// @ts-expect-error Shared browser-safe activity helper is implemented in JavaScript.
import { buildActivity } from "../../../scripts/lib/activity.mjs"

export type HomeNote = [string, string, string, string, string, string, string]
type HomeData = { noteBase: string; listing: string; asOf: string; notes: HomeNote[] }
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
  surface.append(card)
  return surface
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
