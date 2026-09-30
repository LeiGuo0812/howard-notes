import test from "node:test"
import assert from "node:assert/strict"
import { formatSelection, TextHistory } from "./formatting.mjs"
test("inline formatting preserves surrounding content and toggles selected marks", () => {
  const result = formatSelection("前文 原文 后文", 3, 5, "bold")
  assert.equal(result.text, "前文 **原文** 后文")
  assert.equal(
    formatSelection(result.text, result.start, result.end, "bold").text,
    "前文 原文 后文",
  )
  assert.equal(formatSelection("", 0, 0, "italic").text, "*文字*")
})
test("list and heading changes only affect selected lines", () => {
  assert.equal(
    formatSelection("第一行\n第二行\n第三行", 0, 8, "ordered").text,
    "1. 第一行\n2. 第二行\n第三行",
  )
  assert.equal(formatSelection("\n下一行", 0, 0, "h2").text, "## \n下一行")
  assert.equal(formatSelection("## 标题", 0, 5, "h3").text, "### 标题")
  assert.equal(formatSelection("  文字", 0, 4, "outdent").text, "文字")
})
test("link formatting escapes Markdown delimiters and refuses unsafe destinations", () => {
  assert.equal(
    formatSelection("链接", 0, 2, "link", "https://example.com/a(b)").text,
    "[链接](https://example.com/a%28b%29)",
  )
  assert.throws(() => formatSelection("链接", 0, 2, "link", "javascript:alert(1)"))
})
test("undo restores the original text; new edits discard obsolete redo states", () => {
  const history = new TextHistory("原文\n")
  history.record({ text: "**原文**\n", start: 2, end: 4 }, "format", 1000)
  assert.equal(history.undo().text, "原文\n")
  assert.equal(history.redo().text, "**原文**\n")
  history.undo()
  history.record({ text: "另一版", start: 3, end: 3 }, "typing", 2000)
  assert.equal(history.redo().text, "另一版")
  assert.equal(history.undo().text, "原文\n")
})
