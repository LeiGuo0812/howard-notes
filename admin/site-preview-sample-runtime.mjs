import { applyDesignVariables } from "../scripts/lib/site-design.mjs"
import { mountFrostedSpotlight } from "../scripts/lib/frosted-spotlight.mjs"
import { sitePreviewSettings } from "./site-preview-settings.mjs"
import { PREVIEW_SCENES, renderSitePreviewSample } from "./site-preview-sample.mjs"

export function mountSitePreviewSample({ view = window, doc = document } = {}) {
  if (view.parent === view) return () => {}
  const root = doc.getElementById("site-sample-root")
  if (!root) return () => {}
  const listeners = new AbortController()
  const stopSpotlight = mountFrostedSpotlight(root)
  const desktop = view.matchMedia("(min-width: 1240px)")
  const syncReadingTools = () => {
    const tools = root.querySelector(".reading-tools")
    if (tools) tools.open = desktop.matches
  }
  desktop.addEventListener("change", syncReadingTools, { signal: listeners.signal })
  let last = ""
  view.addEventListener(
    "message",
    (event) => {
      if (
        event.source !== view.parent ||
        event.origin !== view.location.origin ||
        event.data?.type !== "howard-layout-preview"
      )
        return
      try {
        const { scene = "home", theme } = event.data
        if (!PREVIEW_SCENES.includes(scene) || !["light", "dark"].includes(theme))
          throw new Error("预览参数不正确。")
        const settings = sitePreviewSettings(event.data.settings)
        const key = JSON.stringify({ settings, scene })
        doc.documentElement.setAttribute("saved-theme", theme)
        applyDesignVariables(doc.documentElement, settings)
        if (key !== last) {
          root.innerHTML = renderSitePreviewSample(settings, scene)
          last = key
          syncReadingTools()
        }
        const surface = root.querySelector(".site-surface")
        if (surface) applyDesignVariables(surface, settings)
        view.parent.postMessage({ type: "howard-preview-applied" }, view.location.origin)
      } catch {
        view.parent.postMessage({ type: "howard-preview-error" }, view.location.origin)
      }
    },
    { signal: listeners.signal },
  )
  root.addEventListener(
    "click",
    (event) => {
      if (event.target.closest?.("a")) event.preventDefault()
    },
    { signal: listeners.signal },
  )
  view.parent.postMessage({ type: "howard-preview-ready" }, view.location.origin)
  return () => {
    listeners.abort()
    stopSpotlight()
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") mountSitePreviewSample()
