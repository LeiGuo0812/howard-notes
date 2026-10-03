// The editor and the public site share the same saved theme preference.
export function syncSitePalette(source, target = document.documentElement) {
  if (!source || source === target) return
  const variables = Array.from(source.style)
    .filter((key) => key.startsWith("--site-"))
    .map((key) => [key, source.style.getPropertyValue(key)])
  for (const key of Array.from(target.style))
    if (key.startsWith("--site-palette-")) target.style.removeProperty(key)
  for (const [key, value] of variables) target.style.setProperty(key, value)
  target.setAttribute("data-site-palette", source.getAttribute("data-site-palette") || "current")
}

export function mountAdminTheme(button) {
  const system = window.matchMedia("(prefers-color-scheme: dark)")
  const preference = () => {
    try {
      const saved = localStorage.getItem("theme")
      return saved === "light" || saved === "dark" ? saved : null
    } catch {
      return null
    }
  }
  const apply = (theme) => {
    const dark = theme === "dark"
    document.documentElement.setAttribute("saved-theme", theme)
    button.setAttribute("aria-label", dark ? "切换浅色模式" : "切换深色模式")
    button.title = dark ? "切换浅色模式" : "切换深色模式"
    button.setAttribute("aria-pressed", String(dark))
  }
  const update = () => apply(preference() || (system.matches ? "dark" : "light"))
  const toggle = () => {
    const next = document.documentElement.getAttribute("saved-theme") === "dark" ? "light" : "dark"
    try {
      localStorage.setItem("theme", next)
    } catch {
      // A browser that blocks storage can still switch the current page.
    }
    apply(next)
  }
  const storage = (event) => {
    if (event.key === "theme" || event.key === null) update()
  }
  button.addEventListener("click", toggle)
  system.addEventListener("change", update)
  window.addEventListener("storage", storage)
  update()
  return () => {
    button.removeEventListener("click", toggle)
    system.removeEventListener("change", update)
    window.removeEventListener("storage", storage)
  }
}
