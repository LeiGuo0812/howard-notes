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
let viewerModule,
  renderQueue = Promise.resolve(),
  currentPage = null
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

function loadViewer() {
  if (!viewerModule) {
    const login = document.querySelector("[data-maintenance-login]")
    const base = login ? new URL("../", login.href) : new URL("/howard-notes/", location.href)
    viewerModule = import(new URL("maintenance-assets/mermaid-viewer.js", base).href).catch(
      (error) => {
        viewerModule = null
        throw error
      },
    )
  }
  return viewerModule
}
function isCurrent(page, generation, code) {
  return currentPage === page && page.generation === generation && code.isConnected
}
function failure(page, state) {
  state.status?.remove()
  state.viewer?.destroy()
  state.viewer = null
  const panel = document.createElement("span")
  panel.className = "mermaid-reader-error"
  panel.setAttribute("role", "status")
  panel.textContent = "图表暂时无法显示"
  const retry = document.createElement("button")
  retry.type = "button"
  retry.textContent = "重试"
  retry.addEventListener("click", () => renderPage(page), { signal: page.controller.signal })
  panel.appendChild(retry)
  state.host.replaceChildren(panel)
  state.status = panel
}
function renderPage(page) {
  if (currentPage !== page) return
  const generation = ++page.generation
  renderQueue = renderQueue.then(async () => {
    if (currentPage !== page || generation !== page.generation) return
    let module
    try {
      module = await loadViewer()
    } catch {
      if (currentPage === page && generation === page.generation)
        for (const state of page.states) failure(page, state)
      return
    }
    if (currentPage !== page || generation !== page.generation) return
    if (!page.themeCleanup)
      page.themeCleanup = module.observeDiagramTheme(page.states[0]?.host, () => renderPage(page))
    const signature = module.diagramThemeKey(page.states[0]?.host)
    for (const state of page.states) {
      const { code, host } = state
      if (state.signature === signature && state.viewer) continue
      if (!isCurrent(page, generation, code)) return
      try {
        const svg = await module.renderDiagram(state.source, {
          element: host,
          idPrefix: "mermaid-reader",
          isCurrent: () => isCurrent(page, generation, code),
        })
        if (!svg || !isCurrent(page, generation, code)) continue
        if (state.viewer) state.viewer.update(svg)
        else
          state.viewer = module.mountDiagram(host, {
            source: state.source,
            svg,
            isCurrent: () => currentPage === page && code.isConnected,
          })
        state.status = null
        state.signature = signature
        code.setAttribute("data-processed", "true")
      } catch {
        if (isCurrent(page, generation, code)) failure(page, state)
      }
    }
  })
}
function leavePage() {
  const page = currentPage
  currentPage = null
  if (!page) return
  page.controller.abort()
  page.themeCleanup?.()
  for (const state of page.states) {
    state.viewer?.destroy()
    state.status?.remove()
    state.host.remove()
    state.code.hidden = false
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
  )
    return
  leavePage()
  if (!codes.length) return
  const page = {
    controller: new AbortController(),
    generation: 0,
    states: codes.map((code) => {
      const pre = code.parentElement
      for (const legacy of pre.querySelectorAll(
        ".expand-button, .clipboard-button, #mermaid-container",
      ))
        legacy.remove()
      pre.classList.add("mermaid-reader-frame")
      code.hidden = true
      const host = document.createElement("div")
      host.className = "mermaid-reader-viewer"
      const status = document.createElement("span")
      status.className = "mermaid-reader-loading"
      status.textContent = "正在显示图表…"
      host.appendChild(status)
      pre.appendChild(host)
      return { code, host, status, source: sourceFor(code) }
    }),
  }
  currentPage = page
  window.addCleanup(() => {
    if (currentPage === page) leavePage()
  })
  renderPage(page)
}

document.addEventListener("prenav", leavePage)
document.addEventListener("nav", mountPage)
document.addEventListener("render", mountPage)
