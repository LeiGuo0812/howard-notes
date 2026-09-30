import { createdDay, modifiedDay, validDay } from "./note-dates.mjs"

const dayMs = 86400000
export const chinaDate = (date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date)

// One note contributes once per day, even if created and modified on that same day.
// These are recorded creation/latest-modification dates, not historical edit counts.
export function buildActivity(articles, now = new Date(), year) {
  const today = chinaDate(now)
  const end = year ? Date.parse(`${year}-12-31T00:00:00Z`) : Date.parse(today + "T00:00:00Z")
  const start = year ? Date.parse(`${year}-01-01T00:00:00Z`) : end - 364 * dayMs
  const counts = new Map()
  for (const article of articles.filter((item) => item.published)) {
    const created = createdDay(article),
      modified = modifiedDay(article)
    for (const date of new Set([created, modified])) {
      if (!validDay(date) || date > today) continue
      const instant = Date.parse(date + "T00:00:00Z")
      if (instant < start || instant > end) continue
      const day = counts.get(date) || { count: 0, created: 0, modified: 0 }
      day.count++
      if (date === created) day.created++
      if (date === modified && date !== created) day.modified++
      counts.set(date, day)
    }
  }
  const first = start - new Date(start).getUTCDay() * dayMs
  const last = end + (6 - new Date(end).getUTCDay()) * dayMs
  const weeks = []
  for (let week = first; week <= last; week += 7 * dayMs) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const instant = week + d * dayMs,
        date = new Date(instant).toISOString().slice(0, 10),
        values = counts.get(date) || { count: 0, created: 0, modified: 0 }
      const count = values.count
      days.push({
        date,
        ...values,
        inRange: instant >= start && instant <= end,
        level: count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4,
      })
    }
    const firstOfMonth = days.find((day) => day.inRange && day.date.endsWith("-01"))
    weeks.push({ month: firstOfMonth ? `${Number(firstOfMonth.date.slice(5, 7))}月` : "", days })
  }
  return {
    asOf: new Date(end).toISOString().slice(0, 10),
    from: new Date(start).toISOString().slice(0, 10),
    total: [...counts.values()].reduce((sum, day) => sum + day.count, 0),
    weeks,
  }
}

export function readActivity(articles, now = new Date()) {
  const today = chinaDate(now)
  const years = [
    ...new Set(
      articles
        .filter((a) => a.published)
        .flatMap((a) => [createdDay(a), modifiedDay(a)])
        .filter((date) => validDay(date) && date <= today)
        .map((date) => date.slice(0, 4)),
    ),
  ]
    .sort()
    .reverse()
  return {
    selected: "recent",
    periods: [
      { id: "recent", label: "近一年", ...buildActivity(articles, now) },
      ...years.map((year) => ({ id: year, label: year, ...buildActivity(articles, now, year) })),
    ],
  }
}
