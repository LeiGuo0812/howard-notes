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
import DOMPurify from "dompurify"
import styles from "../styles/mermaid-viewer.css"
import { mermaidConfiguration } from "./mermaid-theme.mjs"
import { safeDiagramCss } from "./mermaid-svg-style.mjs"

let enginePromise,
  queue = Promise.resolve(),
  serial = 0
const cssRoots = new WeakSet()
const namespace = "http://www.w3.org/2000/svg"

function ensureStyles(root = document) {
  if (cssRoots.has(root)) return
  const style = document.createElement("style")
  style.dataset.howardDiagramStyles = ""
  style.textContent = styles
  ;(root.head || root).appendChild(style)
  cssRoots.add(root)
}
function themeElement(element) {
  return element?.getRootNode?.().host || document.documentElement
}
function configuration(element) {
  const target = themeElement(element)
  const style = getComputedStyle(target)
  return mermaidConfiguration({
    dark:
      (target.getAttribute("saved-theme") ||
        document.documentElement.getAttribute("saved-theme")) === "dark",
    fontFamily: style.getPropertyValue("--bodyFont").trim() || style.fontFamily,
  })
}
export function diagramThemeKey(element) {
  return JSON.stringify(configuration(element))
}
export function observeDiagramTheme(element, callback) {
  let key = diagramThemeKey(element)
  const update = () => {
    const next = diagramThemeKey(element)
    if (key !== next) {
      key = next
      callback()
    }
  }
  const observer = new MutationObserver(update)
  for (const node of new Set([document.documentElement, themeElement(element)]))
    observer.observe(node, { attributes: true, attributeFilter: ["saved-theme", "style", "class"] })
  document.addEventListener("themechange", update)
  return () => {
    observer.disconnect()
    document.removeEventListener("themechange", update)
  }
}
function engine() {
  return (enginePromise ??= import("mermaid")
    .then(({ default: mermaid }) => mermaid)
    .catch((error) => {
      enginePromise = null
      throw error
    }))
}

