import test from "node:test"
import assert from "node:assert/strict"
import { encodeAstCache, decodeAstCache } from "./cache.mjs"

test("AST cache retains block references and properties with deterministic, position-free gzip", async () => {
  const paragraph = {
    type: "element",
    tagName: "p",
    properties: { position: "relative", id: "block" },
    children: [{ type: "text", value: "中文正文" }],
    position: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
  }
  const tree = { type: "root", children: [paragraph] }
  const cache = await encodeAstCache(tree, { block: paragraph })
  assert.equal(await encodeAstCache(tree, { block: paragraph }), cache)
  const decoded = await decodeAstCache(cache)
  assert.equal(decoded.tree.children[0].position, undefined)
  assert.equal(decoded.tree.children[0].properties.position, "relative")
  assert.equal(decoded.blocks.block.properties.id, "block")
  assert.equal(decoded.blocks.block.children[0].value, "中文正文")
  assert.ok(paragraph.position)
})

test("malformed and oversized decompressed cache is rejected", async () => {
  await assert.rejects(decodeAstCache("not-gzip"))
  const oversized = await encodeAstCache(
    { type: "root", children: [{ type: "text", value: "x".repeat(16000001) }] },
    {},
  )
  await assert.rejects(decodeAstCache(oversized), /缓存过大/)
})
