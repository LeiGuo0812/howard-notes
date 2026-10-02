import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { build, transform } from "esbuild"
import { ObsidianFlavoredMarkdown } from "@quartz-community/obsidian-flavored-markdown"
import { adaptMermaidResource } from "./lib/mermaid-reader.mjs"
import { morphWithMeasurements } from "./lib/mermaid-measurement.mjs"

const runtime = await readFile(new URL("./lib/mermaid-reader.inline.js", import.meta.url), "utf8")
const flush = () => new Promise((resolve) => setImmediate(resolve))
const gate = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

class Element extends EventTarget {
  constructor(document, tag) {
    super()
    this.document = document
    this.tagName = tag.toUpperCase()
    this.style = {}
    this.children = []
    this.values = new Map()
    this.clientWidth = 900
    this.clientHeight = 600
    this.textContent = ""
    const classes = new Set()
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    }
    Object.defineProperty(this, "className", {
      get: () => [...classes].join(" "),
      set: (value) => {
        classes.clear()
        for (const item of value.split(/\s+/)) if (item) classes.add(item)
      },
    })
  }
  get isConnected() {
    return this === this.document.documentElement || !!this.parentElement?.isConnected
  }
  get attributes() {
    return [...this.values].map(([name, value]) => ({ name, value }))
  }
  get id() {
    return this.getAttribute("id") || ""
  }
  set id(value) {
    this.setAttribute("id", value)
  }
  get innerHTML() {
    return this.html || ""
  }
  set innerHTML(value) {
    this.html = value
    const svg = new Element(this.document, "svg")
    svg.id = /id="([^"]+)"/.exec(value)?.[1] || "diagram"
    this.replaceChildren(svg)
  }
  setAttribute(name, value) {
    this.values.set(name, value)
  }
  getAttribute(name) {
    return this.values.get(name) ?? null
  }
  removeAttribute(name) {
    this.values.delete(name)
  }
  appendChild(child) {
    child.remove()
    this.children.push(child)
    child.parentElement = this
    return child
  }
  prepend(child) {
    child.remove()
    this.children.unshift(child)
    child.parentElement = this
  }
  after(child) {
    this.parentElement.appendChild(child)
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
      this.parentElement = null
    }
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove()
    for (const child of children) this.appendChild(child)
  }
  querySelectorAll(selector) {
    const children = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")])
    return children.filter((child) => {
      if (selector === "*") return true
      return selector.split(/\s*,\s*/).some((part) => {
        if (part.startsWith(".")) return child.classList.contains(part.slice(1))
        if (part.startsWith("#")) return child.id === part.slice(1)
        return child.tagName.toLowerCase() === part
      })
    })
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  closest(selector) {
    return this.tagName.toLowerCase() === selector ? this : this.parentElement?.closest(selector)
  }
  getBoundingClientRect() {
    return { width: 400, height: 250 }
  }
  cloneNode() {
    const clone = new Element(this.document, this.tagName)
    clone.values = new Map(this.values)
    return clone
  }
}

