// Original, dependency-free PointerEvent implementation. One delegated mount
// covers new cards; Quartz calls its cleanup before replacing a page.
const mounts = new WeakMap()
export function mountFrostedSpotlight(root) {
  mounts.get(root)?.()
  const doc = root.ownerDocument || root
  const view = doc.defaultView
  if (!view) return () => {}
  const enabled = view.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
  )
  let active = null
  const clear = () => {
    active?.removeAttribute("data-spotlight-active")
    active = null
  }
  const move = (event) => {
    if (!enabled.matches || event.pointerType !== "mouse") return clear()
    const target = event.target?.closest?.("[data-spotlight]")
    if (!target || !root.contains(target)) return clear()
    if (active !== target) clear()
    const rect = target.getBoundingClientRect()
    // Coordinates update immediately, without a position transition or RAF lag.
    target.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`)
    target.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`)
    if (!target.querySelector(":scope > .frost-rim")) {
      const rim = doc.createElement("span")
      rim.className = "frost-rim"
      rim.setAttribute("aria-hidden", "true")
      target.append(rim)
    }
    target.setAttribute("data-spotlight-active", "")
    active = target
  }
  const out = (event) => {
    if (active && !active.contains(event.relatedTarget)) clear()
  }
  const hidden = () => {
    if (doc.hidden) clear()
  }
  root.addEventListener("pointermove", move, { passive: true })
  root.addEventListener("pointerout", out, { passive: true })
  root.addEventListener("pointercancel", clear)
  view.addEventListener("blur", clear)
  view.addEventListener("scroll", clear, { passive: true, capture: true })
  doc.addEventListener("visibilitychange", hidden)
  enabled.addEventListener("change", clear)
  const cleanup = () => {
    clear()
    root.removeEventListener("pointermove", move)
    root.removeEventListener("pointerout", out)
    root.removeEventListener("pointercancel", clear)
    view.removeEventListener("blur", clear)
    view.removeEventListener("scroll", clear, true)
    doc.removeEventListener("visibilitychange", hidden)
    enabled.removeEventListener("change", clear)
    if (mounts.get(root) === cleanup) mounts.delete(root)
  }
  mounts.set(root, cleanup)
  return cleanup
}
