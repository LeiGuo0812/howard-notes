import assert from "node:assert/strict"
import test from "node:test"
import { sitePreviewSettings } from "./site-preview-settings.mjs"
import { renderSitePreviewSample, PREVIEW_SCENES } from "./site-preview-sample.mjs"
import { mountSitePreviewSample } from "./site-preview-sample-runtime.mjs"

const settings = () => ({
  version: 1,
  brand: { name: "Howard", mark: "h.", subtitle: "Notes" },
  accent: "blue",
  home: {
    title: "知识空间",
    description: "",
    layout: "single",
    density: "comfortable",
    activityPinned: true,
    sections: [
      { id: "featured", title: "试试手气", enabled: true, limit: 3 },
      { id: "recent", title: "最近文章", enabled: true, limit: 6 },
      { id: "topics", title: "专题", enabled: true },
      { id: "memories", title: "记忆卡", enabled: false, limit: 4 },
      { id: "activity", title: "笔记活动", enabled: true },
    ],
  },
  topics: ["技术", "学习"].map((title, index) => ({
    id: `topic-${index}`,
    title,
    category: title,
    visible: true,
  })),
  collections: ["recent", "featured", "all"].map((id) => ({ id, title: id, enabled: true })),
  navigation: ["notes", "topics", "about"].map((id) => ({ id, label: id, visible: true })),
  footer: "Howard",
  about: { title: "关于", body: "" },
})

test("preview settings strip credentials, image destinations, catalogues and originals recursively", () => {
  const source = settings()
  source.token = "PRIVATE_TOKEN"
  source.client = { token: "PRIVATE_CLIENT" }
  source.catalog = { articles: ["PRIVATE_ORIGINAL"] }
  source.imageHost = { repository: "PRIVATE_REPOSITORY" }
  source.brand.token = "PRIVATE_BRAND_TOKEN"
  source.home.sections[0].raw = "PRIVATE_BODY"
  source.topics[0].raw = "PRIVATE_TOPIC_BODY"
  source.design = { token: "PRIVATE_DESIGN_TOKEN" }
  source.about.body = "PRIVATE_ABOUT_BODY"
  const projected = sitePreviewSettings(source)
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE/)
  assert.equal(projected.about.body, "")
  projected.brand.name = "Changed"
  assert.equal(source.brand.name, "Howard", "projection must not mutate the editor's working draft")
})