function fixture(t, { loadGate, renderGate, fail = false, failLoad = false } = {}) {
  const document = new EventTarget()
  document.documentElement = new Element(document, "html")
  document.body = new Element(document, "body")
  document.documentElement.appendChild(document.body)
  document.center = new Element(document, "main")
  document.body.appendChild(document.center)
  const login = { href: "https://notes.test/howard-notes/admin/" }
  document.querySelector = (selector) =>
    selector === ".center"
      ? document.center
      : selector === "[data-maintenance-login]"
        ? login
        : null
  document.createElement = (tag) => new Element(document, tag)
  let codes = []
  document.center.querySelectorAll = (selector) => (selector === "code.mermaid" ? codes : [])
  const window = new EventTarget()
  const cleanups = []
  window.addCleanup = (fn) => cleanups.push(fn)
  const calls = [],
    mounts = [],
    updates = [],
    destroyed = [],
    failures = [],
    loadURLs = [],
    observers = new Set()
  let loads = 0,
    failNext = fail,
    failNextLoad = failLoad
  const themeKey = () => document.documentElement.getAttribute("saved-theme") || "light"
  const viewer = {
    diagramThemeKey: themeKey,
    observeDiagramTheme(element, callback) {
      assert.ok(element.isConnected)
      const subscription = { callback, key: themeKey() }
      observers.add(subscription)
      return () => observers.delete(subscription)
    },
    renderDiagram: async (source, options) => {
      if (!options.isCurrent()) return null
      const theme = themeKey(),
        id = `diagram-${calls.length + 1}`,
        host = new Element(document, "div")
      host.className = "mermaid-measurement"
      host.inert = true
      host.setAttribute("aria-hidden", "true")
      host.style.pointerEvents = "none"
      document.body.appendChild(host)
      calls.push({ id, source, host, options, theme, connectedInitially: host.isConnected })
      try {
        if (renderGate) await renderGate.promise
        assert.ok(host.isConnected, "measurement DOM disconnected during asynchronous layout")
        assert.equal(host.parentElement, document.body)
        if (!options.isCurrent()) return null
        if (failNext) {
          failNext = false
          throw new Error("synthetic syntax failure")
        }
        return `<svg id="${id}" data-theme="${theme}"></svg>`
      } finally {
        host.remove()
      }
    },
    mountDiagram(host, options) {
      const mounted = { host, options }
      mounts.push(mounted)
      host.innerHTML = options.svg
      return {
        update(svg) {
          assert.ok(options.isCurrent())
          updates.push({ host, svg })
          host.innerHTML = svg
        },
        destroy() {
          destroyed.push(mounted)
          host.replaceChildren()
        },
      }
    },
  }
  window.__testLoad = async (url) => {
    loads++
    loadURLs.push(url)
    if (loadGate) await loadGate.promise
    if (failNextLoad) {
      failNextLoad = false
      throw new Error("synthetic module fetch failure")
    }
    return viewer
  }
  const source = runtime.replace(
    /import\(new URL\("maintenance-assets\/mermaid-viewer\.js", base\)\.href\)/,
    'window.__testLoad(new URL("maintenance-assets/mermaid-viewer.js", base).href)',
  )
  assert.notEqual(source, runtime, "test loader failed to replace the shared viewer import")
  vm.runInNewContext(source, {
    document,
    window,
    URL,
    location: { href: "https://notes.test/howard-notes/notes/example" },
    AbortController,
    console: { error: (...args) => failures.push(args) },
  })
  const note = (source = "graph TB; A-->B") => {
    const pre = new Element(document, "pre")
    const code = new Element(document, "code")
    code.textContent = source
    code.setAttribute("data-clipboard", JSON.stringify(source))
    const button = new Element(document, "button")
    button.className = "expand-button"
    const clipboard = new Element(document, "button")
    clipboard.className = "clipboard-button"
    const modal = new Element(document, "div")
    modal.id = "mermaid-container"
    const space = new Element(document, "div")
    space.id = "mermaid-space"
    const content = new Element(document, "div")
    content.className = "mermaid-content"
    space.appendChild(content)
    modal.appendChild(space)
    pre.appendChild(code)
    pre.appendChild(button)
    pre.appendChild(clipboard)
    pre.appendChild(modal)
    document.center.appendChild(pre)
    codes.push(code)
    return { pre, code, button, clipboard, modal, space, content }
  }
  const event = (name) => document.dispatchEvent(new Event(name))
  const leave = ({ runCleanups = true } = {}) => {
    event("prenav")
    if (runCleanups) cleanups.splice(0).forEach((fn) => fn())
    morphWithMeasurements(document.body, null, () => {
      document.center.replaceChildren()
      document.body.replaceChildren(document.center)
    })
    codes = []
  }
  const surfaces = () =>
    document.body.children.filter((child) => child.className === "mermaid-measurement")
  t.after(() => {
    loadGate?.resolve()
    renderGate?.resolve()
    leave()
  })
  return {
    document,
    window,
    note,
    event,
    leave,
    calls,
    mounts,
    updates,
    destroyed,
    failures,
    viewer,
    loadURLs,
    cleanups,
    surfaces,
    loads: () => loads,
    observers: () => observers.size,
    theme(value) {
      document.documentElement.setAttribute("saved-theme", value)
      for (const observer of [...observers]) {
        if (observer.key !== themeKey()) {
          observer.key = themeKey()
          observer.callback()
        }
      }
    },
    failNextRender: () => (failNext = true),
  }
}

