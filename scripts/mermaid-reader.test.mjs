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
      if (selector.startsWith(".")) return child.className === selector.slice(1)
      if (selector.startsWith("#")) return child.id === selector.slice(1)
      return child.tagName.toLowerCase() === selector
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

function fixture(t, { loadGate, renderGate, fail = false } = {}) {
  const document = new EventTarget()
  document.documentElement = new Element(document, "html")
  document.body = new Element(document, "body")
  document.documentElement.appendChild(document.body)
  document.center = new Element(document, "main")
  document.body.appendChild(document.center)
  document.querySelector = (selector) => (selector === ".center" ? document.center : null)
  document.createElement = (tag) => new Element(document, tag)
  let codes = []
  document.center.querySelectorAll = (selector) => (selector === "code.mermaid" ? codes : [])
  const window = new EventTarget()
  const cleanups = []
  window.addCleanup = (fn) => cleanups.push(fn)
  window.getComputedStyle = () => ({
    getPropertyValue: (name) => name,
    marginLeft: "0",
    marginRight: "0",
  })
  const calls = [],
    failures = [],
    configurations = []
  let loads = 0,
    failNext = fail
  const mermaid = {
    initialize: (config) => configurations.push(config),
    render: async (id, source, host) => {
      calls.push({ id, source, host, connectedInitially: host.isConnected })
      if (renderGate) await renderGate.promise
      assert.ok(host.isConnected, "Mermaid measurement DOM was removed during asynchronous layout")
      assert.equal(
        host.parentElement,
        document.body,
        "Mermaid's renderer cannot query SVG outside body",
      )
      if (failNext) {
        failNext = false
        throw new Error("synthetic syntax failure")
      }
      return { svg: `<svg id="${id}"></svg>` }
    },
  }
  window.__testLoad = async () => {
    loads++
    if (loadGate) await loadGate.promise
    return { default: mermaid }
  }
  const source = runtime.replace(
    /import\(\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@11\.17\.2\/dist\/mermaid\.esm\.min\.mjs"\s*\)/,
    "window.__testLoad()",
  )
  assert.notEqual(source, runtime, "test loader failed to replace the production CDN import")
  vm.runInNewContext(source, {
    document,
    window,
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
    pre.appendChild(modal)
    document.center.appendChild(pre)
    codes.push(code)
    return { pre, code, button, modal, space, content }
  }
  const event = (name) => document.dispatchEvent(new Event(name))
  const leave = () => {
    event("prenav")
    cleanups.splice(0).forEach((fn) => fn())
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
    failures,
    configurations,
    surfaces,
    loads: () => loads,
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

test("leaving during CDN loading discards old diagrams and reuses the import for the next page", async (t) => {
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
  assert.ok(next.code.querySelector("svg"))
  assert.equal(f.loads(), 1)
  assert.equal(f.surfaces().length, 0)
  assert.equal(f.failures.length, 0)
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
  assert.equal(host.isConnected, false)
  assert.equal(f.surfaces().length, 0)
  assert.equal(f.failures.length, 0)
})

test("theme changes serialize rendering, keep raw sources, and only install the latest theme", async (t) => {
  const renderGate = gate()
  const f = fixture(t, { renderGate })
  const note = f.note()
  f.event("nav")
  await flush()
  f.document.documentElement.setAttribute("saved-theme", "dark")
  f.event("themechange")
  assert.equal(f.calls.length, 1)
  renderGate.resolve()
  await flush()
  assert.equal(f.calls.length, 2)
  assert.equal(f.configurations[0].theme, "base")
  assert.equal(f.configurations[1].theme, "dark")
  assert.equal(f.calls[0].source, f.calls[1].source)
  assert.ok(note.code.innerHTML.includes(f.calls[1].id))
  assert.equal(f.surfaces().length, 0)
  assert.equal(f.failures.length, 0)
})

test("diagram directives cannot weaken security or inject HTML labels and configuration CSS", async (t) => {
  const f = fixture(t)
  f.note("graph LR; A-->B")
  f.event("nav")
  await flush()
  const config = f.configurations[0]
  assert.equal(config.securityLevel, "strict")
  assert.equal(config.htmlLabels, false)
  assert.equal(config.flowchart.htmlLabels, false)
  for (const key of [
    "secure",
    "securityLevel",
    "htmlLabels",
    "flowchart",
    "themeCSS",
    "themeVariables",
    "dompurifyConfig",
    "fontFamily",
  ])
    assert.ok(config.secure.includes(key), key)
  assert.equal(config.maxTextSize, 50000)
  assert.equal(config.maxEdges, 300)
  assert.match(runtime, /mermaid@11\.17\.2/)
  assert.doesNotMatch(runtime, /mermaid\/11\.4\.0/)
})

test("duplicate nav/render notifications and repeated expansion do not duplicate renders or controls", async (t) => {
  const f = fixture(t)
  const note = f.note()
  f.event("nav")
  f.event("render")
  f.event("nav")
  await flush()
  assert.equal(f.calls.length, 1)
  for (let index = 0; index < 3; index++) {
    note.button.dispatchEvent(new Event("click"))
    assert.equal(note.modal.classList.contains("active"), true)
    assert.equal(note.space.querySelectorAll(".mermaid-controls").length, 1)
    assert.notEqual(note.content.querySelector("svg").id, note.code.querySelector("svg").id)
    const escape = new Event("keydown")
    Object.defineProperty(escape, "key", { value: "Escape" })
    f.document.dispatchEvent(escape)
    assert.equal(note.modal.classList.contains("active"), false)
    assert.equal(note.space.querySelectorAll(".mermaid-controls").length, 0)
  }
  f.leave()
  note.button.dispatchEvent(new Event("click"))
  assert.equal(note.modal.classList.contains("active"), false)
})

test("current-page errors remain visible and can be retried; failure releases the measurement DOM", async (t) => {
  const f = fixture(t, { fail: true })
  const note = f.note()
  f.event("nav")
  await flush()
  assert.equal(f.failures.length, 1)
  assert.equal(note.pre.querySelector(".mermaid-render-error").getAttribute("role"), "alert")
  assert.equal(f.surfaces().length, 0)
  assert.equal(note.button.getAttribute("aria-busy"), null)
  note.button.dispatchEvent(new Event("click"))
  await flush()
  assert.ok(note.code.querySelector("svg"))
  assert.equal(note.pre.querySelector(".mermaid-render-error"), null)
  assert.equal(note.modal.classList.contains("active"), true)
  assert.equal(f.surfaces().length, 0)
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
  assert.ok(note.code.innerHTML.includes(f.calls[1].id))
  assert.equal(f.failures.length, 0)
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