test("all four scenes render bounded generic samples without scripts, source images or originals", () => {
  const source = settings()
  source.topics = Array.from({ length: 80 }, (_, index) => ({
    id: `topic-${index}`,
    title: `专题 ${index}`,
    category: `分类 ${index}`,
    visible: true,
  }))
  source.home.sections[1].limit = 20
  for (const scene of PREVIEW_SCENES) {
    const html = renderSitePreviewSample(source, scene)
    assert.match(html, /class="site-surface/)
    assert.match(html, /class="blog-header"/)
    assert.doesNotMatch(html, /<script|<iframe|<img\b|https?:\/\//)
    assert.ok(html.length < 25000, `${scene} must remain a small sample`)
  }
  const home = renderSitePreviewSample(source, "home")
  assert.equal((home.match(/class="internal note-preview/g) || []).length, 9)
  const topics = renderSitePreviewSample(source, "topics")
  assert.equal((topics.match(/class="topic-section topic-card/g) || []).length, 6)
  assert.equal((topics.match(/class="internal note-preview/g) || []).length, 18)
})

test("sample sections preserve enabled state, ordering, templates and responsive component classes", () => {
  const source = settings()
  source.home.activityPinned = false
  source.home.sections = [
    source.home.sections[4],
    source.home.sections[1],
    source.home.sections[2],
    source.home.sections[0],
    source.home.sections[3],
  ]
  source.home.sections[3].enabled = false
  source.home.layout = "split"
  source.home.density = "compact"
  source.pages = {
    homeTemplate: "knowledge",
    topicLayout: "cards",
    articleLayout: "centered",
    topicPreviewCount: 5,
  }
  const home = renderSitePreviewSample(source, "home")
  assert.deepEqual(
    [...home.matchAll(/data-section-id="([^"]+)"/g)].map((match) => match[1]),
    ["activity", "recent", "topics"],
  )
  assert.match(home, /layout-split density-compact/)
  assert.match(home, /data-home-template="knowledge"/)
  assert.match(renderSitePreviewSample(source, "topics"), /topic-layout-cards topic-card-grid/)
  assert.match(renderSitePreviewSample(source, "article"), /data-article-layout="centered"/)
})
test("curated preview follows visibility, count and order without loading real articles", () => {
  const source = settings()
  source.home.activityPinned = false
  source.home.sections.unshift({ id: "curated", title: "精选文章", enabled: true, limit: 4 })
  let home = renderSitePreviewSample(source, "home")
  const curated = home.match(/<section class="home-module module-curated"[\s\S]*?<\/section>/)?.[0]
  assert.ok(curated)
  assert.equal((curated.match(/class="internal note-preview/g) || []).length, 4)
  assert.match(curated, /curated-previews/)
  assert.match(curated, /id="refresh-curated-notes"/)
  assert.equal([...home.matchAll(/data-section-id="([^"]+)"/g)][0][1], "curated")
  source.home.sections[0].enabled = false
  home = renderSitePreviewSample(source, "home")
  assert.doesNotMatch(home, /module-curated/)
})

test("editable labels are escaped rather than treated as HTML or navigation", () => {
  const source = settings()
  source.brand.name = "<script>alert(1)</script>"
  source.home.title = '<img src=x onerror="alert(1)">'
  source.topics[0].title = '<svg onload="alert(1)">'
  for (const scene of PREVIEW_SCENES) {
    const html = renderSitePreviewSample(source, scene)
    assert.doesNotMatch(html, /<script|<img\b|<svg onload|onerror="/)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  }
  assert.throws(() => renderSitePreviewSample(source, "private"), /预览页面不正确/)
})

function runtimeFixture() {
  const messages = []
  const parent = { postMessage: (value, origin) => messages.push({ value, origin }) }
  const view = new EventTarget()
  view.parent = parent
  view.location = { origin: "https://notes.example" }
  const desktop = new EventTarget()
  desktop.matches = true
  view.matchMedia = () => desktop
  const target = () => {
    const properties = new Map(),
      attributes = new Map()
    return {
      style: {
        setProperty: (key, value) => properties.set(key, value),
        removeProperty: (key) => properties.delete(key),
        [Symbol.iterator]: () => properties.keys(),
      },
      setAttribute: (key, value) => attributes.set(key, value),
      attributes,
      properties,
    }
  }
  const element = target(),
    surface = target(),
    root = new EventTarget()
  const tools = { open: true }
  root.querySelector = (selector) => (selector === ".reading-tools" ? tools : surface)
  let renders = 0,
    html = ""
  Object.defineProperty(root, "innerHTML", {
    get: () => html,
    set(value) {
      renders++
      html = value
    },
  })
  const doc = { documentElement: element, getElementById: () => root }
  root.ownerDocument = doc
  const destroy = mountSitePreviewSample({ view, doc })
  return {
    view,
    parent,
    messages,
    element,
    surface,
    root,
    tools,
    setDesktop(matches) {
      desktop.matches = matches
      desktop.dispatchEvent(new Event("change"))
    },
    renders: () => renders,
    send(data, { origin = view.location.origin, source = parent } = {}) {
      const event = new Event("message")
      Object.assign(event, { data, origin, source })
      view.dispatchEvent(event)
    },
    destroy,
  }
}

test("sample accepts only its same-origin parent and validates scene, theme and settings", () => {
  const f = runtimeFixture()
  try {
    assert.deepEqual(f.messages, [
      { value: { type: "howard-preview-ready" }, origin: "https://notes.example" },
    ])
    const data = {
      type: "howard-layout-preview",
      settings: settings(),
      theme: "light",
      scene: "home",
    }
    f.send(data, { origin: "https://untrusted.example" })
    f.send(data, { source: {} })
    assert.equal(f.renders(), 0)
    f.send(data)
    assert.equal(f.renders(), 1)
    assert.equal(f.messages.at(-1).value.type, "howard-preview-applied")
    for (const invalid of [
      { ...data, scene: "private" },
      { ...data, theme: "unknown" },
      { ...data, settings: {} },
    ]) {
      f.send(invalid)
      assert.equal(f.messages.at(-1).value.type, "howard-preview-error")
    }
    assert.equal(f.renders(), 1)
  } finally {
    f.destroy()
  }
})

test("theme changes reuse rendered samples, scene changes replace them and disposed previews ignore messages", () => {
  const f = runtimeFixture()
  const data = {
    type: "howard-layout-preview",
    settings: settings(),
    theme: "light",
    scene: "home",
  }
  f.send(data)
  f.send({ ...data, theme: "dark" })
  assert.equal(f.renders(), 1)
  assert.equal(f.element.attributes.get("saved-theme"), "dark")
  assert.ok(f.surface.properties.has("--site-accent-light"))
  f.send({ ...data, theme: "dark", scene: "article" })
  assert.equal(f.renders(), 2)
  assert.match(f.root.innerHTML, /sample-article/)
  const before = f.messages.length
  f.destroy()
  f.send(data)
  assert.equal(f.messages.length, before)
  assert.equal(f.renders(), 2)
})

test("sample links cannot navigate or load a full-site document", () => {
  const f = runtimeFixture()
  try {
    const event = new Event("click", { cancelable: true })
    Object.defineProperty(event, "target", { value: { closest: () => ({ href: "#" }) } })
    f.root.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
  } finally {
    f.destroy()
  }
})

test("sample reading tools start closed on mobile and follow desktop breakpoints without reloading", () => {
  const f = runtimeFixture()
  try {
    f.setDesktop(false)
    f.send({
      type: "howard-layout-preview",
      settings: settings(),
      theme: "light",
      scene: "article",
    })
    assert.equal(f.tools.open, false)
    f.setDesktop(true)
    assert.equal(f.tools.open, true)
    assert.equal(f.renders(), 1)
    f.setDesktop(false)
    assert.equal(f.tools.open, false)
  } finally {
    f.destroy()
  }
})
