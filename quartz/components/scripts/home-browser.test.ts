import test from "node:test"
import assert from "node:assert/strict"
import {
  curatedNotes,
  homePreview,
  mountHomeRecommendations,
  sampleHomeNotes,
  selectActivity,
  type HomeNote,
} from "./home-browser"

test("home year selection mounts just one heatmap and previews use safe text nodes", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document")
  class Node {
    children: Node[] = []
    parent?: Node
    dataset: Record<string, string> = {}
    attributes = new Map<string, string>()
    className = ""
    textContent = ""
    constructor(public tagName = "div") {}
    append(...nodes: Node[]) {
      for (const node of nodes) {
        node.parent = this
        this.children.push(node)
      }
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    }
    replaceWith(node: Node) {
      const index = this.parent!.children.indexOf(this)
      this.parent!.children[index] = node
      node.parent = this.parent
    }
    querySelector(selector: string) {
      return selector === "[data-activity-period]"
        ? this.children.find((node) => node.dataset.activityPeriod)
        : null
    }
  }
  const chart = new Node(),
    first = new Node(),
    data = new Node("script")
  first.dataset.activityPeriod = "2026"
  chart.append(first)
  data.textContent = JSON.stringify({
    noteBase: "./notes/",
    listing: "./notes/index",
    asOf: "2026-10-03",
    notes: [
      [
        "one",
        "</a><script>alert(1)</script>",
        "2024-02-29",
        "2026-10-01",
        "<img onerror=bad>",
        "技术",
        "技术",
      ],
    ],
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: () => data,
      querySelector: () => chart,
      createElement: (tag: string) => new Node(tag),
    },
  })
  const collect = (node: Node): Node[] => [node, ...node.children.flatMap(collect)]
  try {
    selectActivity("2024")
    assert.equal(chart.children.length, 1)
    const year = chart.children[0]
    assert.equal(year.dataset.activityPeriod, "2024")
    const cells = collect(year).filter((node) => node.className.startsWith("heatmap-day"))
    assert.equal(cells.filter((node) => !node.className.includes("outside")).length, 366)
    assert.equal(cells.find((node) => node.dataset.date === "2024-02-29")?.dataset.count, "1")
    selectActivity("2024")
    assert.equal(chart.children[0], year)
    selectActivity("recent")
    assert.equal(chart.children.length, 1)
    assert.equal(
      collect(chart.children[0]).filter(
        (node) => node.className.startsWith("heatmap-day") && !node.className.includes("outside"),
      ).length,
      365,
    )
    const preview = homePreview(JSON.parse(data.textContent).notes[0], {
      frosted: true,
    }) as unknown as Node
    assert.equal(preview.className, "frost-environment lucky-preview-surface")
    assert.ok(
      collect(preview)
        .find((node) => node.tagName === "h3")!
        .textContent.includes("<script>"),
    )
    assert.equal(
      collect(preview).filter((node) => node.tagName === "script" || node.tagName === "img").length,
      0,
    )
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original)
    else delete (globalThis as any).document
  }
})

const note = (id: string): HomeNote => [
  id,
  `文章 ${id}`,
  "2026-01-01",
  "2026-01-02",
  "摘要",
  "技术",
  "tech",
]

test("curated recommendations use only explicit public-pool IDs without a six-note cap", () => {
  const notes = Array.from({ length: 10 }, (_, i) => note(String(i)))
  const data = {
    noteBase: "./notes/",
    listing: "./notes/",
    asOf: "2026-10-05",
    notes,
    featuredIds: ["0", "2", "3", "4", "5", "6", "7", "8", "9", "private-absent"],
  }
  const curated = curatedNotes(data)
  assert.equal(curated.length, 9)
  assert.ok(!curated.some(([id]) => id === "1" || id === "private-absent"))
  assert.deepEqual(curatedNotes({ ...data, featuredIds: [] }), [])
  assert.deepEqual(curatedNotes({ ...data, featuredIds: undefined }), [])
  assert.equal(new Set(sampleHomeNotes(curated, 4).map(([id]) => id)).size, 4)
})

