import test from "node:test"
import assert from "node:assert/strict"
import { normalizeMemoryTag, normalizeMemoryTags, isTagCommitKey } from "./tag-input.mjs"

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
