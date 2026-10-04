import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeMemoryTag,
  normalizeMemoryTags,
  isTagCommitKey,
  articleTagSegment,
  replaceArticleTag,
  matchTagSuggestions,
  createTagSuggestions,
  createMemoryTagInput,
} from "./tag-input.mjs"

test("individual memory tags preserve Chinese, nested paths and literal commas", () => {
  assert.equal(normalizeMemoryTag("  #科学/笔记  "), "科学/笔记")
  assert.deepEqual(normalizeMemoryTags(["科学/笔记", "#科学/笔记", "legacy,tag", "中文 标签"]), [
    "科学/笔记",
    "legacy,tag",
    "中文 标签",
  ])
  assert.equal(normalizeMemoryTag(""), "")
  assert.equal(normalizeMemoryTag("#"), "")
  // Markup is kept as a literal tag name; the UI renders it with textContent.
  assert.equal(normalizeMemoryTag("<img onerror=alert(1)>"), "<img onerror=alert(1)>")
})

test("tag limits match the memory service without silently dropping user input", () => {
  assert.equal(normalizeMemoryTag("字".repeat(160)).length, 160)
  assert.throws(() => normalizeMemoryTag("字".repeat(161)), /160/)
  assert.throws(() => normalizeMemoryTag("first\nsecond"), /控制字符/)
  assert.throws(() => normalizeMemoryTag("hidden\u0000character"), /控制字符/)
  assert.equal(normalizeMemoryTags(Array.from({ length: 200 }, (_, i) => `标签${i}`)).length, 200)
  assert.throws(() => normalizeMemoryTags(Array.from({ length: 201 }, (_, i) => `标签${i}`)), /200/)
  assert.equal(normalizeMemoryTags(Array.from({ length: 300 }, () => "重复")).length, 1)
})

test("only a confirmed Enter commits a tag, including Android and Chinese IME paths", () => {
  assert.equal(isTagCommitKey({ key: "Enter" }), true)
  assert.equal(isTagCommitKey({ key: "," }), false)
  assert.equal(isTagCommitKey({ key: "Enter", isComposing: true }), false)
  assert.equal(isTagCommitKey({ key: "Enter", keyCode: 229 }), false)
  assert.equal(isTagCommitKey({ key: "Enter" }, true), false)
  assert.equal(isTagCommitKey({ key: "Enter" }, false, true), false)
})

test("existing candidates match Chinese and case-insensitive substrings, with bounded prefix priority", () => {
  assert.deepEqual(
    matchTagSuggestions(
      ["中文科学", "科学/笔记", "科学/笔记", "科学实践", "科学已选", null, "<科学>"],
      "科学",
      { selected: ["科学已选"] },
    ),
    ["科学/笔记", "科学实践", "中文科学", "<科学>"],
  )
  assert.deepEqual(matchTagSuggestions(["使用JavaScript", "Java", "JAVA"], "java"), [
    "Java",
    "JAVA",
    "使用JavaScript",
  ])
  assert.equal(
    matchTagSuggestions(
      Array.from({ length: 1000 }, (_, i) => `标签${i}`),
      "标签",
    ).length,
    8,
  )
  assert.deepEqual(matchTagSuggestions(["标签"], "  "), [])
  assert.deepEqual(matchTagSuggestions(["无效\n标签", "正常标签"], "标签"), ["正常标签"])
})

test("article suggestions replace only the caret segment and preserve other comma styles and new tags", () => {
  const value = "原标签， 科学草稿, 新标签"
  const caret = value.indexOf("草稿")
  assert.deepEqual(articleTagSegment(value, caret), {
    query: "科学草稿",
    start: 4,
    end: 9,
    selected: ["原标签", "新标签"],
  })
  assert.deepEqual(replaceArticleTag(value, caret, "科学/笔记"), {
    value: "原标签， 科学/笔记, 新标签",
    caret: 10,
  })
  assert.deepEqual(replaceArticleTag("原标签, ", 6, "新标签"), {
    value: "原标签, 新标签",
    caret: 8,
  })
  assert.deepEqual(replaceArticleTag("旧, 后面", 0, "新"), {
    value: "新, 后面",
    caret: 1,
  })
})