test("refresh changes an article when possible and changes order for a small pool", () => {
  const notes = ["a", "b", "c", "d", "e"].map(note)
  const before = structuredClone(notes)
  const chosen = sampleHomeNotes(notes, 4, ["a", "b", "c", "d"], () => 0)
  assert.deepEqual(
    chosen.map(([id]) => id),
    ["e", "b", "c", "d"],
  )
  const small = sampleHomeNotes(notes.slice(0, 3), 4, ["a", "b", "c"], () => 0)
  assert.deepEqual(
    small.map(([id]) => id),
    ["b", "c", "a"],
  )
  assert.deepEqual(
    sampleHomeNotes([notes[0]], 4, ["a"], () => 0),
    [notes[0]],
  )
  assert.deepEqual(sampleHomeNotes([], 4), [])
  assert.deepEqual(notes, before)
})

test("both recommendation modules refresh independently and clean up before SPA remount", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document")
  class Node {
    children: Node[] = []
    dataset: Record<string, string> = {}
    className = ""
    textContent = ""
    disabled = false
    listeners = new Set<() => void>()
    constructor(public tagName = "div") {}
    append(...nodes: Node[]) {
      this.children.push(...nodes)
    }
    replaceChildren(...nodes: Node[]) {
      this.children = nodes
    }
    querySelectorAll() {
      const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)]
      return this.children
        .flatMap(all)
        .filter((node) => node.className.split(" ").includes("note-preview"))
    }
    addEventListener(_type: string, listener: () => void) {
      this.listeners.add(listener)
    }
    removeEventListener(_type: string, listener: () => void) {
      this.listeners.delete(listener)
    }
    click() {
      for (const listener of this.listeners) listener()
    }
  }
  let elements: Map<string, Node>
  let data: Node
  const createPage = (featuredIds: string[]) => {
    data = new Node("script")
    data.textContent = JSON.stringify({
      noteBase: "./notes/",
      listing: "./notes/",
      asOf: "2026-10-05",
      notes: Array.from({ length: 10 }, (_, i) => note(String(i))),
      featuredIds,
    })
    elements = new Map(
      ["#random-notes", "#curated-notes", "#refresh-random-notes", "#refresh-curated-notes"].map(
        (selector) => [selector, new Node()],
      ),
    )
  }
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: () => data,
      querySelector: (selector: string) => elements.get(selector),
      createElement: (tag: string) => new Node(tag),
    },
  })
  let cleanup: (() => void)[] = []
  try {
    createPage(["0", "1", "2", "3", "4", "5", "6", "7"])
    mountHomeRecommendations((callback) => cleanup.push(callback))
    const random = elements!.get("#random-notes")!
    const curated = elements!.get("#curated-notes")!
    const button = elements!.get("#refresh-curated-notes")!
    assert.equal(random.querySelectorAll().length, 3)
    assert.equal(curated.querySelectorAll().length, 4)
    const unchanged = [...random.children]
    const previous = curated
      .querySelectorAll()
      .map((node) => node.dataset.noteId)
      .sort()
    button.click()
    assert.notDeepEqual(
      curated
        .querySelectorAll()
        .map((node) => node.dataset.noteId)
        .sort(),
      previous,
    )
    assert.deepEqual(random.children, unchanged)
    assert.equal(button.listeners.size, 1)
    cleanup.forEach((callback) => callback())
    cleanup = []
    assert.equal(button.listeners.size, 0)
    createPage([])
    mountHomeRecommendations((callback) => cleanup.push(callback))
    const empty = elements!.get("#curated-notes")!
    assert.equal(empty.querySelectorAll().length, 0)
    assert.equal(empty.children[0].textContent, "暂无精选文章")
    assert.equal(elements!.get("#refresh-curated-notes")!.disabled, true)
    assert.equal(elements!.get("#refresh-random-notes")!.listeners.size, 1)
  } finally {
    cleanup.forEach((callback) => callback())
    if (original) Object.defineProperty(globalThis, "document", original)
    else delete (globalThis as any).document
  }
})
