import test from "node:test"
import assert from "node:assert/strict"
import { renderLibrary, splitNote, hash, extractNoteTags } from "./lib/library.mjs"
import { validateCatalog, mergeArticle } from "./lib/catalog.mjs"
import { paginateItems, sampleItems } from "../quartz/components/scripts/browsing.ts"

test("pagination handles last, empty, invalid and out-of-range pages with twenty articles", () => {
  const articles = Array.from({ length: 172 }, (_, i) => i)
  assert.equal(paginateItems(articles, 1).items.length, 20)
  assert.deepEqual(paginateItems(articles, 2).items, articles.slice(20, 40))
  assert.equal(paginateItems(articles, 9).items.length, 12)
  assert.equal(paginateItems(articles, 999).page, 9)
  for (const page of [-1, 0, NaN, Infinity, 1.5])
    assert.equal(paginateItems(articles, page).page, 1)
  assert.deepEqual(paginateItems([], 9), { page: 1, pages: 1, start: 0, items: [] })
})
test("random recommendations sample unique articles without changing the source order", () => {
  const articles = Array.from({ length: 50 }, (_, i) => i),
    before = [...articles]
  const selected = sampleItems(articles, 3, () => 0.9)
  assert.equal(selected.length, 3)
  assert.equal(new Set(selected).size, 3)
  assert.ok(selected.every((item) => articles.includes(item)))
  assert.deepEqual(articles, before)
  assert.equal(sampleItems([1, 2]).length, 2)
})

const entry = (id, extra = {}) => ({
  id,
  file: `notes/${id}.md`,
  title: id,
  category: "测试",
  date: "2026-09-30",
  tags: [],
  published: true,
  ...extra,
})
test("note tags include metadata and prose but exclude code, links and headings", () => {
  const text = [
    "---",
    "tags: [Python, 统计]",
    "---",
    "# Heading",
    "",
    "#Python #学习/方法 #统计",
    "",
    "```python",
    "# comment",
    "url = 'https://example.test/#fragment'",
    "```",
    "",
    "`#inline` [#link](https://example.test/#anchor) <https://example.test/#url>",
    "<!-- #hidden -->",
    "",
    "正文 **#脑影像**",
  ].join("\n")
  assert.deepEqual(extractNoteTags(text), ["Python", "统计", "学习/方法", "脑影像"])
})
test("original bytes, comments, code and line endings are never mutated", () => {
  const bytes = Buffer.from(
    "---\r\nprivate: original metadata\r\n---\r\n原文\r\n```cmd\r\nfor %%i in (*) do echo %%i\r\n```\r\n<!-- kept original comment -->\r\n",
  )
  const originalHash = hash(bytes)
  const { output, records } = renderLibrary(
    { version: 2, articles: [entry("a")] },
    new Map([["notes/a.md", bytes]]),
  )
  const rendered = output.get("notes/a.md").toString()
  assert.equal(splitNote(rendered).body, splitNote(bytes.toString()).body)
  assert.equal(hash(bytes), originalHash)
  assert.equal(records[0].sha256, originalHash)
})
test("drafts and their unreferenced attachments do not enter website output", () => {
  const { output } = renderLibrary(
    { version: 2, articles: [entry("a", { published: false }), entry("b")] },
    new Map([
      ["notes/a.md", Buffer.from("private draft ![x](../assets/private.png)")],
      ["notes/b.md", Buffer.from("public")],
      ["assets/private.png", Buffer.from("private image")],
    ]),
  )
  assert.deepEqual([...output.keys()], ["notes/b.md"])
})
test("clipped table-of-contents anchors resolve across multiple source headings", () => {
  const bytes = Buffer.from(
    "[第一节](#t0) [第二节](#t1) [第三节](#t2)\n\n# 第一节\n\n正文\n\n## 第二节\n\n更多\n\n## **第三节**\n",
  )
  const originalHash = hash(bytes)
  const { output } = renderLibrary(
    { version: 2, articles: [entry("a")] },
    new Map([["notes/a.md", bytes]]),
  )
  for (const id of ["t0", "t1", "t2"])
    assert.ok(output.get("notes/a.md").includes(`<span id="${id}"></span>`))
  assert.equal(hash(bytes), originalHash)
})
test("resolves approved wikilinks while preserving code samples and unapproved labels", () => {
  const bytes = Buffer.from("[[b|第二篇]] [[missing|待公开笔记]] `[[b]]`\n\n```md\n[[b]]\n```")
  const { output, warnings } = renderLibrary(
    { version: 2, articles: [entry("a"), entry("b")] },
    new Map([
      ["notes/a.md", bytes],
      ["notes/b.md", Buffer.from("正文")],
    ]),
  )
  const rendered = output.get("notes/a.md").toString()
  assert.match(rendered, /\[\[notes\/b\|第二篇\]\]/)
  assert.match(rendered, /待公开笔记<\/span>/)
  assert.match(rendered, /`\[\[b\]\]`/)
  assert.match(rendered, /```md\n\[\[b\]\]\n```/)
  assert.equal(warnings.length, 1)
})
test("only referenced library attachments are emitted; paths outside library never resolve", () => {
  const { output, warnings } = renderLibrary(
    { version: 2, articles: [entry("a")] },
    new Map([
      ["notes/a.md", Buffer.from("![test](../assets/a.png) ![secret](../../secrets.png)")],
      ["assets/a.png", Buffer.from("image")],
      ["assets/unused.png", Buffer.from("unused")],
    ]),
  )
  assert.equal([...output.keys()].filter((key) => key.startsWith("assets/")).length, 1)
  assert.equal(warnings.length, 1)
})
test("rejects traversal, duplicate routes and conflicting metadata edits", () => {
  for (const file of ["notes/../secret.md", "notes/.private/x.md", "../x.md"])
    assert.throws(() => validateCatalog({ version: 2, articles: [entry("a", { file })] }))
  assert.throws(() => validateCatalog({ version: 2, articles: [entry("a"), entry("a")] }))
  const opened = entry("a"),
    current = entry("a", { title: "远端更新" })
  assert.throws(
    () =>
      mergeArticle({ version: 2, articles: [current] }, opened, entry("a", { title: "本地更新" })),
    /另一端/,
  )
})
test("editing an article preserves unrelated remote additions", () => {
  const a = entry("a"),
    b = entry("b")
  const merged = mergeArticle({ version: 2, articles: [a, b] }, a, { ...a, published: false })
  assert.deepEqual(merged.articles[1], b)
  assert.equal(merged.articles[0].published, false)
})
