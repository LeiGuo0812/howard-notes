export const ARTICLES_PER_PAGE = 20

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
