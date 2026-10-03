import test from "node:test"
import assert from "node:assert/strict"
import { homePreview, selectActivity } from "./home-browser"

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
