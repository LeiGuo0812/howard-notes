import test from "node:test"
import assert from "node:assert/strict"
import { centerWindow, constrainWindow } from "./panel-window.mjs"

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