test("only the installed Mermaid resource is adapted; other scripts and metadata survive", () => {
  const resources = ObsidianFlavoredMarkdown().externalResources({}).js
  const selected = resources.filter(
    (resource) => adaptMermaidResource(resource, runtime) !== resource,
  )
  assert.equal(selected.length, 1)
  const adapted = adaptMermaidResource(selected[0], runtime)
  assert.equal(adapted.loadTime, selected[0].loadTime)
  assert.equal(adapted.moduleType, selected[0].moduleType)
  assert.match(adapted.script, /Copyright \(c\) 2026 Quartz Community/)
  assert.doesNotThrow(() => new Function(adapted.script))
  assert.equal(
    adaptMermaidResource({ contentType: "external", src: "other.js" }, runtime).src,
    "other.js",
  )
})

test("configuration bundling and minification leave the reading runtime self-contained", async () => {
  const result = await build({
    stdin: {
      contents: 'import runtime from "./scripts/lib/mermaid-reader.inline.js"; export { runtime }',
      resolveDir: process.cwd(),
    },
    write: false,
    bundle: true,
    keepNames: true,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "same-inline-loader-as-quartz",
        setup(builder) {
          builder.onLoad({ filter: /\.inline\.js$/ }, async () => ({
            contents: (await transform(runtime, { minify: true, loader: "ts", format: "esm" }))
              .code,
            loader: "text",
          }))
        },
      },
    ],
  })
  const module = { exports: {} }
  vm.runInNewContext(result.outputFiles[0].text, { module })
  const document = new EventTarget()
  assert.doesNotThrow(() => vm.runInNewContext(module.exports.runtime, { document }))
  assert.ok(!module.exports.runtime.includes("__name("))
  assert.match(module.exports.runtime, /Copyright \(c\) 2026 Quartz Community/)
})

test("leaving during lazy viewer loading discards old diagrams and reuses the self-hosted import", async (t) => {
  const loadGate = gate()
  const f = fixture(t, { loadGate })
  const old = f.note("graph TB; Old-->Removed")
  f.event("nav")
  await flush()
  assert.equal(f.loads(), 1)
  f.leave()
  const next = f.note("graph TB; Current-->Visible")
  f.event("nav")
  loadGate.resolve()
  await flush()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].source, next.code.textContent)
  assert.equal(old.code.innerHTML, "")
  assert.equal(old.code.hidden, false)
  assert.equal(next.code.hidden, true)
  assert.ok(next.pre.querySelector("svg"))
  assert.equal(next.code.querySelector("svg"), null)
  assert.equal(f.loads(), 1)
  assert.deepEqual(f.loadURLs, [
    "https://notes.test/howard-notes/maintenance-assets/mermaid-viewer.js",
  ])
  assert.equal(f.surfaces().length, 0)
  assert.equal(f.failures.length, 0)
})

test("a failed shared-module load can be retried without depending on a third-party CDN", async (t) => {
  const f = fixture(t, { failLoad: true }),
    note = f.note()
  f.event("nav")
  await flush()
  assert.equal(f.loads(), 1)
  const error = note.pre.querySelector(".mermaid-reader-error")
  assert.equal(error.getAttribute("role"), "status")
  error.querySelector("button").dispatchEvent(new Event("click"))
  await flush()
  assert.equal(f.loads(), 2)
  assert.equal(f.calls.length, 1)
  assert.ok(note.pre.querySelector("svg"))
  assert.equal(note.pre.querySelector(".mermaid-reader-error"), null)
  assert.doesNotMatch(runtime, /https:\/\/cdn\.|import\("mermaid"\)/)
})

