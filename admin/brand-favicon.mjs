import { brandIconSvg } from "../scripts/lib/site-icon-svg.mjs"

// Watch the actual site theme, including live palette previews and SPA updates.
// Updating one data URI requires no network request or per-preset icon files.
export function mountThemeFavicon(doc = document) {
  const root = doc.documentElement
  let link = doc.head.querySelector("link[data-howard-theme-icon]")
  if (!link) {
    link = doc.createElement("link")
    link.rel = "icon"
    link.type = "image/svg+xml"
    link.setAttribute("sizes", "any")
    link.setAttribute("data-howard-theme-icon", "")
    link.setAttribute("data-persist", "")
  }
  const update = () => {
    const settings = {
      brand: {
        name: root.getAttribute("data-site-brand-name") || "Howard",
        mark: root.getAttribute("data-site-brand-mark") || "h.",
      },
      design: {
        palette: root.getAttribute("data-site-palette") || "current",
        accentColor: root.style.getPropertyValue("--site-accent-light").trim(),
        darkAccentColor: root.style.getPropertyValue("--site-accent-dark").trim(),
      },
    }
    const mode = root.getAttribute("saved-theme") === "dark" ? "dark" : "light"
    const href = `data:image/svg+xml,${encodeURIComponent(brandIconSvg(settings, { mode }))}`
    if (link.getAttribute("href") !== href) link.setAttribute("href", href)
    // SPA head replacement can append static fallbacks after this persisted link.
    // Keep the current icon last, without creating duplicate links or observers.
    if (doc.head.lastElementChild !== link) doc.head.appendChild(link)
  }
  update()
  const observer = new doc.defaultView.MutationObserver(update)
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      "saved-theme",
      "style",
      "data-site-palette",
      "data-site-brand-name",
      "data-site-brand-mark",
    ],
  })
  return () => observer.disconnect()
}
