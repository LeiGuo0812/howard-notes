export const ARTICLES_PER_PAGE = 20

export type TimelineOrder = "asc" | "desc"

export function timelineDateField(sort: string): "created" | "modified" {
  return sort.startsWith("modified-") ? "modified" : "created"
}

export function timelineMonth(date: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "undated"
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return "undated"
  return date.slice(0, 7)
}

export function timelineMonthLabel(month: string) {
  return month === "undated"
    ? "日期未记录"
    : `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`
}

// Preserve the caller's order within each month: date sorting and title sorting
// share the exact same matching articles as the paginated list.
export function groupTimelineItems<T>(
  items: readonly T[],
  getDate: (item: T) => string | undefined,
  order: TimelineOrder = "desc",
) {
  const months = new Map<string, T[]>()
  for (const item of items) {
    const month = timelineMonth(getDate(item))
    const group = months.get(month) ?? []
    group.push(item)
    months.set(month, group)
  }
  return [...months]
    .sort(([a], [b]) => {
      if (a === "undated") return 1
      if (b === "undated") return -1
      return (order === "asc" ? 1 : -1) * a.localeCompare(b)
    })
    .map(([month, entries]) => ({ month, label: timelineMonthLabel(month), entries }))
}

export function paginateItems<T>(items: T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / ARTICLES_PER_PAGE))
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(pages, requestedPage)) : 1
  const start = (page - 1) * ARTICLES_PER_PAGE
  return { page, pages, start, items: items.slice(start, start + ARTICLES_PER_PAGE) }
}

export function sampleItems<T>(items: T[], count = 3, random = Math.random) {
  const pool = [...items]
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const next = i + Math.floor(random() * (pool.length - i))
    ;[pool[i], pool[next]] = [pool[next], pool[i]]
  }
  return pool.slice(0, count)
}
