const modules = new Map()

// Every surface imports the same URL, so the browser shares one renderer,
// configuration queue and lazy Mermaid dependency. No owner data or credentials
// are used to load these public application assets.
export function loadMermaidViewer(siteBase) {
  const login = document.querySelector("[data-maintenance-login]")
  const base = new URL(
    siteBase || (login ? new URL("../", login.href).href : new URL("../", location.href).href),
    location.href,
  )
  if (base.origin !== location.origin) throw new Error("图表组件来源不正确")
  const url = new URL("maintenance-assets/mermaid-viewer.js", base).href
  if (!modules.has(url)) {
    const promise = import(url).catch((error) => {
      modules.delete(url)
      throw error
    })
    modules.set(url, promise)
  }
  return modules.get(url)
}
