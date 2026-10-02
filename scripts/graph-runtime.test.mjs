import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { build } from "esbuild"
import { Graph } from "@quartz-community/graph"
import { deferGraphRuntime, mountDeferredGraph } from "./lib/graph-runtime.mjs"

class Element {
  constructor(document, tag, graph = false) {
    this.document = document
    this.tagName = tag.toUpperCase()
    this.graph = graph
    this.dataset = {}
    this.attributes = new Map()
    this.isConnected = true
  }
  setAttribute(name, value) {
    this.attributes.set(name, value)
  }
  removeAttribute(name) {
    this.attributes.delete(name)
  }
  closest(selector) {
    return this.graph && selector === ".global-graph-icon" ? this : null
  }
  appendChild(child) {
    child.parent = this
    this.children ||= []
    this.children.push(child)
  }
  remove() {
    this.isConnected = false
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this)
  }
  click() {
    const event = new Event("click", { cancelable: true })
    Object.defineProperty(event, "target", { value: this })
    this.document.dispatchEvent(event)
    if (!event.defaultPrevented) this.action?.()
  }
}
class Document extends EventTarget {
  constructor() {
    super()
    this.head = new Element(this, "head")
    this.body = new Element(this, "body")
    this.button = new Element(this, "button", true)
  }
  createElement(tag) {
    return new Element(this, tag)
  }
  querySelector(selector) {
    return selector === ".global-graph-icon" ? this.button : null
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(t) {
  const names = ["document", "window", "location"]
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  const document = new Document()
  const window = {}
  const storage = new Map()
  window.localStorage = {
    getItem: (name) => storage.get(name) ?? null,
    setItem: (name, value) => storage.set(name, value),
  }
  const location = { href: "https://example.com/howard-notes/notes/first" }
  Object.assign(globalThis, { document, window, location })
  let initializations = 0,
    opens = 0
  const initialize = () => {
    initializations++
    document.button.action = () => opens++
    document.addEventListener("keydown", (event) => {
      if (event.key === "g" && (event.ctrlKey || event.metaKey) && !event.shiftKey) opens++
    })
  }
  mountDeferredGraph(initialize)
  const scripts = () => document.head.children || []
  const loaded = (name, adapterLoaded = true) => {
    const script = scripts().find((script) =>
      script.src.includes(name === "d3" ? "/d3@" : "/pixi.js@"),
    )
    window[name] = {}
    if (name === "PIXI" && adapterLoaded) window.unsafe_eval_js = {}
    script?.onload?.()
  }
  const shortcut = (key = "g", modifiers = { ctrlKey: true }) => {
    const event = new Event("keydown", { cancelable: true })
    Object.defineProperties(
      event,
      Object.fromEntries(
        Object.entries({ key, ...modifiers }).map(([key, value]) => [key, { value }]),
      ),
    )
    document.dispatchEvent(event)
    return event
  }
  t.after(() => {
    for (const script of scripts()) if (script.onerror) script.onerror()
    for (let index = 0; index < names.length; index++) {
      if (originals[index]) Object.defineProperty(globalThis, names[index], originals[index])
      else delete globalThis[names[index]]
    }
  })
  return {
    document,
    window,
    location,
    scripts,
    loaded,
    shortcut,
    counts: () => ({ initializations, opens }),
  }
}

test("the installed Graph adapter preserves upstream rendering and rejects incompatible upgrades", () => {
  const source = Graph().afterDOMLoaded
  const result = deferGraphRuntime(source)
  assert.doesNotThrow(() => new Function(result))
  const algorithmStart = "var nu=new a.Container"
  const algorithmEnd = "var d=[],b=[],t=0"
  assert.equal(
    result.slice(result.indexOf(algorithmStart), result.indexOf(algorithmEnd)),
    source.slice(source.indexOf(algorithmStart), source.indexOf(algorithmEnd)),
    "Graph forces, nodes, labels, zoom, drag and frame rendering must remain unchanged",
  )
  assert.throws(
    () => deferGraphRuntime(source.replace("function r(){", "function renamed(){")),
    /changed/,
  )
  assert.throws(
    () => deferGraphRuntime(source.replace("var qu=await fetchData;", "var qu=await newerData;")),
    /changed/,
  )
})

test("graphs fetch no libraries at startup and replay the first explicit click once", async (t) => {
  const f = fixture(t)
  assert.equal(f.scripts().length, 0)
  f.document.dispatchEvent(new Event("nav"))
  f.document.dispatchEvent(new Event("render"))
  assert.equal(f.scripts().length, 0)
  f.document.button.click()
  assert.equal(f.scripts().length, 2)
  assert.equal(f.document.button.attributes.get("aria-busy"), "true")
  assert.equal(f.document.body.children[0].dataset.state, "working")
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
  assert.equal(f.document.button.attributes.has("aria-busy"), false)
  assert.equal(f.document.body.children.length, 0)
  f.document.button.click()
  f.shortcut()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 3 })
  assert.equal(f.scripts().length, 2)
})