test("a pending layout retains its connected hidden DOM across SPA departure, then releases it", async (t) => {
  const renderGate = gate()
  const f = fixture(t, { renderGate })
  const old = f.note()
  f.event("nav")
  await flush()
  assert.equal(f.calls.length, 1)
  const host = f.calls[0].host
  assert.equal(host.getAttribute("aria-hidden"), "true")
  assert.equal(host.inert, true)
  assert.equal(host.style.pointerEvents, "none")
  f.leave()
  assert.equal(host.isConnected, true)
  assert.equal(old.code.isConnected, false)
  renderGate.resolve()
  await flush()
  assert.equal(old.code.innerHTML, "")
  assert.equal(f.mounts.length, 0)
  assert.equal(host.isConnected, false)
  assert.equal(f.surfaces().length, 0)
  assert.equal(f.failures.length, 0)
})

test("a theme change during first layout invalidates pending output and retains the original source", async (t) => {
  const renderGate = gate()
  const f = fixture(t, { renderGate })
  const note = f.note()
  f.event("nav")
  await flush()
  f.theme("dark")
  assert.equal(f.calls.length, 1)
  renderGate.resolve()
  await flush()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].theme, "light")
  assert.equal(f.calls[1].theme, "dark")
  assert.equal(f.calls[0].source, f.calls[1].source)
  assert.equal(f.mounts.length, 1)
  assert.ok(note.pre.querySelector("svg").id.includes(f.calls[1].id))
  assert.equal(f.observers(), 1)
  assert.equal(f.surfaces().length, 0)
  assert.equal(f.failures.length, 0)
})

test("public reading delegates rendering and controls to the shared module without modifying source", async (t) => {
  const f = fixture(t)
  const source = "\uFEFFflowchart LR\r\n  A[开始] --> B[保留原文]\r\n",
    note = f.note(source)
  f.event("nav")
  await flush()
  assert.equal(f.calls[0].source, source)
  assert.equal(f.mounts[0].options.source, source)
  assert.equal(note.code.textContent, source)
  assert.equal(note.code.getAttribute("data-clipboard"), JSON.stringify(source))
  assert.equal(f.calls[0].options.element, note.pre.querySelector(".mermaid-reader-viewer"))
  assert.equal(f.calls[0].options.idPrefix, "mermaid-reader")
  assert.equal(f.mounts[0].options.isCurrent(), true)
  f.leave()
  assert.equal(f.mounts[0].options.isCurrent(), false)
})

test("legacy diagrams without clipboard metadata retain their text source across rerenders", async (t) => {
  const f = fixture(t),
    source = "flowchart LR\n A[旧文章] --> B[兼容渲染]",
    note = f.note(source)
  note.code.removeAttribute("data-clipboard")
  f.event("nav")
  await flush()
  f.theme("dark")
  await flush()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].source, source)
  assert.equal(f.calls[1].source, source)
  assert.equal(f.mounts[0].options.source, source)
  assert.equal(note.code.textContent, source)
})

test("duplicate nav/render notifications do not duplicate viewers or theme listeners", async (t) => {
  const f = fixture(t)
  const note = f.note()
  f.event("nav")
  f.event("render")
  f.event("nav")
  await flush()
  assert.equal(f.calls.length, 1)
  assert.equal(f.mounts.length, 1)
  assert.equal(f.observers(), 1)
  assert.equal(note.pre.querySelectorAll(".mermaid-reader-viewer").length, 1)
  assert.equal(note.pre.querySelector(".expand-button"), null)
  assert.equal(note.pre.querySelector(".clipboard-button"), null)
  assert.equal(note.pre.querySelector("#mermaid-container"), null)
  f.event("render")
  await flush()
  assert.equal(f.calls.length, 1)
  f.leave()
  assert.equal(f.destroyed.length, 1)
  assert.equal(f.observers(), 0)
  assert.equal(note.code.hidden, false)
  f.theme("dark")
  await flush()
  assert.equal(f.calls.length, 1)
})

