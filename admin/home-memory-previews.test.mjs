import test from "node:test"
import assert from "node:assert/strict"
import { memoryPreviewText, visibleMemoryPreviews } from "./home-memory-previews.mjs"

const card = (id, visibility = "PUBLIC", status = "NORMAL") => ({
  id,
  visibility,
  status,
  content: "测试记忆卡",
})

test("home previews show at most four normal cards and preserve original visibility", () => {
  const memories = [
    card("private", "PRIVATE"),
    card("protected", "PROTECTED"),
    card("archived", "PUBLIC", "ARCHIVED"),
    card("trash", "PUBLIC", "TRASH"),
    ...Array.from({ length: 6 }, (_, index) => card(`public-${index}`)),
  ]
  const before = JSON.stringify(memories)
  assert.deepEqual(
    visibleMemoryPreviews({ memories, owner: false }).map((item) => item.id),
    ["public-0", "public-1", "public-2", "public-3"],
  )
  assert.deepEqual(
    visibleMemoryPreviews({ memories, owner: true }).map((item) => item.id),
    ["private", "protected", "public-0", "public-1"],
  )
  assert.deepEqual(
    visibleMemoryPreviews({ memories, owner: true }, { publicOnly: true }).map((item) => item.id),
    ["public-0", "public-1", "public-2", "public-3"],
  )
  assert.equal(JSON.stringify(memories), before)
})

test("private-only vault produces an empty guest preview rather than placeholder cards", () => {
  const memories = Array.from({ length: 474 }, (_, index) => card(`private-${index}`, "PRIVATE"))
  assert.equal(visibleMemoryPreviews({ owner: false, memories }).length, 0)
  assert.equal(visibleMemoryPreviews({ owner: true, memories }).length, 4)
  assert.equal(visibleMemoryPreviews({ owner: true, memories }, { publicOnly: true }).length, 0)
  assert.deepEqual(visibleMemoryPreviews({ memories: "invalid" }), [])
})

test("home summaries contain plain text without executable HTML or code blocks", () => {
  const original =
    "# 想法\n\n记录 **重点** 和 [网页](https://example.test)。\n\n```js\nprivateCode()\n```\n\n<script>unsafe()</script>\n\n#学习 #技术"
  const preview = memoryPreviewText(original)
  assert.equal(preview, "想法 记录 重点 和 网页。")
  assert.doesNotMatch(preview, /privateCode|unsafe|script|https|学习|技术/)
  assert.equal(memoryPreviewText("长".repeat(500)).length, 220)
})