// Do not let generated SVG or its exported copy perform network requests. Only
// local paint servers and fragment references are meaningful in these diagrams.
export function sanitizeDiagram(svg) {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script", "iframe", "image", "animate", "set"],
  })
  const holder = document.createElement("div")
  holder.innerHTML = clean
  const root = holder.querySelector("svg")
  if (!root) throw new Error("图表输出不正确")
  for (const node of [root, ...root.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      const value = attr.value
      if (attr.name.startsWith("on")) node.removeAttribute(attr.name)
      else if (["href", "xlink:href"].includes(attr.name) && !/^#[\w:.-]+$/.test(value))
        node.removeAttribute(attr.name)
      else if (
        [
          "style",
          "fill",
          "stroke",
          "filter",
          "clip-path",
          "mask",
          "marker-start",
          "marker-mid",
          "marker-end",
        ].includes(attr.name)
      ) {
        const cleaned = safeDiagramCss(value)
        if (cleaned) node.setAttribute(attr.name, cleaned)
        else node.removeAttribute(attr.name)
      }
    }
    if (node.tagName.toLowerCase() === "style") {
      node.textContent = safeDiagramCss(node.textContent)
    }
  }
  root.setAttribute("xmlns", namespace)
  return root.outerHTML
}
export function renderDiagram(
  source,
  { element, isCurrent = () => true, idPrefix = "diagram", signal } = {},
) {
  const config = configuration(element)
  if (typeof source !== "string" || source.length > config.maxTextSize)
    return Promise.reject(new Error("图表源码超过 50,000 字符限制"))
  const current = () => !signal?.aborted && isCurrent()
  const render = async () => {
    if (!current()) return null
    const mermaid = await engine()
    if (!current()) return null
    mermaid.initialize(config)
    // Flowchart image nodes load their source while measuring, before SVG
    // sanitation can run. Inspect the parsed DB (including escaped YAML keys)
    // rather than relying on a source-text pattern.
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
    if (!current()) return null
    if (
      diagram.type.startsWith("flowchart") &&
      diagram.db.getData().nodes.some((node) => node.img || /^image/i.test(node.shape || ""))
    )
      throw new Error("图表不支持外部图片节点，请在正文中插入图片")
    const host = document.createElement("div")
    host.className = "mermaid-measurement"
    host.inert = true
    host.setAttribute("aria-hidden", "true")
    Object.assign(host.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${Math.max(320, Math.min(element?.clientWidth || 1040, 2000))}px`,
      visibility: "hidden",
      pointerEvents: "none",
    })
    document.body.appendChild(host)
    const id = `${idPrefix.replace(/[^\w-]/g, "-")}-${++serial}`
    const removeMeasurement = () => {
      host.remove()
      document.getElementById(`d${id}`)?.remove()
    }
    signal?.addEventListener("abort", removeMeasurement, { once: true })
    try {
      const { svg } = await mermaid.render(id, source, host)
      return current() ? sanitizeDiagram(svg) : null
    } catch (error) {
      if (!current()) return null
      throw error
    } finally {
      signal?.removeEventListener("abort", removeMeasurement)
      removeMeasurement()
    }
  }
  const promise = queue.then(render, render)
  queue = promise.catch(() => {})
  return promise
}

const icons = {
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  fit: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8z",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6",
  copy: "M9 9h11v11H9zM15 5V3H3v12h2",
  download: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
  close: "M5 5l14 14M19 5L5 19",
}
function control(label, icon, action, signal) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "howard-diagram-button"
  button.title = label
  button.setAttribute("aria-label", label)
  button.dataset.diagramAction = icon
  const svg = document.createElementNS(namespace, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.5")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  const path = document.createElementNS(namespace, "path")
  path.setAttribute("d", icons[icon])
  svg.append(path)
  button.append(svg)
  button.addEventListener("click", action, { signal })
  return button
}
function uniqueSvg(svg) {
  const holder = document.createElement("div")
  holder.innerHTML = svg
  const root = holder.querySelector("svg")
  const prefix = `diagram-instance-${++serial}-`
  const ids = new Map()
  for (const el of [root, ...root.querySelectorAll("*")]) if (el.id) ids.set(el.id, prefix + el.id)
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.id) el.id = ids.get(el.id)
    for (const attr of [...el.attributes]) {
      if (attr.name === "id") continue
      let value = attr.value.replace(/url\(#([^)]*)\)/g, (match, id) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match,
      )
      if (value.startsWith("#") && ids.has(value.slice(1))) value = "#" + ids.get(value.slice(1))
      el.setAttribute(attr.name, value)
    }
    if (el.tagName.toLowerCase() === "style")
      el.textContent = el.textContent.replace(/#([\w:-]+)/g, (match, id) =>
        ids.has(id) ? "#" + ids.get(id) : match,
      )
    for (const name of ["aria-labelledby", "aria-describedby"])
      if (el.hasAttribute(name))
        el.setAttribute(
          name,
          el
            .getAttribute(name)
            .split(/\s+/)
            .map((id) => ids.get(id) || id)
            .join(" "),
        )
  }
  return root
}
function viewport(canvas, content, { signal, expanded = false, guard }) {
  let scale = 1,
    x = 0,
    y = 0,
    width = 1,
    height = 1,
    pointers = new Map(),
    drag,
    pinch
  const apply = () => {
    content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }
  const fit = () => {
    if (!guard()) return
    const svg = content.querySelector("svg")
    if (!svg || !canvas.isConnected) return
    const box = svg.viewBox?.baseVal
    width = box?.width || parseFloat(svg.getAttribute("width")) || 800
    height = box?.height || parseFloat(svg.getAttribute("height")) || 400
    svg.style.width = `${width}px`
    svg.style.height = `${height}px`
    if (!expanded)
      canvas.style.height = `${Math.min(440, Math.max(184, ((canvas.clientWidth - 32) * height) / width + 32))}px`
    scale = Math.min(1.35, (canvas.clientWidth - 32) / width, (canvas.clientHeight - 32) / height)
    scale = Math.max(0.08, scale)
    x = (canvas.clientWidth - width * scale) / 2
    y = (canvas.clientHeight - height * scale) / 2
    apply()
  }
  const zoom = (factor, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) => {
    if (!guard()) return
    const next = Math.min(8, Math.max(0.08, scale * factor))
    x = cx - ((cx - x) * next) / scale
    y = cy - ((cy - y) * next) / scale
    scale = next
    apply()
  }
  const point = (event) => {
    const bounds = canvas.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  const measurePinch = () => {
    const [a, b] = [...pointers.values()]
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!guard() || event.button !== 0 || (!expanded && event.pointerType === "touch")) return
      canvas.setPointerCapture(event.pointerId)
      pointers.set(event.pointerId, point(event))
      drag = { ...point(event), left: x, top: y }
      pinch = pointers.size === 2 ? measurePinch() : null
      canvas.style.cursor = "grabbing"
    },
    { signal },
  )
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!guard() || !pointers.has(event.pointerId)) return
      const p = point(event)
      pointers.set(event.pointerId, p)
      if (pointers.size === 2 && pinch) {
        const next = measurePinch()
        zoom(next.distance / Math.max(1, pinch.distance), pinch.x, pinch.y)
        x += next.x - pinch.x
        y += next.y - pinch.y
        pinch = next
      } else if (drag) {
        x = drag.left + p.x - drag.x
        y = drag.top + p.y - drag.y
      }
      apply()
    },
    { signal },
  )
  const end = (event) => {
    pointers.delete(event.pointerId)
    drag = pinch = null
    canvas.style.cursor = "grab"
  }
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(name, end, { signal })
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!guard() || (!expanded && !event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      const p = point(event)
      zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y)
    },
    { signal, passive: false },
  )
  canvas.addEventListener(
    "keydown",
    (event) => {
      if (!guard()) return
      if (
        ["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        event.preventDefault()
      if (event.key === "+" || event.key === "=") zoom(1.2)
      if (event.key === "-") zoom(1 / 1.2)
      if (event.key === "0") fit()
      if (event.key === "ArrowLeft") x += 24
      if (event.key === "ArrowRight") x -= 24
      if (event.key === "ArrowUp") y += 24
      if (event.key === "ArrowDown") y -= 24
      apply()
    },
    { signal },
  )
  const observer = new ResizeObserver(fit)
  observer.observe(canvas)
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect()
      pointers.clear()
      drag = pinch = null
    },
    { once: true },
  )
  fit()
  return { zoom, fit }
}

export function mountDiagram(container, { source, svg, isCurrent = () => true } = {}) {
  ensureStyles(container.getRootNode())
  ensureStyles(document)
  let raw = source,
    markup = svg,
    alive = true,
    modal,
    modalController,
    focusReturn,
    feedbackTimer
  const downloadUrls = new Set()
  const controller = new AbortController(),
    signal = controller.signal
  const guard = () => alive && container.isConnected && isCurrent()
  const theme = () => (configuration(container).themeVariables.darkMode ? "dark" : "light")
  container.classList.add("howard-diagram")
  container.dataset.diagramTheme = theme()
  container.replaceChildren()
  const toolbar = document.createElement("div")
  toolbar.className = "howard-diagram-toolbar"
  const caption = document.createElement("span")
  caption.className = "howard-diagram-caption"
  caption.textContent = "Mermaid"
  toolbar.append(caption)
  const canvas = document.createElement("div")
  canvas.className = "howard-diagram-canvas"
  canvas.tabIndex = 0
  canvas.setAttribute("aria-label", "图表：方向键移动，加减键缩放，0 适应大小")
  const content = document.createElement("div")
  content.className = "howard-diagram-content"
  content.append(uniqueSvg(markup))
  canvas.append(content)
  const status = document.createElement("div")
  status.className = "howard-diagram-status"
  status.setAttribute("role", "status")
  container.append(toolbar, canvas, status)
  const controls = viewport(canvas, content, { signal, guard })
  const feedback = (text) => {
    if (!guard()) return
    status.textContent = text
    clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => {
      if (guard()) status.textContent = ""
    }, 2500)
  }
  const copy = async () => {
    if (!guard()) return
    try {
      await navigator.clipboard.writeText(raw)
      feedback("源码已复制")
    } catch {
      feedback("复制失败，请检查浏览器剪贴板权限")
    }
  }
  const download = () => {
    if (!guard()) return
    const holder = document.createElement("div")
    holder.innerHTML = sanitizeDiagram(markup)
    const exported = holder.querySelector("svg")
    const box = exported.viewBox?.baseVal
    if (box?.width && box?.height) {
      exported.setAttribute("width", String(Math.ceil(box.width)))
      exported.setAttribute("height", String(Math.ceil(box.height)))
    }
    exported.style.maxWidth = "none"
    exported.style.backgroundColor =
      container.dataset.diagramTheme === "dark" ? "#24282e" : "#f2f4f6"
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(exported)], {
        type: "image/svg+xml;charset=utf-8",
      }),
    )
    downloadUrls.add(url)
    const link = document.createElement("a")
    link.href = url
    link.download = "mermaid-diagram.svg"
    link.dataset.routerIgnore = ""
    link.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      downloadUrls.delete(url)
    }, 1000)
    feedback("SVG 已下载")
  }
  const close = (restoreFocus = true) => {
    modalController?.abort()
    modalController = null
    modal?.replaceChildren()
    modal?.remove()
    modal = null
    if (restoreFocus && guard() && focusReturn?.isConnected) focusReturn.focus()
    focusReturn = null
  }
  const open = () => {
    if (!guard()) return
    close(false)
    focusReturn = container.getRootNode().activeElement || document.activeElement
    modalController = new AbortController()
    const activeSignal = modalController.signal
    modal = document.createElement("div")
    modal.className = "howard-diagram-modal"
    modal.dataset.diagramTheme = theme()
    const dialog = document.createElement("div")
    dialog.className = "howard-diagram-dialog"
    dialog.setAttribute("role", "dialog")
    dialog.setAttribute("aria-modal", "true")
    dialog.setAttribute("aria-label", "展开图表")
    const header = document.createElement("div")
    header.className = "howard-diagram-modal-header"
    const title = document.createElement("span")
    title.className = "howard-diagram-caption"
    title.textContent = "Mermaid"
    header.append(title)
    const space = document.createElement("div")
    space.className = "howard-diagram-canvas"
    space.tabIndex = 0
    space.setAttribute("aria-label", "展开图表：拖动或双指缩放")
    const full = document.createElement("div")
    full.className = "howard-diagram-content"
    full.append(uniqueSvg(markup))
    space.append(full)
    dialog.append(header, space)
    modal.append(dialog)
    document.body.append(modal)
    const expanded = viewport(space, full, { signal: activeSignal, expanded: true, guard })
    for (const [label, icon, action] of [
      ["缩小", "minus", () => expanded.zoom(1 / 1.2)],
      ["适应大小", "fit", expanded.fit],
      ["放大", "plus", () => expanded.zoom(1.2)],
      ["复制源码", "copy", copy],
      ["下载 SVG", "download", download],
      ["关闭", "close", close],
    ])
      header.append(control(label, icon, action, activeSignal))
    modal.addEventListener(
      "click",
      (event) => {
        if (event.target === modal) close()
      },
      { signal: activeSignal },
    )
    document.addEventListener(
      "keydown",
      (event) => {
        if (!guard()) return close(false)
        if (event.key === "Escape") {
          event.preventDefault()
          close()
        }
        if (event.key === "Tab") {
          const buttons = [...dialog.querySelectorAll("button"), space]
          const active = document.activeElement
          if (event.shiftKey && active === buttons[0]) {
            event.preventDefault()
            space.focus()
          } else if (!event.shiftKey && active === space) {
            event.preventDefault()
            buttons[0].focus()
          }
        }
      },
      { signal: activeSignal },
    )
    header.querySelector("button").focus()
  }
  for (const [label, icon, action] of [
    ["缩小", "minus", () => controls.zoom(1 / 1.2)],
    ["适应大小", "fit", controls.fit],
    ["放大", "plus", () => controls.zoom(1.2)],
    ["展开图表", "expand", open],
    ["复制源码", "copy", copy],
    ["下载 SVG", "download", download],
  ])
    toolbar.append(control(label, icon, action, signal))
  return {
    update(nextSvg) {
      if (!guard()) return
      markup = nextSvg
      container.dataset.diagramTheme = theme()
      content.replaceChildren(uniqueSvg(markup))
      controls.fit()
      if (modal) open()
    },
    destroy() {
      if (!alive) return
      alive = false
      controller.abort()
      close(false)
      clearTimeout(feedbackTimer)
      for (const url of downloadUrls) URL.revokeObjectURL(url)
      downloadUrls.clear()
      raw = markup = ""
      content.replaceChildren()
      container.replaceChildren()
    },
  }
}
