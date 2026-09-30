function setupNoteBrowser() {
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
  const validOrders = [...order.options].map((option) => option.value)
  if (validOrders.includes(params.get("sort") || "")) order.value = params.get("sort")!
  search.value = params.get("q") || ""
  let activity = /^\d{4}-\d{2}-\d{2}$/.test(params.get("activity") || "")
    ? params.get("activity")
    : null
  const update = (writeUrl = true) => {
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
    let visible = 0
    for (const row of sorted) {
      row.hidden =
        !(row.dataset.search || "").toLocaleLowerCase().includes(query) ||
        (!!activity && row.dataset.created !== activity && row.dataset.modified !== activity)
      if (!row.hidden) visible++
      const time = row.querySelector("time")
      if (time) {
        time.dateTime = row.dataset[field] || ""
        time.textContent = time.dateTime
      }
    }
    list.append(...sorted)
    document.querySelector("#listing-count")!.textContent =
      visible === rows.length ? `${visible} 篇` : `${visible} / ${rows.length} 篇`
    document.querySelector<HTMLElement>("#listing-empty")!.hidden = visible > 0
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
      history.replaceState(history.state, "", url)
    }
  }
  const refresh = () => update()
  const clear = () => {
    activity = null
    update()
  }
  const clearButton = document.querySelector<HTMLButtonElement>("#clear-activity-filter")!
  order.addEventListener("change", refresh)
  search.addEventListener("input", refresh)
  clearButton.addEventListener("click", clear)
  window.addCleanup(() => {
    order.removeEventListener("change", refresh)
    search.removeEventListener("input", refresh)
    clearButton.removeEventListener("click", clear)
  })
  update(false)
}
document.addEventListener("nav", setupNoteBrowser)
