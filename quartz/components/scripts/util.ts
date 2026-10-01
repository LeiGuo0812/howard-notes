export function registerEscapeHandler(outsideContainer: HTMLElement | null, cb: () => void) {
  if (!outsideContainer) return
  function click(this: HTMLElement, e: HTMLElementEventMap["click"]) {
    if (e.target !== this) return
    e.preventDefault()
    e.stopPropagation()
    cb()
  }

  function esc(e: HTMLElementEventMap["keydown"]) {
    if (!e.key.startsWith("Esc")) return
    e.preventDefault()
    cb()
  }

  outsideContainer?.addEventListener("click", click)
  window.addCleanup(() => outsideContainer?.removeEventListener("click", click))
  document.addEventListener("keydown", esc)
  window.addCleanup(() => document.removeEventListener("keydown", esc))
}

export function removeAllChildren(node: HTMLElement) {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
}

// AliasRedirect emits HTML redirects which also have the link[rel="canonical"]
// containing the URL it's redirecting to.
// Extracting it here with regex is _probably_ faster than parsing the entire HTML
// with a DOMParser effectively twice (here and later in the SPA code), even if
// way less robust - we only care about our own generated redirects after all.
const canonicalRegex = /<link rel="canonical" href="([^"]*)">/

const pageCache = new Map<string, { time: number; value: Promise<Response> }>()
const CACHE_TTL = 15_000
const CACHE_LIMIT = 6

export function invalidatePageCache() {
  pageCache.clear()
}

export function prefetchPage(url: URL) {
  if (
    url.origin !== location.origin ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  )
    return
  void fetchPage(url).catch(() => {})
}

export async function fetchPage(url: URL): Promise<Response> {
  const key = `${url.origin}${url.pathname}${url.search}`
  const cached = pageCache.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL) return (await cached.value).clone()
  const value = fetch(key, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html")) {
        pageCache.delete(key)
        return response
      }
      // Limit retained HTML, especially for notes containing large embedded code.
      const html = await response.text()
      if (html.length > 350_000) pageCache.delete(key)
      return new Response(html, { status: response.status, headers: response.headers })
    })
    .catch((error) => {
      pageCache.delete(key)
      throw error
    })
  pageCache.delete(key)
  pageCache.set(key, { time: Date.now(), value })
  while (pageCache.size > CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value!)
  return (await value).clone()
}

export async function fetchCanonical(url: URL): Promise<Response> {
  const res = await fetchPage(url)
  // A rendered 404 is the final page, even when its generic canonical differs
  // from the requested note. Alias redirects are successful HTML responses.
  if (!res.ok) return res
  if (!res.headers.get("content-type")?.startsWith("text/html")) {
    return res
  }

  // reading the body can only be done once, so we need to clone the response
  // to allow the caller to read it if it's was not a redirect
  const text = await res.clone().text()
  const [_, redirect] = text.match(canonicalRegex) ?? []
  const canonical = redirect ? new URL(redirect, url) : undefined
  // An ordinary page's own canonical is metadata, not an instruction to fetch twice.
  const normalize = (path: string) => path.replace(/\/index(?:\.html)?$|\/$/g, "")
  return canonical &&
    (canonical.origin !== url.origin || normalize(canonical.pathname) !== normalize(url.pathname))
    ? fetchPage(canonical)
    : res
}
