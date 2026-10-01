import test from "node:test"
import assert from "node:assert/strict"
import { constrainWindow } from "./panel-window.mjs"

const viewport = { width: 1440, height: 900, top: 12, inset: 12 }
const size = { width: 800, height: 600 }

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
