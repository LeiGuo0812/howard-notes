import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import path from "node:path"
import { build } from "esbuild"

const scripts = path.resolve("quartz/components/scripts")
const bundleCache = new Map()
const tick = () => new Promise((resolve) => setImmediate(resolve))
async function settle() {
  for (let i = 0; i < 4; i++) await tick()
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

class TrackedTarget extends EventTarget {
  listeners = new Map()
  addEventListener(type, listener, options) {
    const set = this.listeners.get(type) || new Set()
    set.add(listener)
    this.listeners.set(type, set)
    super.addEventListener(type, listener, options)
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener)
    super.removeEventListener(type, listener, options)
  }
  emit(type, values = {}) {
    const event = new Event(type, { cancelable: true })
    for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value })
    this.dispatchEvent(event)
  }
  listenerCount(type) {
    return this.listeners.get(type)?.size || 0
  }
}
class Element extends TrackedTarget {
  constructor(document, tag) {
    super()
    this.document = document
    this.tagName = tag.toLowerCase()
    this.children = []
    this.dataset = {}
    this.attributes = new Map()
    this.style = {}
    this.className = ""
    this.hidden = false
    this.value = ""
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => {
        this.className = [
          ...new Set([...this.className.split(/\s+/).filter(Boolean), ...names]),
        ].join(" ")
      },
      remove: (...names) => {
        this.className = this.className
          .split(/\s+/)
          .filter((name) => !names.includes(name))
          .join(" ")
      },
      toggle: (name, force) => {
        const value = force ?? !this.classList.contains(name)
        if (value) this.classList.add(name)
        else this.classList.remove(name)
        return value
      },
    }
  }
  get isConnected() {
    for (let node = this; node; node = node.parent) if (node === this.document) return true
    return false
  }
  get href() {
    const value = this.attributes.get("href")
    return value ? new URL(value, "https://example.com").href : ""
  }
  set href(value) {
    this.attributes.set("href", value)
  }
  get pathname() {
    return new URL(this.href).pathname
  }
  get textContent() {
    return (this.text || "") + this.children.map((child) => child.textContent).join("")
  }
  set textContent(value) {
    this.replaceChildren()
    this.text = String(value)
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === "id") this.id = String(value)
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }
  removeAttribute(name) {
    this.attributes.delete(name)
  }
  append(...values) {
    for (let value of values) {
      if (typeof value === "string") {
        const text = new Element(this.document, "#text")
        text.text = value
        value = text
      }
      value.remove()
      value.parent = this
      this.children.push(value)
    }
  }
  appendChild(value) {
    this.append(value)
    return value
  }
  replaceChildren(...values) {
    for (const child of this.children) child.parent = undefined
    this.children = []
    this.text = ""
    this.append(...values)
  }
  remove() {
    if (this.parent?.children)
      this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = undefined
  }
  after(value) {
    value.remove()
    value.parent = this.parent
    this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, value)
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      part = part.trim()
      if (part.startsWith(".")) return this.classList.contains(part.slice(1))
      if (part.startsWith("#")) return this.id === part.slice(1)
      if (part.startsWith("[")) {
        const name = part.slice(1, -1)
        return name === "id" ? Boolean(this.id) : this.attributes.has(name)
      }
      const [tag, className] = part.split(".")
      return this.tagName === tag && (!className || this.classList.contains(className))
    })
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  closest(selector) {
    for (let node = this; node instanceof Element; node = node.parent)
      if (node.matches(selector)) return node
    return null
  }
  contains(value) {
    for (let node = value; node; node = node.parent) if (node === this) return true
    return false
  }
  focus() {
    this.document.focused = this
  }
  scrollIntoView() {}
  scroll() {}
}
class Document extends TrackedTarget {
  constructor() {
    super()
    this.body = new Element(this, "body")
    this.body.parent = this
  }
  createElement(tag) {
    return new Element(this, tag)
  }
  createDocumentFragment() {
    return new Element(this, "#fragment")
  }
  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector)
  }
  querySelector(selector) {
    return this.body.querySelector(selector)
  }
  getElementById(id) {
    return this.querySelectorAll("[id]").find((node) => node.id === id) || null
  }
  getElementsByClassName(name) {
    return this.querySelectorAll("." + name)
  }
}
class DOMParser {
  parseFromString(html) {
    const doc = new Document()
    const hint = doc.createElement("div")
    hint.className = "popover-hint"
    hint.textContent = html
    doc.body.append(hint)
    return doc
  }
}
function searchWidget(document) {
  const widget = document.createElement("div")
  widget.className = "search"
  const container = document.createElement("div")
  container.className = "search-container"
  const button = document.createElement("button")
  button.className = "search-button"
  const input = document.createElement("input")
  input.className = "search-bar"
  const layout = document.createElement("div")
  layout.className = "search-layout"
  layout.dataset.preview = "true"
  container.append(input, layout)
  widget.append(button, container)
  document.body.append(widget)
  return { widget, container, button, input, layout }
}
async function compile(kind) {
  if (bundleCache.has(kind)) return bundleCache.get(kind)
  const entry = path.join(scripts, kind === "cache" ? "util.ts" : kind + ".inline.ts")
  const contents =
    kind === "cache"
      ? "import * as api from " + JSON.stringify(entry) + "; globalThis.cacheApi = api"
      : "import " + JSON.stringify(entry)
  const result = await build({
    stdin: { contents, resolveDir: scripts, sourcefile: "cache-lifecycle-fixture.mjs" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    plugins: [
      {
        name: "browser-boundaries",
        setup(builder) {
          if (kind !== "cache") {
            builder.onResolve({ filter: /^\.\/util$/ }, () => ({
              path: "controlled-network",
              namespace: "fixture",
            }))
            builder.onLoad({ filter: /^controlled-network$/, namespace: "fixture" }, () => ({
              resolveDir: scripts,
              contents:
                "export const fetchCanonical = globalThis.fetchCanonical; export { registerEscapeHandler } from " +
                JSON.stringify(path.join(scripts, "util.ts")),
            }))
          }
          builder.onResolve({ filter: /^@floating-ui\/dom$/ }, () => ({
            path: "position",
            namespace: "fixture",
          }))
          builder.onLoad({ filter: /^position$/, namespace: "fixture" }, () => ({
            contents:
              "export const computePosition = async()=>({x:0,y:0}); export const flip=()=>({}); export const inline=()=>({}); export const shift=()=>({})",
          }))
        },
      },
    ],
  })
  const code = result.outputFiles[0].text
  bundleCache.set(kind, code)
  return code
}
async function fixture(kind) {
  const document = new Document(),
    cleanups = [],
    requests = [],
    timers = new Map()
  let nextTimer = 0,
    index = Promise.resolve({
      "notes/example": { title: "note", content: "Current index", tags: [] },
    }),
    indexReads = 0
  const widget = kind === "runtime-search" ? searchWidget(document) : undefined
  const context = {
    document,
    Event,
    Node: Element,
    DOMParser,
    URL,
    Response,
    location: { origin: "https://example.com" },
    navigator: {},
    console,
    window: { addCleanup: (cleanup) => cleanups.push(cleanup) },
    setTimeout: (callback) => {
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout: (timer) => timers.delete(timer),
    fetch: (url) => {
      const response = deferred()
      requests.push({ url, ...response })
      return response.promise
    },
    fetchCanonical: (url) => {
      const response = deferred()
      requests.push({ url: url.href, ...response })
      return response.promise
    },
  }
  Object.defineProperty(context, "fetchData", {
    get: () => {
      indexReads++
      return index
    },
  })
  const vmContext = vm.createContext(context)
  vm.runInContext(await compile(kind), vmContext)
  return {
    document,
    requests,
    widget,
    context,
    setIndex: (promise) => {
      index = promise
    },
    indexReads: () => indexReads,
    runTimers: () => {
      const callbacks = [...timers.values()]
      timers.clear()
      for (const callback of callbacks) callback()
    },
    dispose: () => cleanups.forEach((cleanup) => cleanup()),
  }
}
const htmlResponse = (html) => ({
  ok: true,
  headers: new Headers({ "Content-Type": "text/html" }),
  text: () => Promise.resolve(html),
})

for (const failure of ["reject", "non-html", "oversized"]) {
  test(
    "an invalidated " + failure + " page request cannot evict the replacement request",
    async () => {
      const f = await fixture("cache"),
        url = new URL("https://example.com/notes/test")
      const first = f.context.cacheApi.fetchPage(url)
      const caught = first.catch((error) => error)
      f.context.cacheApi.invalidatePageCache()
      const replacement = f.context.cacheApi.fetchPage(url)
      f.requests[1].resolve(new Response("fresh", { headers: { "Content-Type": "text/html" } }))
      assert.equal(await (await replacement).text(), "fresh")
      if (failure === "reject") f.requests[0].reject(new Error("old request failed"))
      else
        f.requests[0].resolve(
          new Response(failure === "oversized" ? "x".repeat(350001) : "old", {
            headers: { "Content-Type": failure === "oversized" ? "text/html" : "text/plain" },
          }),
        )
      await caught
      const cached = f.context.cacheApi.fetchPage(url)
      await settle()
      assert.equal(f.requests.length, 2, "the old completion removed the new cached request")
      assert.equal(await (await cached).text(), "fresh")
    },
  )
}

test("late search preview HTML cannot poison the cache after content invalidation", async () => {
  const f = await fixture("runtime-search")
  f.document.emit("nav")
  f.widget.button.emit("click")
  f.widget.input.value = "note"
  f.widget.input.emit("input")
  await settle()
  f.runTimers()
  assert.equal(f.requests.length, 1)
  f.document.emit("howard:index-invalidated")
  await settle()
  f.runTimers()
  assert.equal(f.requests.length, 2)
  f.requests[1].resolve(htmlResponse("fresh-preview"))
  await settle()
  f.requests[0].resolve(htmlResponse("old-preview"))
  await settle()
  f.widget.input.emit("input")
  await settle()
  f.runTimers()
  await settle()
  const preview = f.widget.layout.querySelector(".preview-container")
  assert.match(preview.textContent, /fresh-preview/)
  assert.doesNotMatch(preview.textContent, /old-preview/)
  assert.equal(f.requests.length, 2, "the valid current preview must remain cached")
  f.dispose()
})

test("an invalidated index request cannot clear the newer request's deduplication", async () => {
  const f = await fixture("runtime-search"),
    oldIndex = deferred(),
    currentIndex = deferred()
  f.setIndex(oldIndex.promise)
  f.document.emit("nav")
  f.widget.button.emit("click")
  f.widget.input.value = "note"
  f.widget.input.emit("input")
  assert.equal(f.indexReads(), 1)
  f.setIndex(currentIndex.promise)
  f.document.emit("howard:index-invalidated")
  assert.equal(f.indexReads(), 2)
  oldIndex.resolve({ "notes/old": { title: "old note", content: "old", tags: [] } })
  await settle()
  f.widget.input.emit("input")
  assert.equal(f.indexReads(), 2, "old finally must not discard the pending current index")
  currentIndex.resolve({ "notes/new": { title: "fresh note", content: "fresh", tags: [] } })
  await settle()
  assert.match(f.widget.layout.querySelector(".results-container").textContent, /fresh note/)
  assert.doesNotMatch(f.widget.layout.querySelector(".results-container").textContent, /old note/)
  f.dispose()
})

for (const invalidation of ["render", "howard:index-invalidated"]) {
  test(
    "a " + invalidation + " with a preserved anchor rejects old popover HTML and accepts new HTML",
    async () => {
      const f = await fixture("popover"),
        anchor = f.document.createElement("a")
      anchor.className = "internal"
      anchor.href = "https://example.com/notes/example"
      f.document.body.append(anchor)
      f.document.emit("nav")
      f.document.emit("mouseover", {
        target: anchor,
        relatedTarget: null,
        clientX: 10,
        clientY: 10,
      })
      assert.equal(f.requests.length, 1)
      f.document.emit(invalidation)
      assert.equal(anchor.isConnected, true)
      f.requests[0].resolve(htmlResponse("old-popover"))
      await settle()
      assert.equal(
        f.document.querySelectorAll(".popover").length,
        0,
        "the old mount reinserted retained HTML",
      )
      f.document.emit("mouseover", {
        target: anchor,
        relatedTarget: null,
        clientX: 12,
        clientY: 12,
      })
      f.requests[1].resolve(htmlResponse("fresh-popover"))
      await settle()
      const popovers = f.document.querySelectorAll(".popover")
      assert.equal(popovers.length, 1)
      assert.equal(popovers[0].classList.contains("active-popover"), true)
      assert.match(popovers[0].textContent, /fresh-popover/)
      f.dispose()
    },
  )
}

test("a popover body finishing after render cannot reinsert DOM", async () => {
  const f = await fixture("popover"),
    anchor = f.document.createElement("a"),
    body = deferred()
  anchor.className = "internal"
  anchor.href = "https://example.com/notes/example"
  f.document.body.append(anchor)
  f.document.emit("nav")
  f.document.emit("mouseover", { target: anchor, relatedTarget: null, clientX: 10, clientY: 10 })
  f.requests[0].resolve({ ...htmlResponse(""), text: () => body.promise })
  await settle()
  f.document.emit("render")
  body.resolve("old-body")
  await settle()
  assert.equal(f.document.querySelectorAll(".popover").length, 0)
  f.dispose()
})

test("repeated render events keep one delegated hover pair and one search handler pair", async () => {
  const popover = await fixture("popover")
  popover.document.emit("nav")
  for (let i = 0; i < 20; i++) popover.document.emit("render")
  assert.equal(popover.document.listenerCount("mouseover"), 1)
  assert.equal(popover.document.listenerCount("mouseout"), 1)
  popover.dispose()
  assert.equal(popover.document.listenerCount("mouseover"), 0)
  const search = await fixture("runtime-search")
  search.document.emit("nav")
  for (let i = 0; i < 20; i++) search.document.emit("render")
  assert.equal(search.widget.button.listenerCount("click"), 1)
  assert.equal(search.widget.input.listenerCount("input"), 1)
  assert.equal(
    search.document.listenerCount("keydown"),
    2,
    "shortcut and Escape must each have one listener",
  )
  search.document.emit("keydown", { key: "k", ctrlKey: true })
  assert.equal(search.widget.container.classList.contains("active"), true)
  search.document.emit("keydown", { key: "k", ctrlKey: true })
  assert.equal(search.widget.container.classList.contains("active"), false)
  search.dispose()
  assert.equal(search.document.listenerCount("keydown"), 0)
})
