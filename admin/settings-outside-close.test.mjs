import test from "node:test"
import assert from "node:assert/strict"
import { createSettingsOutsideClose } from "./settings-outside-close.mjs"

function fixture() {
  const target = new EventTarget()
  const host = { isConnected: true, hidden: false, contains: (node) => node?.inside === true }
  const state = { visible: true, action: "settings", mode: "panel", closed: 0 }
  const controller = createSettingsOutsideClose({
    host,
    target,
    isActive: () => state.visible && state.action === "settings" && state.mode === "panel",
    onClose() {
      state.closed++
      state.visible = false
    },
  })
  controller.start()
  const outside = {}
  const emit = (type, { path = [outside], ...values } = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    for (const [key, value] of Object.entries({
      target: path[0],
      button: 0,
      detail: 1,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
      isPrimary: true,
      composedPath: () => path,
      ...values,
    }))
      Object.defineProperty(event, key, { value, configurable: true })
    target.dispatchEvent(event)
    return event
  }
  const protectedControl = (selector) => ({
    closest: (selectors) => (selectors.split(",").includes(selector) ? {} : null),
  })
  return { target, host, state, controller, emit, outside, protectedControl }
}

test("an outside click tucks away settings and leaves its original page action untouched", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  let pageClicks = 0
  f.target.addEventListener("click", () => pageClicks++)
  f.emit("pointerdown")
  const click = f.emit("click")
  assert.equal(f.state.closed, 1)
  assert.equal(pageClicks, 1)
  assert.equal(click.defaultPrevented, false)
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("a settings input in Shadow DOM is recognized through its composed path", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  const shadowInput = { value: "unsaved layout draft" }
  f.emit("click", { path: [shadowInput, {}, f.host, f.target] })
  assert.equal(f.state.closed, 0)
  assert.equal(shadowInput.value, "unsaved layout draft")
  f.emit("click")
  assert.equal(f.state.closed, 1)
  assert.equal(shadowInput.value, "unsaved layout draft")
})

test("without composedPath, a light-DOM descendant is still inside the window", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.emit("click", { path: [{ inside: true }], composedPath: undefined })
  assert.equal(f.state.closed, 0)
})

test("only visible settings panels respond, including a fullscreen settings panel", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  for (const change of [
    { visible: false },
    { action: "articles" },
    { action: "new" },
    { action: "settings", mode: "inline" },
  ]) {
    Object.assign(f.state, { visible: true, action: "settings", mode: "panel" }, change)
    f.emit("click")
    assert.equal(f.state.closed, 0)
  }
  Object.assign(f.state, { visible: true, action: "settings", mode: "panel" })
  f.host.fullscreen = true
  f.emit("click", { path: [{}, f.host] })
  assert.equal(f.state.closed, 0)
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("detached and hidden hosts cannot react to reading-page clicks", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.host.isConnected = false
  f.emit("click")
  f.host.isConnected = true
  f.host.hidden = true
  f.emit("click")
  assert.equal(f.state.closed, 0)
  f.host.hidden = false
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("maintenance controls and background progress keep their switching/reopening behavior", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  for (const selector of [
    "[data-maintenance-login]",
    "[data-maintenance-action]",
    "[data-maintenance-status]",
    ".maintenance-toolbar",
    ".maintenance-progress",
  ]) {
    f.emit("click", { path: [f.protectedControl(selector)] })
    assert.equal(f.state.closed, 0, selector)
  }
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("search, graph and other dialog layers can be used without dismissing settings", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  for (const selector of [
    ".search-container",
    ".global-graph-outer",
    ".article-share-overlay",
    ".howard-diagram-modal",
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    "dialog",
    "[data-maintenance-outside-ignore]",
  ]) {
    f.emit("click", { path: [f.protectedControl(selector)] })
    assert.equal(f.state.closed, 0, selector)
  }
})

test("a pointer gesture originating inside the panel cannot close it when released outside", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.emit("pointerdown", { path: [{}, f.host] })
  f.emit("pointermove", { clientX: 220, clientY: 180 })
  f.emit("click")
  assert.equal(f.state.closed, 0)
  f.emit("pointerdown")
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("scrolling, selection and cancelled pointer gestures are not outside clicks", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.emit("pointerdown")
  f.emit("pointermove", { clientY: 150 })
  f.emit("click")
  assert.equal(f.state.closed, 0)
  f.emit("pointerdown")
  f.emit("pointercancel")
  f.emit("click")
  assert.equal(f.state.closed, 0)
  // Small touch jitter remains a tap rather than a scrolling gesture.
  f.emit("pointerdown")
  f.emit("pointermove", { clientX: 23, clientY: 22 })
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("the click that opens a hidden settings window does not immediately dismiss it", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.state.visible = false
  f.emit("pointerdown")
  f.state.visible = true
  f.emit("click")
  assert.equal(f.state.closed, 0)
  f.emit("pointerdown")
  f.emit("click")
  assert.equal(f.state.closed, 1)
})

test("a keyboard outside activation is not mistaken for an old pointer drag", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.emit("pointerdown", { path: [f.host] })
  f.emit("pointermove", { clientX: 120 })
  f.emit("click", { detail: 0 })
  assert.equal(f.state.closed, 1)
})

test("secondary buttons and already cancelled clicks do not tuck away settings", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.emit("click", { button: 2 })
  f.emit("click", { defaultPrevented: true })
  assert.equal(f.state.closed, 0)
})

test("stop, navigation restart and destroy remove listeners and cannot double-bind them", (t) => {
  const f = fixture()
  t.after(() => f.controller.destroy())
  f.controller.start()
  f.controller.stop()
  f.emit("click")
  assert.equal(f.state.closed, 0)
  f.controller.start()
  f.controller.start()
  f.emit("click")
  assert.equal(f.state.closed, 1)
  f.state.visible = true
  f.controller.destroy()
  f.controller.start()
  f.emit("click")
  assert.equal(f.state.closed, 1)
})
