/*!
 * Mermaid reading lifecycle and expansion controls, adapted from
 * @quartz-community/obsidian-flavored-markdown.
 *
 * MIT License
 * Copyright (c) 2026 Quartz Community
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
let mermaidModule,
  renderQueue = Promise.resolve(),
  currentPage = null,
  sequence = 0
const originalSources = new WeakMap()

function sourceFor(code) {
  const clipboardSource = code.getAttribute("data-clipboard")
  const saved = originalSources.get(code)
  if (saved && saved.clipboardSource === clipboardSource) return saved.source
  let source
  try {
    const clipboard = JSON.parse(clipboardSource)
    if (typeof clipboard === "string") source = clipboard
  } catch {
    // Older exported notes can lack the JSON source attribute.
  }
  source ??= saved?.source ?? code.textContent ?? ""
  originalSources.set(code, { clipboardSource, source })
  return source
}

function configuration() {
  const style = window.getComputedStyle(document.documentElement)
  const color = (name) => style.getPropertyValue(name)
  return {
    startOnLoad: false,
    securityLevel: "loose",
    theme: document.documentElement.getAttribute("saved-theme") === "dark" ? "dark" : "base",
    themeVariables: {
      fontFamily: color("--codeFont"),
      primaryColor: color("--light"),
      primaryTextColor: color("--darkgray"),
      primaryBorderColor: color("--tertiary"),
      lineColor: color("--darkgray"),
      secondaryColor: color("--secondary"),
      tertiaryColor: color("--tertiary"),
      clusterBkg: color("--light"),
      edgeLabelBackground: color("--highlight"),
    },
  }
}

function loadMermaid() {
  mermaidModule ??=
    import("https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.esm.min.mjs").catch(
      (error) => {
        mermaidModule = null
        throw error
      },
    )
  return mermaidModule
}

function isCurrent(page, generation, code) {
  return currentPage === page && page.generation === generation && code.isConnected
}

function measuringSurface(code) {
  const host = document.createElement("div")
  host.className = "mermaid-measurement"
  host.setAttribute("aria-hidden", "true")
  host.inert = true
  const width = Math.max(
    1,
    Math.min(code.parentElement?.clientWidth || document.documentElement.clientWidth || 1024, 2000),
  )
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${width}px`,
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
  })
  // Mermaid's flow renderer queries below body during layout. The SPA adapter
  // keeps this surface connected while it synchronously reconciles the body.
  document.body.appendChild(host)
  return host
}

function cloneDiagram(svg) {
  const clone = svg.cloneNode(true)
  const identifiers = new Map()
  const elements = [clone, ...clone.querySelectorAll("*")]
  const prefix = `mermaid-expanded-${++sequence}-`
  for (const element of elements) {
    if (element.id) identifiers.set(element.id, `${prefix}${element.id}`)
  }
  for (const element of elements) {
    if (element.id) element.id = identifiers.get(element.id)
    for (const attribute of [...element.attributes]) {
      if (attribute.name === "id") continue
      let value = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id) =>
        identifiers.has(id) ? `url(#${identifiers.get(id)})` : match,
      )
      if (value.startsWith("#") && identifiers.has(value.slice(1))) {
        value = `#${identifiers.get(value.slice(1))}`
      }
      element.setAttribute(attribute.name, value)
    }
    if (element.tagName.toLowerCase() === "style") {
      element.textContent = element.textContent.replace(/#([\w:-]+)/g, (match, id) =>
        identifiers.has(id) ? `#${identifiers.get(id)}` : match,
      )
    }
  }
  return clone
}

function panZoom(space, content) {
  const controller = new AbortController()
  const signal = controller.signal
  let scale = 1,
    pan = { x: 0, y: 0 },
    dragging = false,
    start = { x: 0, y: 0 }
  const transform = () => {
    content.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`
  }
  const reset = () => {
    const svg = content.querySelector("svg")
    if (!svg || !space.isConnected) return
    const bounds = svg.getBoundingClientRect()
    pan = {
      x: (space.clientWidth - bounds.width / scale) / 2,
      y: (space.clientHeight - bounds.height / scale) / 2,
    }
    scale = 1
    transform()
  }
  const zoom = (amount) => {
    const next = Math.min(3, Math.max(0.5, scale + amount))
    const bounds = content.getBoundingClientRect()
    pan.x -= (bounds.width / 2) * (next - scale)
    pan.y -= (bounds.height / 2) * (next - scale)
    scale = next
    transform()
  }
  const begin = (x, y) => {
    dragging = true
    start = { x: x - pan.x, y: y - pan.y }
    space.style.cursor = "grabbing"
  }
  const move = (event, x, y) => {
    if (!dragging) return
    event.preventDefault()
    pan = { x: x - start.x, y: y - start.y }
    transform()
  }
  const end = () => {
    dragging = false
    space.style.cursor = "grab"
  }
  space.addEventListener(
    "mousedown",
    (event) => {
      if (event.button === 0 && !event.target.closest("button")) begin(event.clientX, event.clientY)
    },
    { signal },
  )
  document.addEventListener("mousemove", (event) => move(event, event.clientX, event.clientY), {
    signal,
  })
  document.addEventListener("mouseup", end, { signal })
  space.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 1 && !event.target.closest("button")) {
        begin(event.touches[0].clientX, event.touches[0].clientY)
      }
    },
    { signal, passive: true },
  )
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 1) {
        move(event, event.touches[0].clientX, event.touches[0].clientY)
      }
    },
    { signal, passive: false },
  )
  document.addEventListener("touchend", end, { signal })
  window.addEventListener("resize", reset, { signal })
  const controls = document.createElement("div")
  controls.className = "mermaid-controls"
  for (const [label, action] of [
    ["−", () => zoom(-0.1)],
    ["Reset", reset],
    ["+", () => zoom(0.1)],
  ]) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.className = "mermaid-control-button"
    button.addEventListener("click", action, { signal })
    controls.appendChild(button)
  }
  space.appendChild(controls)
  space.style.cursor = "grab"
  reset()
  return () => {
    controller.abort()
    controls.remove()
    content.replaceChildren()
  }
}

function bindExpansion(page, state) {
  const { code } = state
  const pre = code.parentElement
  const button = pre?.querySelector(".expand-button")
  const modal = pre?.querySelector("#mermaid-container")
  const space = modal?.querySelector("#mermaid-space")
  const content = space?.querySelector(".mermaid-content")
  if (!button || !modal || !space || !content) return
  state.button = button
  const clipboard = pre.querySelector(".clipboard-button")
  if (clipboard) {
    const style = window.getComputedStyle(clipboard)
    const width =
      clipboard.offsetWidth +
      (parseFloat(style.marginLeft) || 0) +
      (parseFloat(style.marginRight) || 0)
    button.style.right = `calc(${width}px + 0.3rem)`
    pre.prepend(button)
  }
  let cleanupZoom = null
  state.close = () => {
    state.pendingOpen = false
    modal.classList.remove("active")
    cleanupZoom?.()
    cleanupZoom = null
  }
  state.open = () => {
    if (currentPage !== page || !code.isConnected) return
    const svg = code.querySelector("svg")
    if (!svg) {
      state.pendingOpen = true
      if (state.failed) renderPage(page)
      return
    }
    cleanupZoom?.()
    content.replaceChildren(cloneDiagram(svg))
    modal.classList.add("active")
    state.pendingOpen = false
    cleanupZoom = panZoom(space, content)
  }
  const signal = page.controller.signal
  button.addEventListener("click", state.open, { signal })
  modal.addEventListener(
    "click",
    (event) => {
      if (event.target === modal) state.close()
    },
    { signal },
  )
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") state.close()
    },
    { signal },
  )
  state.refreshOpen = () => {
    if (state.pendingOpen || modal.classList.contains("active")) state.open()
  }
}

function renderFailure(state, error) {
  state.failed = true
  state.pendingOpen = false
  state.error?.remove()
  const message = document.createElement("span")
  message.className = "mermaid-render-error"
  message.setAttribute("role", "alert")
  message.textContent = "图表渲染失败，请点击放大按钮重试。"
  state.code.after(message)
  state.error = message
  // Actual current-page failures stay visible and diagnosable. The DOM race is
  // prevented by the connected measurement surface, rather than swallowed here.
  console.error("Mermaid diagram rendering failed", error)
}

function renderPage(page) {
  if (currentPage !== page) return
  const generation = ++page.generation
  const config = configuration()
  const signature = JSON.stringify(config)
  for (const state of page.states) {
    if (state.signature === signature && state.code.querySelector("svg")) continue
    state.button?.setAttribute("aria-busy", "true")
    renderQueue = renderQueue.then(async () => {
      const { code } = state
      if (!isCurrent(page, generation, code)) return
      let host
      try {
        const { default: mermaid } = await loadMermaid()
        if (!isCurrent(page, generation, code)) return
        host = measuringSurface(code)
        mermaid.initialize(config)
        const { svg, bindFunctions } = await mermaid.render(
          `mermaid-reader-${++sequence}`,
          state.source,
          host,
        )
        if (!isCurrent(page, generation, code)) return
        code.innerHTML = svg
        code.setAttribute("data-processed", "true")
        bindFunctions?.(code)
        state.signature = signature
        state.failed = false
        state.error?.remove()
        state.error = null
        state.refreshOpen?.()
      } catch (error) {
        if (isCurrent(page, generation, code)) renderFailure(state, error)
      } finally {
        host?.remove()
        if (isCurrent(page, generation, code)) state.button?.removeAttribute("aria-busy")
      }
    })
  }
}

function leavePage() {
  const page = currentPage
  currentPage = null
  if (!page) return
  page.controller.abort()
  for (const state of page.states) {
    state.close?.()
    state.button?.removeAttribute("aria-busy")
    state.error?.remove()
  }
}

function mountPage() {
  const codes = [...(document.querySelector(".center")?.querySelectorAll("code.mermaid") || [])]
  if (
    currentPage &&
    codes.length === currentPage.states.length &&
    codes.every(
      (code, index) =>
        currentPage.states[index].code === code &&
        currentPage.states[index].source === sourceFor(code),
    )
  ) {
    return
  }
  leavePage()
  if (!codes.length) return
  const page = {
    controller: new AbortController(),
    generation: 0,
    states: codes.map((code) => ({ code, source: sourceFor(code) })),
  }
  currentPage = page
  for (const state of page.states) bindExpansion(page, state)
  window.addCleanup(() => {
    if (currentPage === page) leavePage()
  })
  renderPage(page)
}

document.addEventListener("prenav", leavePage)
document.addEventListener("nav", mountPage)
document.addEventListener("render", mountPage)
document.addEventListener("themechange", () => {
  if (currentPage) renderPage(currentPage)
})
