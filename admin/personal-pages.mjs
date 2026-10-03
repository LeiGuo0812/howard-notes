/** Read owner-only metadata in bounded requests; never accept a truncated catalogue. */
export async function readPersonalPages(
  request,
  path,
  { pageSize = 200, isCurrent = () => true } = {},
) {
  const url = new URL(path, "https://personal.invalid/")
  const key = url.pathname.replace(/^\//, "")
  if (!["articles", "drafts"].includes(key)) throw new Error("不支持的私密列表。")
  url.searchParams.delete("all")
  url.searchParams.set("pageSize", String(pageSize))
  const rows = [],
    seen = new Set()
  let total, first
  const changed = () => new Error("列表在读取期间发生变化，请重新载入。")
  for (let page = 1; ; page++) {
    if (!isCurrent()) throw new DOMException("读取已取消", "AbortError")
    url.searchParams.set("page", String(page))
    const result = await request(`${key}?${url.searchParams}`)
    if (!isCurrent()) throw new DOMException("读取已取消", "AbortError")
    first ||= result
    const values = result[key]
    if (!Array.isArray(values)) throw new Error("私密列表返回信息不完整。")
    if (!Number.isSafeInteger(result.total) || result.total < 0) throw changed()
    total ??= result.total
    if (total !== result.total || result.page !== page || result.pageSize !== pageSize)
      throw changed()
    for (const row of values) {
      const id = key === "articles" ? row.article?.id : row.editorId
      if (!id || seen.has(id)) throw changed()
      seen.add(id)
      rows.push(row)
    }
    if (rows.length === total) return { ...first, [key]: rows, total }
    if (!values.length || rows.length > total || values.length !== pageSize) throw changed()
  }
}