test("one invalid diagram stays retryable and does not block later diagrams", async (t) => {
  const f = fixture(t, { fail: true })
  const note = f.note("invalid first diagram"),
    valid = f.note("flowchart LR; A-->B")
  f.event("nav")
  await flush()
  assert.equal(f.calls.length, 2)
  const error = note.pre.querySelector(".mermaid-reader-error")
  assert.equal(error.getAttribute("role"), "status")
  assert.ok(valid.pre.querySelector("svg"))
  assert.equal(note.code.getAttribute("data-clipboard"), JSON.stringify("invalid first diagram"))
  assert.equal(f.surfaces().length, 0)
  error.querySelector("button").dispatchEvent(new Event("click"))
  await flush()
  assert.equal(f.calls.length, 3, "already successful diagrams should not render again on retry")
  assert.ok(note.pre.querySelector("svg"))
  assert.equal(note.pre.querySelector(".mermaid-reader-error"), null)
  assert.equal(f.mounts.length, 2)
  assert.equal(f.surfaces().length, 0)
})

test("a failed theme rerender preserves its retry panel after destroying the previous viewer", async (t) => {
  const f = fixture(t),
    note = f.note()
  f.event("nav")
  await flush()
  f.failNextRender()
  f.theme("dark")
  await flush()
  assert.equal(f.destroyed.length, 1)
  const error = note.pre.querySelector(".mermaid-reader-error")
  assert.ok(error, "destroying the old viewer must not erase the new retry panel")
  error.querySelector("button").dispatchEvent(new Event("click"))
  await flush()
  assert.equal(f.mounts.length, 2)
  assert.ok(note.pre.querySelector("svg"))
  assert.equal(note.pre.querySelector(".mermaid-reader-error"), null)
})

test("live content updates on a reused code element render the new source, rather than old SVG labels", async (t) => {
  const f = fixture(t)
  const note = f.note()
  f.event("nav")
  await flush()
  note.code.setAttribute("data-clipboard", JSON.stringify("graph LR; New-->Published"))
  f.event("render")
  await flush()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].source, "graph LR; New-->Published")
  assert.ok(note.pre.querySelector("svg").id.includes(f.calls[1].id))
  assert.equal(f.destroyed.length, 1)
  assert.equal(f.mounts.length, 2)
  assert.equal(f.observers(), 1)
  assert.equal(f.failures.length, 0)
})

test("theme updates reuse the viewer and unchanged theme notifications do not repeat layout", async (t) => {
  const f = fixture(t),
    note = f.note()
  f.event("nav")
  await flush()
  f.theme("dark")
  await flush()
  assert.equal(f.calls.length, 2)
  assert.equal(f.mounts.length, 1)
  assert.equal(f.updates.length, 1)
  assert.ok(note.pre.querySelector("svg").id.includes(f.calls[1].id))
  f.theme("dark")
  await flush()
  assert.equal(f.calls.length, 2)
  assert.equal(f.observers(), 1)
})

test("late cleanup from an earlier SPA page cannot destroy the current page viewer", async (t) => {
  const f = fixture(t)
  f.note("flowchart LR; Old-->Page")
  f.event("nav")
  await flush()
  const oldCleanup = f.cleanups[0]
  f.leave({ runCleanups: false })
  const current = f.note("flowchart LR; Current-->Page")
  f.event("nav")
  await flush()
  oldCleanup()
  assert.equal(f.destroyed.length, 1)
  assert.equal(f.mounts.length, 2)
  assert.equal(f.mounts[1].options.isCurrent(), true)
  assert.ok(current.pre.querySelector("svg"))
  assert.equal(f.observers(), 1)
})

test("synchronous body reconciliation preserves active measurements and restores them even on failure", (t) => {
  const f = fixture(t)
  const host = f.document.createElement("div")
  host.className = "mermaid-measurement"
  host.inert = true
  f.document.body.appendChild(host)
  const result = morphWithMeasurements(f.document.body, null, (body) => {
    assert.equal(host.isConnected, true)
    assert.equal(host.parentElement, f.document.documentElement)
    body.replaceChildren(f.document.center)
    return "morph-result"
  })
  assert.equal(result, "morph-result")
  assert.equal(host.parentElement, f.document.body)
  assert.throws(
    () =>
      morphWithMeasurements(f.document.body, null, () => {
        throw new Error("synthetic morph failure")
      }),
    /synthetic morph failure/,
  )
  assert.equal(host.parentElement, f.document.body)
  host.remove()
})
