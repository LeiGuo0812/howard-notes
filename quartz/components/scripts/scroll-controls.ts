const mountedControls = new WeakMap<HTMLElement, () => void>()

export function setupPageScrollControls() {
  const controls = document.querySelector<HTMLElement>(".reading-scroll-controls")
  if (!controls) return
  // Runtime content updates may mount the same page again. Keep one click
  // handler, and let the normal SPA cleanup release the current controls.
  mountedControls.get(controls)?.()
  let bottomTracking: (() => void) | undefined
  const stopBottomTracking = () => {
    bottomTracking?.()
    bottomTracking = undefined
  }
  const behavior = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
  const jump = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>("button[data-scroll]")
    if (!button || !controls.contains(button)) return
    stopBottomTracking()
    const page = document.scrollingElement ?? document.documentElement
    let target =
      button.dataset.scroll === "top" ? 0 : Math.max(0, page.scrollHeight - page.clientHeight)
    window.scrollTo({ top: target, behavior: behavior() })
    if (button.dataset.scroll !== "bottom" || typeof ResizeObserver === "undefined") return
    // Diagrams and lazy media can settle while the jump is in progress.
    // Follow only these late layout changes, for at most three seconds;
    // any new user interaction or navigation gives scrolling back at once.
    let tracking = true
    const observer = new ResizeObserver(() => {
      if (!tracking || !controls.isConnected) return
      const next = Math.max(0, page.scrollHeight - page.clientHeight)
      if (next === target) return
      target = next
      window.scrollTo({ top: target, behavior: behavior() })
    })
    const interruptEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const
    const interruptOptions = { capture: true, passive: true }
    const timeout = window.setTimeout(stopBottomTracking, 3000)
    bottomTracking = () => {
      tracking = false
      observer.disconnect()
      window.clearTimeout(timeout)
      for (const name of interruptEvents)
        document.removeEventListener(name, stopBottomTracking, interruptOptions)
    }
    observer.observe(document.body)
    for (const name of interruptEvents)
      document.addEventListener(name, stopBottomTracking, interruptOptions)
  }
  controls.addEventListener("click", jump)
  const dispose = () => {
    stopBottomTracking()
    controls.removeEventListener("click", jump)
    if (mountedControls.get(controls) === dispose) mountedControls.delete(controls)
  }
  mountedControls.set(controls, dispose)
  window.addCleanup(dispose)
}
