import assert from "node:assert/strict"
import test from "node:test"
import { createSitePreview } from "./site-preview.mjs"

function fixture() {
  const previous = {
    window: globalThis.window,
    location: globalThis.location,
    ResizeObserver: globalThis.ResizeObserver,
    Option: globalThis.Option,
  }
  const window = new EventTarget()
  globalThis.window = window
  globalThis.location = { origin: "https://notes.example", href: "https://notes.example/admin/" }
  const controls = new Map()
  const control = (id) => {
    if (!controls.has(id)) controls.set(id, { value: "", style: {}, hidden: false })
    return controls.get(id)
  }
  const root = { querySelector: (selector) => control(/(?:="|#)([^"\]]+)/.exec(selector)[1]) }
  const frame = control("site-preview-frame")
  frame.src = "about:blank"
  const messages = []
  frame.contentWindow = { postMessage: (value) => messages.push(value) }
  const stage = control("site-preview-stage")
  stage.clientWidth = 720
  stage.isConnected = true
  stage.visible = false
  stage.getClientRects = () => (stage.visible ? [{}] : [])
  control("preview-device").value = "desktop"
  control("preview-page").value = "home"
  control("preview-theme").value = "light"
  const articles = control("preview-article")
  articles.replaceChildren = (...options) => {
    articles.options = options
    articles.value = options[0]?.value || ""
  }
  globalThis.Option = class {
    constructor(text, value) {
      this.text = text
      this.value = value
    }
  }
  let resized,
    disconnected = false
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resized = callback
    }
    observe() {}
    disconnect() {
      disconnected = true
    }
  }
  let settings = { title: "Original" }
  const preview = createSitePreview(
    () => settings,
    () => ({ catalog: { articles: [{ id: "note-a", title: "A", published: true }] } }),
    { root, siteBase: "https://notes.example/howard-notes/" },
  )
  const ready = () => {
    const event = new Event("message")
    event.origin = location.origin
    event.source = frame.contentWindow
    event.data = { type: "howard-preview-ready" }
    window.dispatchEvent(event)
  }
  return {
    preview,
    control,
    frame,
    stage,
    messages,
    ready,
    setSettings(value) {
      settings = value
    },
    resize() {
      resized()
    },
    isDisconnected: () => disconnected,
    cleanup() {
      preview.dispose()
      Object.assign(globalThis, previous)
    },
  }
}

test("loading settings never mounts a hidden full-site iframe", () => {
  const f = fixture()
  try {
    f.preview.load()
    assert.equal(f.frame.src, "about:blank")
    f.resize()
    assert.equal(f.frame.src, "about:blank")
    f.preview.setActive(true)
    assert.equal(f.frame.src, "about:blank")
    f.stage.visible = true
    f.resize()
    assert.equal(f.frame.src, "https://notes.example/howard-notes/?site-preview=1")
    f.ready()
    assert.equal(f.messages.length, 1)
    assert.equal(f.messages[0].settings.title, "Original")
  } finally {
    f.cleanup()
  }
})

test("suspending previews unloads scripts and restores route, device, theme and current draft", () => {
  const f = fixture()
  try {
    f.stage.visible = true
    f.preview.load()
    f.preview.setActive(true)
    f.ready()
    f.control("preview-page").value = "article"
    f.control("preview-page").onchange()
    f.control("preview-device").value = "mobile"
    f.control("preview-device").onchange()
    f.control("preview-theme").value = "dark"
    f.preview.setActive(false)
    assert.equal(f.frame.src, "about:blank")
    f.setSettings({ title: "Unsaved draft" })
    f.ready()
    f.preview.update()
    assert.equal(f.messages.length, 1)
    f.preview.setActive(true)
    assert.equal(f.frame.src, "https://notes.example/howard-notes/notes/note-a?site-preview=1")
    assert.equal(f.frame.style.width, "390px")
    f.ready()
    assert.equal(f.messages.at(-1).settings.title, "Unsaved draft")
    assert.equal(f.messages.at(-1).theme, "dark")
  } finally {
    f.cleanup()
  }
})

test("disposed previews disconnect observers and cannot reopen", () => {
  const f = fixture()
  try {
    f.stage.visible = true
    f.preview.load()
    f.preview.setActive(true)
    f.preview.dispose()
    assert.equal(f.frame.src, "about:blank")
    assert.equal(f.isDisconnected(), true)
    f.preview.setActive(true)
    f.control("retry-site-preview").onclick()
    f.resize()
    assert.equal(f.frame.src, "about:blank")
  } finally {
    f.cleanup()
  }
})
