export function validDay(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  )
}

export function parseNoteDate(value) {
  if (value instanceof Date) value = value.toISOString()
  if (typeof value !== "string" || !value.trim()) return null
  let text = value.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
  if (!/\d{4}/.test(text)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDay(text) ? text : null
  // Obsidian's natural-language dates without a zone refer to the owner's China time.
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(text)) {
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) text = text.replace(" ", "T") + "+08:00"
    else text += " GMT+0800"
  }
  const instant = Date.parse(text)
  if (!Number.isFinite(instant)) return null
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(instant),
  )
  return validDay(day) ? day : null
}

export function sourceDates(data) {
  return {
    created: parseNoteDate(data["date created"] ?? data.created ?? data.creation_date),
    modified: parseNoteDate(
      data["date modified"] ?? data["date updated"] ?? data.modified ?? data.updated,
    ),
  }
}

export const createdDay = (article) => article.created || article.date
export const modifiedDay = (article) => article.modified || createdDay(article)

export function sortNotes(articles, order = "modified-desc") {
  const compareTitle = (a, b) =>
    a.title.localeCompare(b.title, "zh-CN", { numeric: true }) || a.id.localeCompare(b.id)
  return [...articles].sort((a, b) => {
    if (order === "title-asc") return compareTitle(a, b)
    if (order === "title-desc") return -compareTitle(a, b)
    const field = order.startsWith("created") ? createdDay : modifiedDay
    const direction = order.endsWith("asc") ? 1 : -1
    return direction * field(a).localeCompare(field(b)) || compareTitle(a, b)
  })
}
