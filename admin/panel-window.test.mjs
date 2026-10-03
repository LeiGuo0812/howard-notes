import test from "node:test"
import assert from "node:assert/strict"
import { centerWindow, constrainWindow, createPanelWindow } from "./panel-window.mjs"

const viewport = { width: 1440, height: 900, top: 12, inset: 12 }
const size = { width: 800, height: 600 }

test("opening a panel centers it in the viewport rather than the toolbar's remaining space", () => {
  assert.deepEqual(centerWindow(size, viewport), { x: 320, y: 150 })
  assert.deepEqual(centerWindow({ width: 1120, height: 760 }, viewport), { x: 160, y: 70 })
})

test("centering near viewport limits keeps the whole panel and its heading accessible", () => {
  assert.deepEqual(
    centerWindow({ width: 374, height: 820 }, { width: 390, height: 844, inset: 8 }),
    {
      x: 8,
      y: 12,
    },
  )
  assert.deepEqual(centerWindow(size, { width: 720, height: 480, inset: 12 }), { x: 12, y: 12 })
})

test("floating window keeps its requested position inside the usable viewport", () => {
  assert.deepEqual(constrainWindow({ x: 200, y: 160 }, size, viewport), { x: 200, y: 160 })
})

test("dragging beyond any edge keeps the window accessible", () => {
  assert.deepEqual(constrainWindow({ x: -400, y: -900 }, size, viewport), { x: 12, y: 12 })
  assert.deepEqual(constrainWindow({ x: 2000, y: 2000 }, size, viewport), { x: 628, y: 288 })
})

test("shrinking the viewport reclamps an existing floating position", () => {
  assert.deepEqual(
    constrainWindow({ x: 500, y: 250 }, size, { ...viewport, width: 900, height: 780 }),
    { x: 88, y: 168 },
  )
})

test("oversized content keeps its heading accessible instead of producing negative coordinates", () => {
  assert.deepEqual(
    constrainWindow({ x: 100, y: 200 }, { width: 1100, height: 1600 }, { ...viewport, width: 900 }),
    { x: 12, y: 12 },
  )
})

function windowFixture() {
  const keys = ["window", "document", "requestAnimationFrame", "cancelAnimationFrame"]
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  const element = () => {
    const target = new EventTarget(),
      classes = new Set(),
      attributes = new Map(),
      styles = new Map()
    target.dataset = {}
    target.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
      toggle(value, enabled) {
        if (enabled) classes.add(value)
        else classes.delete(value)
      },
    }
    target.setAttribute = (key, value) => attributes.set(key, value)
    target.removeAttribute = (key) => attributes.delete(key)
    target.style = {
      setProperty: (key, value) => styles.set(key, value),
      removeProperty: (key) => styles.delete(key),
      getPropertyValue: (key) => styles.get(key),
    }
    return target
  }
  const host = element(),
    heading = element(),
    caption = element(),
    toggle = element(),
    frames = new Map(),
    fakeWindow = new EventTarget()
  host.isConnected = true
  host.hidden = false
  host.getBoundingClientRect = () =>
    host.classList.contains("is-fullscreen") ? { width: 1420, height: 880 } : { ...size }
  fakeWindow.innerWidth = viewport.width
  fakeWindow.innerHeight = viewport.height
  fakeWindow.matchMedia = () => ({ matches: true })
  let serial = 0
  const values = {
    window: fakeWindow,
    document: { documentElement: { clientWidth: viewport.width } },
    requestAnimationFrame(callback) {
      frames.set(++serial, callback)
      return serial
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
  }
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const controller = createPanelWindow({ host, heading, caption, toggle, onChange() {} })
  return {
    host,
    controller,
    cleanup() {
      controller.destroy()
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

test("window handoff copies position and clamps adopted geometry without modifying its source", () => {
  const f = windowFixture()
  try {
    const layout = { fullscreen: false, position: { x: 2000, y: -900 } }
    f.controller.adopt(layout)
    assert.deepEqual(f.controller.snapshot(), {
      fullscreen: false,
      position: { x: 628, y: 12 },
    })
    assert.deepEqual(layout.position, { x: 2000, y: -900 })
    const captured = f.controller.snapshot()
    captured.position.x = -500
    assert.equal(f.controller.snapshot().position.x, 628)
    assert.equal(f.host.style.getPropertyValue("--maintenance-window-x"), "628px")
  } finally {
    f.cleanup()
  }
})

test("fullscreen handoff clamps using ordinary dimensions and keeps its restore position", () => {
  const f = windowFixture()
  try {
    f.controller.adopt({ fullscreen: true, position: { x: 240, y: 180 } })
    assert.equal(f.host.classList.contains("is-fullscreen"), true)
    assert.deepEqual(f.controller.snapshot(), {
      fullscreen: true,
      position: { x: 240, y: 180 },
    })
    f.controller.restore()
    assert.equal(f.host.classList.contains("is-fullscreen"), false)
    assert.deepEqual(f.controller.snapshot(), {
      fullscreen: false,
      position: { x: 240, y: 180 },
    })
  } finally {
    f.cleanup()
  }
})

test("malformed handoff resets positioning and accepts only a boolean fullscreen flag", () => {
  const f = windowFixture()
  try {
    f.controller.adopt({ fullscreen: true, position: { x: 140, y: 160 } })
    f.controller.adopt({ fullscreen: "true", position: { x: Infinity, y: 20 } })
    assert.deepEqual(f.controller.snapshot(), { fullscreen: false, position: null })
    assert.equal(f.host.classList.contains("is-floating"), false)
    assert.equal(f.host.style.getPropertyValue("--maintenance-window-x"), undefined)
    f.controller.adopt({ position: { x: "20", y: 30 } })
    assert.deepEqual(f.controller.snapshot(), { fullscreen: false, position: null })
  } finally {
    f.cleanup()
  }
})
