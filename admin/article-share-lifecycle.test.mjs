import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { build } from "esbuild"

const compiled = build({
  entryPoints: ["admin/article-share.mjs"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "ArticleShare",
  loader: { ".css": "text" },
  external: ["./article-export-renderer.mjs"],
}).then((result) => result.outputFiles[0].text)

class Target extends EventTarget {
  counts = new Map()
  addEventListener(type, listener, options) {
    this.counts.set(type, (this.counts.get(type) || 0) + 1)
    super.addEventListener(type, listener, options)
  }
}
class Element extends Target {
  constructor(tag, owner) {
    super()
    this.tagName = tag
    this.owner = owner
    this.children = []
    this.dataset = {}
    this.attributes = new Map()
    this.className = ""
    this.textContent = ""
  }
  setAttribute(name, value) {
    this.attributes.set(name, value)
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove()
      node.parent = this
      this.children.push(node)
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this)
    this.parent = null
  }
  matches(selector) {
    const [tag, cls] = selector.split(".")
    return selector.startsWith("#")
      ? this.id === selector.slice(1)
      : (!tag || this.tagName === tag) && (!cls || this.className.split(/\s+/).includes(cls))
  }
  querySelector(selector) {
    selector = selector.replace(/^:scope > /, "")
    for (const node of this.children) {
      if (node.matches(selector)) return node
      const found = node.querySelector(selector)
      if (found) return found
    }
    return null
  }
  closest(selector) {
    for (let node = this; node instanceof Element; node = node.parent)
      if (node.matches(selector)) return node
    return null
  }
  get isConnected() {
    for (let node = this; node; node = node.parent) if (node === this.owner) return true
    return false
  }
  focus() {
    this.owner.activeElement = this
  }
}
async function fixture() {
  const document = new Target()
  document.title = "Example | Howard"
  document.head = new Element("head", document)
  document.body = new Element("body", document)
  document.head.parent = document.body.parent = document
  document.createElement = (tag) => new Element(tag, document)
  document.querySelector = (selector) => document.body.querySelector(selector)
  document.getElementById = (id) =>
    document.head.querySelector(`#${id}`) || document.body.querySelector(`#${id}`)
  const window = new Target()
  const context = vm.createContext({
    document,
    window,
    navigator: { userAgent: "Desktop" },
    URL,
    AbortController,
    CustomEvent,
    setTimeout,
    clearTimeout,
  })
  vm.runInContext(await compiled, context)
  const main = document.createElement("main")
  main.className = "center"
  main.dataset.maintenanceArticle = "note-example"
  const body = document.createElement("article")
  body.className = "popover-hint"
  const title = document.createElement("h1")
  title.className = "article-title"
  title.textContent = "Example"
  const trigger = document.createElement("button")
  trigger.dataset.articleShare = "note-example"
  main.append(title, body, trigger)
  document.body.append(main)
  const open = () =>
    context.ArticleShare.openArticleShare({ button: trigger, siteBase: "https://example.com/" })
  return { document, window, main, body, trigger, open }
}
const styleOf = (state) => state.document.getElementById("howard-article-share-styles")
const dialogOf = (state) => state.document.querySelector(".article-share-overlay")

test("share styles survive Quartz head reconciliation and a second article opens correctly", async () => {
  const state = await fixture()
  state.open()
  const firstStyle = styleOf(state)
  assert.equal(firstStyle.getAttribute("data-persist"), "")
  assert.match(firstStyle.textContent, /\.article-share-overlay\s*\{[\s\S]*?position:\s*fixed/)
  assert.ok(dialogOf(state))
  state.document.dispatchEvent(new Event("prenav"))
  assert.equal(dialogOf(state), null)
  for (const node of [...state.document.head.children])
    if (node.getAttribute("data-persist") === null) node.remove()
  state.main.dataset.maintenanceArticle = state.trigger.dataset.articleShare = "note-second"
  state.document.dispatchEvent(new Event("nav"))
  state.open()
  assert.equal(styleOf(state), firstStyle)
  assert.ok(dialogOf(state))
  assert.equal(state.document.head.children.length, 1)
})

test("removed lazy share styles are repaired without duplicating lifecycle listeners", async () => {
  const state = await fixture()
  state.open()
  styleOf(state).remove()
  state.document.dispatchEvent(new Event("nav"))
  assert.ok(styleOf(state))
  styleOf(state).remove()
  state.open()
  state.open()
  assert.equal(state.document.head.children.length, 1)
  for (const type of ["nav", "prenav", "howard-owner-statechange"])
    assert.equal(state.document.counts.get(type), 1)
  assert.equal(state.window.counts.get("pagehide"), 1)
  assert.ok(dialogOf(state))
})

test("persistent share styles do not retain private dialogs after authorization is revoked", async () => {
  const state = await fixture()
  state.main.id = "private-notes-app"
  state.trigger.dataset.articleSharePrivate = "true"
  let authorized = true
  state.document.addEventListener("howard-article-export-request", (event) => {
    event.detail.reply({
      title: "Private example",
      body: state.body,
      raw: "Private example",
      url: "https://example.com/private/",
      isCurrent: () => authorized,
    })
  })
  state.open()
  assert.ok(dialogOf(state))
  authorized = false
  state.document.dispatchEvent(new Event("howard-owner-statechange"))
  assert.equal(dialogOf(state), null)
  assert.ok(styleOf(state))
  authorized = true
  state.open()
  assert.ok(dialogOf(state))
  state.window.dispatchEvent(new Event("pagehide"))
  assert.equal(dialogOf(state), null)
})
