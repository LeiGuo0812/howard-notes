import assert from "node:assert/strict"
import test from "node:test"
import { createDiagramCache } from "./preview.mjs"

test("unchanged diagrams reuse a pending render and its sanitized result", async () => {
  const cache = createDiagramCache()
  let renders = 0,
    release
  const render = () => {
    renders++
    return new Promise((resolve) => (release = resolve))
  }
  const first = cache.get("[0,diagram]", render)
  assert.equal(cache.get("[0,diagram]", render), first)
  await Promise.resolve()
  release("<svg>sanitized diagram</svg>")
  assert.equal(await first, "<svg>sanitized diagram</svg>")
  assert.equal(await cache.get("[0,diagram]", render), "<svg>sanitized diagram</svg>")
  assert.equal(renders, 1)
})

test("changed diagram positions and editor contexts get independent renders", async () => {
  const cache = createDiagramCache()
  let renders = 0
  const render = () => "<svg>" + ++renders + "</svg>"
  assert.equal(await cache.get("[0,A]", render), "<svg>1</svg>")
  assert.equal(await cache.get("[1,A]", render), "<svg>2</svg>")
  assert.equal(await cache.get("[0,B]", render), "<svg>3</svg>")
  cache.clear()
  assert.equal(await cache.get("[0,A]", render), "<svg>4</svg>")
})

test("diagram caches evict old output by entry count and decoded string memory", async () => {
  const entries = createDiagramCache({ maxEntries: 2 })
  let renders = 0
  const render = () => String(++renders)
  await entries.get("first", render)
  await entries.get("second", render)
  assert.equal(await entries.get("first", render), "1")
  await entries.get("third", render)
  assert.equal(await entries.get("first", render), "1")
  assert.equal(await entries.get("second", render), "4")
  const bytes = createDiagramCache({ maxBytes: 10 })
  await bytes.get("oversize", () => "six123")
  assert.equal(await bytes.get("oversize", () => "fresh"), "fresh")
})

test("failed renders retry and late completions cannot refill a cleared context", async () => {
  const cache = createDiagramCache({ maxBytes: 10 })
  await assert.rejects(cache.get("failed", () => Promise.reject(new Error("invalid"))))
  assert.equal(await cache.get("failed", () => "fixed"), "fixed")
  let release
  const pending = cache.get("old", () => new Promise((resolve) => (release = resolve)))
  await Promise.resolve()
  cache.clear()
  assert.equal(await cache.get("current", () => "ok"), "ok")
  release("an old, very large diagram")
  await pending
  assert.equal(await cache.get("current", () => "unexpected"), "ok")
})
