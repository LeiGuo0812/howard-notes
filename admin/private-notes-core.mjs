const sorts = new Set(["modified-desc", "modified-asc", "created-desc", "created-asc", "title-asc"])

// Runtime configuration may change the path, but may not make the browser send
// owner credentials to an arbitrary origin. Pages uses the compiled API fallback.
export function privateApiBase(apiBase, siteBase, trustedApiBase) {
  const site = new URL(siteBase)
  const endpoint = new URL(apiBase, site)
  const trusted = new URL(trustedApiBase)
  const normalize = (url) => url.href.replace(/\/$/, "")
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !(
      (endpoint.origin === site.origin &&
        endpoint.pathname.replace(/\/$/, "") === new URL("api/content", site).pathname) ||
      normalize(endpoint) === normalize(trusted)
    )
  )
    throw new Error("私密文章服务配置不正确")
  return normalize(endpoint)
}

export function privateReadingRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) =>
      row?.status === "ACTIVE" &&
      row.article?.published === false &&
      !row.article.draft &&
      !row.article.draftOf &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.article.id),
  )
}

export function privateReadingPage(rows, filters = {}) {
  const query = String(filters.query || "")
    .trim()
    .toLocaleLowerCase()
  const selected = privateReadingRows(rows).filter(({ article }) => {
    if (filters.tag && !article.tags?.includes(filters.tag)) return false
    if (filters.category && article.category !== filters.category) return false
    return (
      !query ||
      [article.title, article.description, article.category, ...(article.tags || [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    )
  })
  const sort = sorts.has(filters.sort) ? filters.sort : "modified-desc"
  selected.sort((a, b) => {
    const title =
      a.article.title.localeCompare(b.article.title, "zh-CN", { numeric: true }) ||
      a.article.id.localeCompare(b.article.id)
    if (sort === "title-asc") return title
    const field = sort.startsWith("created") ? "created" : "modified"
    const date = (article) => String(article[field] || article.created || article.date || "")
    return (sort.endsWith("asc") ? 1 : -1) * date(a.article).localeCompare(date(b.article)) || title
  })
  const pages = Math.max(1, Math.ceil(selected.length / 20))
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(filters.page)) || 1))
  return { rows: selected.slice((page - 1) * 20, page * 20), total: selected.length, page, pages }
}

export function privateNoteUrl(siteBase, id, hash = "") {
  const url = new URL("private/", siteBase)
  if (id) url.searchParams.set("note", id)
  if (hash) url.hash = hash
  return url.href
}

export function privateReadingAnchor(hash) {
  const value = String(hash || "").replace(/^#/, "")
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// A response can paint only while the exact verified session and request epoch
// remain current. Even a fetch implementation ignoring abort cannot revive it.
export function createPrivateReadingGate(getAccess) {
  let epoch = 0,
    identity = null,
    controller = new AbortController(),
    disposed = false
  const key = (access) =>
    access?.account && access?.token ? `${access.account}\0${access.token}` : null
  return {
    sync() {
      const access = getAccess(),
        next = key(access)
      const changed = next !== identity
      if (changed) {
        epoch++
        controller.abort()
        controller = new AbortController()
        identity = next
      }
      return { access: next && !disposed ? access : null, changed }
    },
    begin() {
      return { epoch, identity, signal: controller.signal }
    },
    valid(ticket) {
      return (
        !disposed &&
        !!identity &&
        !ticket.signal.aborted &&
        ticket.epoch === epoch &&
        ticket.identity === identity &&
        key(getAccess()) === identity
      )
    },
    invalidate() {
      epoch++
      controller.abort()
      controller = new AbortController()
    },
    dispose() {
      disposed = true
      epoch++
      identity = null
      controller.abort()
    },
  }
}
