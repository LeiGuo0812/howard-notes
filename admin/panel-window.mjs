// Floating maintenance windows stay inside the usable viewport; editor state lives elsewhere.
export function constrainWindow(position, size, viewport) {
  const inset = Math.max(0, viewport.inset ?? 12)
  const minimumY = Math.max(inset, viewport.top ?? inset)
  const maximumX = Math.max(inset, viewport.width - size.width - inset)
  const maximumY = Math.max(minimumY, viewport.height - size.height - inset)
  return {
    x: Math.min(maximumX, Math.max(inset, position.x)),
    y: Math.min(maximumY, Math.max(minimumY, position.y)),
  }
}

export function centerWindow(size, viewport) {
  return constrainWindow(
    { x: (viewport.width - size.width) / 2, y: (viewport.height - size.height) / 2 },
    size,
    viewport,
  )
}

const maximizeIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>'
const restoreIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/></svg>'

export function createPanelWindow({ host, heading, caption, toggle, onChange }) {
  let fullscreen = false
  let inline = false
  let position = null
  let drag = null
  let frame = 0

  const canMove = () => !inline && !fullscreen && window.matchMedia("(min-width: 801px)").matches
  const viewport = () => ({
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
    top: 12,
    inset: 12,
  })

  function finishDrag() {
    const pointer = drag?.pointerId
    drag = null
    host.classList.remove("is-dragging")
    if (pointer !== undefined && heading.hasPointerCapture?.(pointer))
      heading.releasePointerCapture(pointer)
  }

  function moveTo(x, y, rect = host.getBoundingClientRect()) {
    position = constrainWindow({ x, y }, rect, viewport())
    host.style.setProperty("--maintenance-window-x", `${position.x}px`)
    host.style.setProperty("--maintenance-window-y", `${position.y}px`)
    host.classList.add("is-floating")
  }

  function clamp() {
    if (!host.isConnected || host.hidden || !canMove() || !position) return
    moveTo(position.x, position.y)
  }

  function queueClamp() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      clamp()
    })
  }

  function updateHeading() {
    const movable = canMove()
    heading.classList.toggle("is-movable", movable)
    caption.tabIndex = movable ? 0 : -1
    if (movable) {
      caption.title = "拖动窗口；也可用方向键移动"
      caption.dataset.tooltip = "拖动窗口"
      caption.setAttribute("aria-description", "使用方向键移动窗口，双击标题可全屏显示")
    } else {
      caption.removeAttribute("title")
      delete caption.dataset.tooltip
      caption.removeAttribute("aria-description")
    }
    toggle.title = fullscreen ? "还原窗口" : "全屏显示"
    toggle.dataset.tooltip = toggle.title
    toggle.dataset.windowAction = fullscreen ? "restore" : "fullscreen"
    toggle.setAttribute("aria-label", toggle.title)
    toggle.setAttribute("aria-pressed", String(fullscreen))
    toggle.innerHTML = fullscreen ? restoreIcon : maximizeIcon
  }

  function setFullscreen(value) {
    finishDrag()
    fullscreen = value
    host.classList.toggle("is-fullscreen", fullscreen)
    updateHeading()
    onChange()
    queueClamp()
  }

  function onPointerDown(event) {
    if (
      !canMove() ||
      event.pointerType === "touch" ||
      !event.isPrimary ||
      event.button !== 0 ||
      event.target.closest("button, summary, a, input, select, textarea, details")
    )
      return
    const rect = host.getBoundingClientRect()
    moveTo(rect.left, rect.top)
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.x,
      top: position.y,
    }
    host.classList.add("is-dragging")
    heading.setPointerCapture(event.pointerId)
    caption.focus({ preventScroll: true })
    event.preventDefault()
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    moveTo(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
    event.preventDefault()
  }

  function onKeyDown(event) {
    if (event.target !== caption || !canMove()) return
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const direction = directions[event.key]
    if (!direction) return
    const rect = host.getBoundingClientRect()
    const distance = event.shiftKey ? 5 : 24
    moveTo(rect.left + direction[0] * distance, rect.top + direction[1] * distance)
    event.preventDefault()
  }

  function onDoubleClick(event) {
    if (event.target === caption && canMove()) setFullscreen(true)
  }

  function onResize() {
    finishDrag()
    updateHeading()
    queueClamp()
  }

  const onToggle = () => setFullscreen(!fullscreen)
  toggle.addEventListener("click", onToggle)
  heading.addEventListener("pointerdown", onPointerDown)
  heading.addEventListener("pointermove", onPointerMove)
  heading.addEventListener("pointerup", finishDrag)
  heading.addEventListener("pointercancel", finishDrag)
  heading.addEventListener("lostpointercapture", finishDrag)
  heading.addEventListener("keydown", onKeyDown)
  heading.addEventListener("dblclick", onDoubleClick)
  window.addEventListener("resize", onResize)
  window.visualViewport?.addEventListener("resize", onResize)
  updateHeading()

  return {
    isFullscreen: () => fullscreen,
    restore: () => setFullscreen(false),
    snapshot() {
      return { fullscreen, position: position && { ...position } }
    },
    adopt(layout) {
      finishDrag()
      const requestedPosition = layout?.position
      const validPosition =
        requestedPosition &&
        Number.isFinite(requestedPosition.x) &&
        Number.isFinite(requestedPosition.y)
      // Measure the ordinary panel before applying fullscreen so that a
      // restored window keeps its own usable position, rather than the
      // fullscreen panel's dimensions clamping it to the viewport edge.
      fullscreen = false
      position = null
      host.classList.remove("is-fullscreen", "is-floating")
      host.style.removeProperty("--maintenance-window-x")
      host.style.removeProperty("--maintenance-window-y")
      updateHeading()
      onChange()
      if (validPosition) moveTo(requestedPosition.x, requestedPosition.y)
      fullscreen = layout?.fullscreen === true
      host.classList.toggle("is-fullscreen", fullscreen)
      updateHeading()
      onChange()
      queueClamp()
    },
    center() {
      finishDrag()
      fullscreen = false
      position = null
      host.classList.remove("is-fullscreen", "is-floating")
      host.style.removeProperty("--maintenance-window-x")
      host.style.removeProperty("--maintenance-window-y")
      updateHeading()
      onChange()
      if (canMove() && host.isConnected && !host.hidden) {
        const rect = host.getBoundingClientRect()
        const centered = centerWindow(rect, viewport())
        moveTo(centered.x, centered.y, rect)
      }
    },
    detach: finishDrag,
    destroy() {
      finishDrag()
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      toggle.removeEventListener("click", onToggle)
      heading.removeEventListener("pointerdown", onPointerDown)
      heading.removeEventListener("pointermove", onPointerMove)
      heading.removeEventListener("pointerup", finishDrag)
      heading.removeEventListener("pointercancel", finishDrag)
      heading.removeEventListener("lostpointercapture", finishDrag)
      heading.removeEventListener("keydown", onKeyDown)
      heading.removeEventListener("dblclick", onDoubleClick)
      window.removeEventListener("resize", onResize)
      window.visualViewport?.removeEventListener("resize", onResize)
    },
    sync(isInline) {
      inline = !!isInline
      host.classList.toggle("is-floating", !!position && !inline)
      host.classList.toggle("is-fullscreen", fullscreen)
      updateHeading()
      queueClamp()
    },
  }
}
