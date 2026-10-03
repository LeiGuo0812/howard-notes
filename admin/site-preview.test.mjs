import assert from "node:assert/strict"
import test from "node:test"
import { createSitePreview } from "./site-preview.mjs"

const settingsFixture = () => ({
  version: 1,
  brand: { name: "Original", subtitle: "Notes", mark: "h." },
  accent: "blue",
  home: {
    title: "知识空间",
    description: "",
    layout: "single",
    density: "comfortable",
    sections: [
      { id: "featured", title: "试试手气", enabled: true },
      { id: "recent", title: "最近文章", enabled: true },
      { id: "topics", title: "专题", enabled: true },
      { id: "activity", title: "笔记活动", enabled: true },
    ],
  },
  topics: [],
  collections: ["recent", "featured", "all"].map((id) => ({ id, title: id, enabled: true })),
  navigation: ["notes", "topics", "about"].map((id) => ({ id, label: id, visible: true })),
  footer: "Howard",
  about: { title: "关于", body: "" },
})

function fixture({ merged = false } = {}) {
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
  let settings = settingsFixture(),
    snapshotReads = 0
  const preview = createSitePreview(
    () => settings,
    () => {
      snapshotReads++
      const publicSnapshot = {
        catalog: { articles: [{ id: "note-a", title: "A", published: true }] },
      }
      return merged
        ? {
            catalog: {
              articles: [
                { id: "note-a", title: "PRIVATE_SHADOW_TITLE", published: false },
                { id: "private-note", title: "PRIVATE_SECRET_TITLE", published: true },
              ],
            },
            publicSnapshot,
          }
        : publicSnapshot
    },
    {
      root,
      siteBase: "https://notes.example/howard-notes/",
      previewEntry: "admin/site-preview-0123456789abcdef.html",
    },
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
    snapshotReads: () => snapshotReads,
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

test("loading settings mounts its bounded sample only after the preview becomes visible", () => {
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
    assert.equal(
      f.frame.src,
      "https://notes.example/howard-notes/admin/site-preview-0123456789abcdef",
    )
    f.ready()
    assert.equal(f.messages.length, 1)
    assert.equal(f.messages[0].settings.brand.name, "Original")
    assert.equal(f.messages[0].scene, "home")
  } finally {
    f.cleanup()
  }
})

test("sample previews do not read owner or public catalogues and use one fixed article", () => {
  const f = fixture({ merged: true })
  try {
    f.preview.load()
    assert.deepEqual(
      f
        .control("preview-article")
        .options.map((option) => ({ text: option.text, value: option.value })),
      [{ text: "固定阅读样稿", value: "sample" }],
    )
    assert.doesNotMatch(JSON.stringify(f.control("preview-article").options), /PRIVATE/)
    assert.equal(f.control("preview-article").hidden, true)
    assert.equal(f.snapshotReads(), 0)
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
    f.setSettings({
      ...settingsFixture(),
      brand: { name: "Unsaved draft", subtitle: "Notes", mark: "h." },
    })
    f.ready()
    f.preview.update()
    assert.equal(f.messages.length, 2)
    f.preview.setActive(true)
    assert.equal(
      f.frame.src,
      "https://notes.example/howard-notes/admin/site-preview-0123456789abcdef",
    )
    assert.equal(f.frame.style.width, "390px")
    f.ready()
    assert.equal(f.messages.at(-1).settings.brand.name, "Unsaved draft")
    assert.equal(f.messages.at(-1).scene, "article")
    assert.equal(f.messages.at(-1).theme, "dark")
  } finally {
    f.cleanup()
  }
})

test("scene changes reuse the same iframe and exchange only whitelisted layout fields", () => {
  const f = fixture({ merged: true })
  try {
    f.stage.visible = true
    f.preview.load()
    f.preview.setActive(true)
    const initial = f.frame.src
    f.ready()
    f.setSettings({
      ...settingsFixture(),
      token: "PRIVATE_TOKEN",
      catalog: { secret: "PRIVATE_NOTE" },
      imageHost: { repository: "PRIVATE_REPOSITORY" },
      about: { title: "关于", body: "PRIVATE_ORIGINAL" },
    })
    f.control("preview-page").value = "topics"
    f.control("preview-page").onchange()
    assert.equal(f.frame.src, initial)
    assert.equal(f.messages.at(-1).scene, "topics")
    assert.doesNotMatch(JSON.stringify(f.messages), /PRIVATE/)
    assert.equal(f.snapshotReads(), 0)
  } finally {
    f.cleanup()
  }
})

test("a foreign frame or origin cannot mark the sample preview ready", () => {
  const f = fixture()
  try {
    f.stage.visible = true
    f.preview.load()
    f.preview.setActive(true)
    for (const [origin, source] of [
      ["https://untrusted.example", f.frame.contentWindow],
      [location.origin, {}],
    ]) {
      const event = new Event("message")
      Object.assign(event, { origin, source, data: { type: "howard-preview-ready" } })
      window.dispatchEvent(event)
    }
    assert.equal(f.messages.length, 0)
    f.ready()
    assert.equal(f.messages.length, 1)
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