// This small DOM fixture exercises listener ordering and cleanup without adding
// a browser dependency. Full rendering/touch behaviour is checked in Chromium.
function fixture() {
  class Node {
    constructor(tag = "div") {
      this.tagName = tag
      this.ownerDocument = document
      this.children = []
      this.attributes = new Map()
      this.dataset = {}
      this.listeners = new Map()
      this.value = ""
      this.selectionStart = 0
    }
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) || []
      listeners.push(listener)
      this.listeners.set(name, listeners)
    }
    removeEventListener(name, listener) {
      this.listeners.set(
        name,
        (this.listeners.get(name) || []).filter((value) => value !== listener),
      )
    }
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) || []) listener(event)
      return !event.defaultPrevented
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value))
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null
    }
    removeAttribute(name) {
      this.attributes.delete(name)
    }
    append(...nodes) {
      for (const node of nodes) {
        if (node.tagName === "fragment") this.append(...node.children)
        else {
          this.children.push(node)
          node.parentElement = this
        }
      }
    }
    replaceChildren(...nodes) {
      this.children = []
      this.append(...nodes)
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter((node) => node !== this)
    }
    focus() {
      document.activeElement = this
    }
    getRootNode() {
      return document
    }
    setSelectionRange(start, end) {
      this.selectionStart = start
      this.selectionEnd = end
    }
    scrollIntoView() {}
    setCustomValidity() {}
    querySelector(selector) {
      return this.children.find((node) =>
        selector === "input" ? node.tagName === "input" : node.className === selector.slice(1),
      )
    }
    contains(node) {
      return this === node || this.children.some((child) => child.contains(node))
    }
    closest(selector) {
      if (
        (selector === ".tag-suggestion" && this.className === "tag-suggestion") ||
        (selector === "[data-tag-suggestion]" && this.dataset.tagSuggestion !== undefined)
      )
        return this
      return null
    }
  }
  const document = {
    defaultView: { Event },
    activeElement: null,
    createElement: (tag) => new Node(tag),
    createDocumentFragment: () => new Node("fragment"),
  }
  const container = new Node()
  const input = new Node("input")
  input.value = "科"
  input.selectionStart = 1
  container.append(input)
  input.focus()
  const key = (key, extra = {}) => {
    const event = {
      type: "keydown",
      key,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopPropagation() {},
      ...extra,
    }
    input.dispatchEvent(event)
    return event
  }
  return { container, input, document, Node, key }
}

test("combobox handles IME, keyboard choice, literal text and restores attributes on destruction", () => {
  const { input, container, key } = fixture()
  input.setAttribute("autocomplete", "off")
  let queries = 0
  const control = createTagSuggestions(input, {
    multiple: true,
    preventSubmit: true,
    getSuggestions() {
      queries++
      return ["科学/笔记", "科学<img onerror=alert(1)>"]
    },
  })
  control.refresh()
  const list = container.children[1]
  assert.equal(list.children[1].textContent, "科学<img onerror=alert(1)>")
  assert.equal(input.getAttribute("role"), "combobox")
  assert.equal(input.getAttribute("aria-expanded"), "true")
  assert.equal(key("Enter").defaultPrevented, true)
  assert.equal(input.value, "科")
  input.dispatchEvent({ type: "compositionstart" })
  const before = queries
  assert.equal(key("ArrowDown", { isComposing: true }).defaultPrevented, false)
  input.dispatchEvent({ type: "input" })
  assert.equal(queries, before)
  assert.equal(list.hidden, true)
  input.dispatchEvent({ type: "compositionend" })
  assert.equal(key("Enter").defaultPrevented, true)
  assert.equal(input.value, "科")
  control.destroy()
  assert.equal(container.children.length, 1)
  assert.equal(input.getAttribute("role"), null)
  assert.equal(input.getAttribute("autocomplete"), "off")
  assert.equal(input.listeners.get("input").length, 0)

  const next = createTagSuggestions(input, {
    multiple: true,
    getSuggestions: () => ["科学/笔记"],
  })
  next.refresh()
  key("ArrowDown")
  assert.equal(input.getAttribute("aria-activedescendant"), `${container.children[1].id}-0`)
  assert.equal(key("Enter").defaultPrevented, true)
  assert.equal(input.value, "科学/笔记")
  assert.equal(container.children[1].hidden, true)
  next.destroy()
})

test("candidate pools are read fresh and hidden/cleared without storing private values", () => {
  const { input, container, key } = fixture()
  let values = ["科学私密"]
  const control = createTagSuggestions(input, { getSuggestions: () => values })
  control.refresh()
  assert.equal(container.children[1].children[0].textContent, "科学私密")
  values = []
  control.refresh()
  assert.equal(container.children[1].children.length, 0)
  values = ["科学新标签"]
  control.refresh()
  key("Escape")
  assert.equal(input.value, "科")
  assert.equal(input.getAttribute("aria-expanded"), "false")
  assert.equal(container.children[1].children.length, 0)
  input.dispatchEvent({ type: "blur" })
  control.destroy()
})

test("choosing a memory suggestion creates one chip, excludes selected values and retains comma tags", () => {
  const { input, container, Node, key } = fixture()
  const host = new Node()
  const chips = new Node()
  chips.className = "memory-editor-tag-chips"
  host.append(chips, input)
  container.replaceChildren(host)
  const control = createMemoryTagInput(host, {
    getSuggestions: () => ["科学/笔记", "科学,标签"],
  })
  control.setTags(["科学/笔记"])
  input.value = "科"
  control.refreshSuggestions()
  const list = container.children[1]
  assert.equal(list.children.length, 1)
  key("ArrowDown")
  key("Enter")
  assert.deepEqual(control.getTags(), ["科学/笔记", "科学,标签"])
  assert.equal(input.value, "")
  assert.equal(chips.children.length, 2)
  assert.equal(list.hidden, true)
  input.value = "新标签"
  key("Enter")
  assert.deepEqual(control.getTags(), ["科学/笔记", "科学,标签", "新标签"])
  control.hideSuggestions()
  control.destroy()
  assert.equal(container.children.length, 1)
  assert.deepEqual(control.getTags(), [])
})