test("the official static Pixi adapter loads before graph initialization under a no-eval CSP", async (t) => {
  const f = fixture(t)
  f.document.button.click()
  f.loaded("d3")
  f.loaded("PIXI", false)
  await tick()
  assert.deepEqual(f.counts(), { initializations: 0, opens: 0 })
  const adapter = f.scripts().find((script) => script.src.endsWith("/dist/packages/unsafe-eval.js"))
  assert.ok(adapter)
  assert.match(adapter.src, /pixi\.js@8\.21\.0/)
  f.window.unsafe_eval_js = {}
  adapter.onload()
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("Ctrl/Meta+G loads on demand while ordinary or Shift-modified keys do not", async (t) => {
  const f = fixture(t)
  f.shortcut("g", {})
  f.shortcut("g", { ctrlKey: true, shiftKey: true })
  assert.equal(f.scripts().length, 0)
  assert.equal(f.shortcut("g", { metaKey: true }).defaultPrevented, true)
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("a second click or Escape cancels opening without duplicate requests", async (t) => {
  const f = fixture(t)
  f.document.button.click()
  f.document.button.click()
  assert.equal(f.scripts().length, 2)
  assert.equal(f.document.button.attributes.has("aria-busy"), false)
  f.document.button.click()
  f.shortcut("Escape", {})
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 0 })
  f.document.button.click()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("navigating during a download initializes the current route without reopening an old dialog", async (t) => {
  const f = fixture(t)
  const original = f.document.button
  original.click()
  f.document.dispatchEvent(new Event("prenav"))
  original.isConnected = false
  f.document.button = new Element(f.document, "button", true)
  f.location.href = "https://example.com/howard-notes/notes/second"
  f.document.dispatchEvent(new Event("nav"))
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 0 })
  assert.equal(original.attributes.has("aria-busy"), false)
  f.document.button.click()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("a graph explicitly requested on the new route can reuse a pending download", async (t) => {
  const f = fixture(t)
  f.document.button.click()
  f.document.dispatchEvent(new Event("prenav"))
  f.document.button.isConnected = false
  f.document.button = new Element(f.document, "button", true)
  f.location.href = "https://example.com/howard-notes/notes/second"
  f.document.dispatchEvent(new Event("nav"))
  f.document.button.click()
  assert.equal(f.scripts().length, 2)
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("library failures leave the current route usable and retry only the failed download", async (t) => {
  const f = fixture(t)
  f.document.button.click()
  f.loaded("d3")
  f.scripts()
    .find((script) => script.src.includes("pixi.js"))
    .onerror()
  await tick()
  assert.deepEqual(f.counts(), { initializations: 0, opens: 0 })
  assert.equal(f.scripts().length, 1)
  assert.equal(f.document.body.children[0].dataset.state, "error")
  f.document.button.click()
  assert.equal(f.scripts().length, 2)
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
  assert.equal(f.document.body.children.length, 0)
})

test("pages without graph controls do not fetch libraries for the graph shortcut", (t) => {
  const f = fixture(t)
  f.document.button = null
  f.shortcut()
  assert.equal(f.scripts().length, 0)
})

test("routes visited before the first graph request retain upstream visited-node colors", async (t) => {
  const f = fixture(t)
  f.document.body.dataset.basepath = "/howard-notes"
  f.location.href = "https://example.com/howard-notes/notes/second/"
  f.document.dispatchEvent(new Event("nav"))
  f.location.href = "https://example.com/howard-notes/topics/index"
  f.document.dispatchEvent(new Event("nav"))
  f.location.href = "https://example.com/howard-notes/"
  f.document.dispatchEvent(new Event("nav"))
  const visits = JSON.parse(f.window.localStorage.getItem("graph-visited"))
  for (const value of ["notes/second", "topics/", "topics/index", "/", ""])
    assert.ok(visits.includes(value))
  assert.equal(f.scripts().length, 0)
  f.document.button.click()
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem("graph-visited")), visits)
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("unavailable visit storage never prevents on-demand graph opening", async (t) => {
  const f = fixture(t)
  f.window.localStorage.getItem = () => {
    throw new Error("Storage unavailable")
  }
  f.document.dispatchEvent(new Event("nav"))
  f.document.button.click()
  f.loaded("d3")
  f.loaded("PIXI")
  await tick()
  assert.deepEqual(f.counts(), { initializations: 1, opens: 1 })
})

test("the actual esbuild keepNames builder emits a self-contained browser adapter", async (t) => {
  const f = fixture(t)
  const bundle = await build({
    entryPoints: ["scripts/lib/graph-runtime.mjs"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    keepNames: true,
  })
  const compiled = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  )
  const script = compiled.deferGraphRuntime(Graph().afterDOMLoaded)
  assert.match(script, /__name/)
  assert.doesNotThrow(() =>
    vm.runInNewContext(script, {
      document: f.document,
      window: f.window,
      location: f.location,
      URL,
      setTimeout,
      clearTimeout,
    }),
  )
  assert.equal(f.scripts().length, 0)
})
