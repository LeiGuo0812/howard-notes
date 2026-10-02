import assert from "node:assert/strict"
import test from "node:test"
import { mountPrivateDiagrams } from "./private-notes.mjs"

const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

class Element {
  constructor(tag = "div") {
    this.tagName = tag
    this.attributes = new Map()
    this.children = []
    this.textContent = ""
    this.isConnected = true
  }
  setAttribute(name, value) {
    this.attributes.set(name, value)
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }
  removeAttribute(name) {
    this.attributes.delete(name)
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
  }
  replaceWith(other) {
    const parent = this.parentElement
    parent.children.splice(parent.children.indexOf(this), 1, other)
    other.parentElement = parent
    this.parentElement = null
    this.isConnected = false
  }
  after(other) {
    const parent = this.parentElement
    parent.children.splice(parent.children.indexOf(this) + 1, 0, other)
    other.parentElement = parent
  }
  remove() {
    const parent = this.parentElement
    if (parent) parent.children.splice(parent.children.indexOf(this), 1)
    this.parentElement = null
    this.isConnected = false
  }
  replaceChildren() {
    this.children = []
  }
}

function fixture(t, sources = ["flowchart LR\n A[开始] --> B[结束]"]) {
  const previous = globalThis.document
  globalThis.document = { createElement: (tag) => new Element(tag) }
  t.after(() => (globalThis.document = previous))
  const body = new Element("article")
  const codes = sources.map((source) => {
    const pre = new Element("pre"),
      code = new Element("code")
    code.textContent = "rendered markup is not the original source"
    code.setAttribute("data-clipboard", JSON.stringify(source))
    pre.append(code)
    body.append(pre)
    return code
  })
  body.querySelectorAll = () => codes
  let theme = "light",
    observer,
    stopCount = 0,
    authorized = true
  const renders = [],
    mounts = [],
    updates = [],
    destroyed = []
  const viewer = {
    diagramThemeKey: () => theme,
    observeDiagramTheme(element, callback) {
      assert.equal(element, body)
      observer = callback
      return () => {
        stopCount++
        observer = null
      }
    },
    async renderDiagram(source, options) {
      renders.push({ source, options })
      return `<svg data-theme="${theme}"></svg>`
    },
    mountDiagram(container, options) {
      mounts.push({ container, options })
      return {
        update: (svg) => updates.push(svg),
        destroy: () => destroyed.push(container),
      }
    },
  }
  const controller = () => mountPrivateDiagrams(body, { viewer, isCurrent: () => authorized })
  return {
    body,
    codes,
    viewer,
    renders,
    mounts,
    updates,
    destroyed,
    controller,
    changeTheme(value) {
      theme = value
      observer?.()
    },
    revoke() {
      authorized = false
    },
    stopCount: () => stopCount,
  }
}

test("private diagrams preserve original clipboard bytes and rerender in place on theme changes", async (t) => {
  const source = "\uFEFFflowchart LR\r\n  A[中文] --> B[原文]\r\n",
    state = fixture(t, [source]),
    controller = state.controller()
  await controller.ready
  assert.equal(state.renders[0].source, source)
  assert.equal(state.mounts[0].options.source, source)
  assert.equal(state.mounts.length, 1)
  state.changeTheme("dark")
  await flush()
  assert.equal(state.renders[1].source, source)
  assert.equal(state.mounts.length, 1, "theme changes must update the existing viewer")
  assert.deepEqual(state.updates, ['<svg data-theme="dark"></svg>'])
  state.changeTheme("dark")
  await flush()
  assert.equal(state.renders.length, 2)
  controller.destroy()
})

test("logout cancels a pending private diagram, removes theme observers and releases original source DOM", async (t) => {
  const state = fixture(t),
    pending = deferred()
  state.viewer.renderDiagram = (source, options) => {
    state.renders.push({ source, options })
    return pending.promise
  }
  const controller = state.controller()
  assert.equal(state.renders[0].options.isCurrent(), true)
  assert.equal(state.renders[0].options.signal.aborted, false)
  state.revoke()
  controller.destroy()
  controller.destroy()
  assert.equal(state.renders[0].options.isCurrent(), false)
  assert.equal(state.renders[0].options.signal.aborted, true)
  assert.equal(state.codes[0].textContent, "")
  assert.equal(state.codes[0].getAttribute("data-clipboard"), null)
  assert.equal(state.stopCount(), 1)
  pending.resolve("<svg>late private content</svg>")
  await controller.ready
  assert.equal(state.mounts.length, 0)
  state.changeTheme("dark")
  assert.equal(state.renders.length, 1)
})

test("private diagram destruction immediately aborts the renderer's pending measurement", async (t) => {
  const state = fixture(t)
  let aborted = false
  state.viewer.renderDiagram = (source, { signal }) =>
    new Promise((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true
          resolve(null)
        },
        { once: true },
      )
    })
  const controller = state.controller()
  controller.destroy()
  assert.equal(aborted, true, "cleanup must abort before waiting for the render to settle")
  await controller.ready
  assert.equal(state.mounts.length, 0)
  assert.equal(state.stopCount(), 1)
})

test("mounted private diagram controls become unauthorized immediately and are destroyed on cleanup", async (t) => {
  const state = fixture(t),
    controller = state.controller()
  await controller.ready
  assert.equal(state.mounts[0].options.isCurrent(), true)
  state.revoke()
  assert.equal(state.mounts[0].options.isCurrent(), false)
  controller.destroy()
  assert.equal(state.destroyed.length, 1)
  assert.equal(state.stopCount(), 1)
  await state.mounts[0].options.onRetry()
  assert.equal(state.renders.length, 1, "old retry callbacks must not revive private diagrams")
})

test("rapid theme changes cannot install obsolete private SVG output", async (t) => {
  const state = fixture(t),
    initial = deferred(),
    latest = deferred()
  state.viewer.renderDiagram = (source, options) => {
    state.renders.push({ source, options })
    return state.renders.length === 1 ? initial.promise : latest.promise
  }
  const controller = state.controller()
  state.changeTheme("dark")
  assert.equal(state.renders[0].options.isCurrent(), false)
  latest.resolve("<svg>current dark output</svg>")
  await flush()
  initial.resolve("<svg>obsolete light output</svg>")
  await controller.ready
  assert.equal(state.mounts.length, 1)
  assert.equal(state.mounts[0].options.svg, "<svg>current dark output</svg>")
  controller.destroy()
})

test("one failed diagram leaves readable source and does not prevent other private diagrams", async (t) => {
  const state = fixture(t, ["broken diagram", "flowchart LR; A-->B"])
  state.viewer.renderDiagram = async (source) => {
    if (source === "broken diagram") throw new Error("invalid source")
    return "<svg>valid diagram</svg>"
  }
  const controller = state.controller()
  await controller.ready
  assert.equal(state.mounts.length, 1)
  assert.ok(state.codes[0].parentElement)
  assert.equal(state.codes[0].getAttribute("data-clipboard"), JSON.stringify("broken diagram"))
  assert.equal(state.body.children[1].getAttribute("role"), "status")
  controller.destroy()
})
