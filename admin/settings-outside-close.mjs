// Settings remain a draft when the floating window is tucked away. Capture the
// outside click without consuming it, so links and page controls still work.
const ignoredControls = [
  "[data-maintenance-login]",
  "[data-maintenance-action]",
  "[data-maintenance-status]",
  "[data-maintenance-outside-ignore]",
  ".maintenance-toolbar",
  ".maintenance-progress",
  ".search-container",
  ".global-graph-outer",
  ".article-share-overlay",
  ".howard-diagram-modal",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  "dialog",
].join(",")

export function createSettingsOutsideClose({ host, isActive, onClose, target = document }) {
  let controller = null,
    gesture = null,
    disposed = false
  const active = () => isActive() && host.isConnected && !host.hidden
  const pathOf = (event) => event.composedPath?.() || [event.target]
  function protectedPath(event) {
    const path = pathOf(event)
    return (
      path.includes(host) ||
      host.contains?.(event.target) ||
      path.some((node) => node?.closest?.(ignoredControls))
    )
  }
  function pointerDown(event) {
    if (event.isPrimary === false || event.button !== 0) return
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      protected: !active() || protectedPath(event),
      moved: false,
    }
  }
  function pointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if ((event.clientX - gesture.x) ** 2 + (event.clientY - gesture.y) ** 2 > 64)
      gesture.moved = true
  }
  function pointerCancel(event) {
    if (gesture && event.pointerId === gesture.pointerId) gesture.protected = true
  }
  function click(event) {
    const start = gesture
    gesture = null
    if (!active() || event.defaultPrevented || event.button !== 0 || protectedPath(event)) return
    // A drag/selection can end outside the window. Keyboard activation has no
    // preceding pointer gesture and should use the actual click path instead.
    if (event.detail !== 0 && (start?.protected || start?.moved)) return
    onClose()
  }
  function stop() {
    controller?.abort()
    controller = null
    gesture = null
  }
  return {
    start() {
      if (disposed || controller) return
      controller = new AbortController()
      const options = { capture: true, passive: true, signal: controller.signal }
      target.addEventListener("pointerdown", pointerDown, options)
      target.addEventListener("pointermove", pointerMove, options)
      target.addEventListener("pointercancel", pointerCancel, options)
      target.addEventListener("click", click, options)
    },
    stop,
    destroy() {
      stop()
      disposed = true
    },
  }
}
