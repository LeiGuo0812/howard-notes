import test from "node:test"
import assert from "node:assert/strict"
import { renderLibrary, readLibrary, splitNote, hash, extractNoteTags } from "./lib/library.mjs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { trashRecordContent, TRASH_RETENTION_MS } from "../admin/trash.mjs"
import { validateCatalog, mergeArticle } from "./lib/catalog.mjs"
import { paginateItems, sampleItems } from "../quartz/components/scripts/browsing.ts"
import { prepareArticleImages } from "../quartz/util/article-images.ts"

test("rendered restricted images omit referrers while retaining URLs and the original tree", () => {
  const image = (src) => ({
    type: "element",
    tagName: "img",
    properties: { src, alt: "原图片" },
    children: [],
  })
  const tree = {
    type: "root",
    children: [
      image("https://cdn.nlark.com/yuque/image.png#original-fragment"),
      image("https://img-blog.csdnimg.cn/image.png"),
      image("https://raw.githubusercontent.com/owner/repo/main/img/test.png"),
      image("/assets/local.png"),
      image("https://cdn.nlark.com.example.test/image.png"),
      {
        type: "element",
        tagName: "a",
        properties: { href: "https://cdn.nlark.com/image.png" },
        children: [],
      },
    ],
  }
  const before = structuredClone(tree)
  const rendered = prepareArticleImages(tree)
  assert.deepEqual(tree, before)
  assert.deepEqual(
    rendered.children.map((node) => node.properties.src),
    tree.children.map((node) => node.properties.src),
  )
  for (const node of rendered.children.slice(0, 2)) {
    assert.equal(node.properties.referrerPolicy, "no-referrer")
    assert.equal(node.properties.alt, "原图片")
  }
  assert.deepEqual(rendered.children.slice(2), tree.children.slice(2))
})

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

test("library scanning excludes complete and malformed recycle archives from source maps and public export", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "howard-public-library-"))
  try {
    const live = entry("live", { file: "notes/trash/legitimate.md" })
    const archived = entry("deleted", { title: "ARCHIVED_PRIVATE_TITLE" })
    const id = "11111111-2222-4333-8444-555555555555"
    const deleted = Date.parse("2026-10-01T00:00:00.000Z")
    const record = {
      version: 1,
      id,
      articleId: archived.id,
      title: archived.title,
      published: true,
      deletedAt: new Date(deleted).toISOString(),
      expiresAt: new Date(deleted + TRASH_RETENTION_MS).toISOString(),
      articles: [
        {
          article: archived,
          sourcePath: `library/trash/${id}/sources/0.md`,
          sha: "original",
          mode: "100644",
          index: 0,
        },
      ],
    }
    const files = new Map([
      ["catalog.json", JSON.stringify({ version: 2, articles: [live] })],
      [live.file, "public [[deleted|旧链接]]"],
      [`trash/${id}/record.json`, trashRecordContent(record)],
      [`trash/${id}/sources/0.md`, "\uFEFFARCHIVED_PRIVATE_BODY\r\n"],
      ["trash/bad-record/record.json", "malformed archive must also stay excluded"],
    ])
    for (const [file, text] of files) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await fs.writeFile(path.join(root, file), text)
    }
    const { catalog, sources } = await readLibrary(root)
    assert.deepEqual([...sources.keys()], ["catalog.json", live.file])
    assert.deepEqual(catalog.articles, [live])
    const { output, records, warnings } = renderLibrary(catalog, sources)
    assert.deepEqual([...output.keys()], ["notes/live.md"])
    assert.deepEqual(
      records.map((item) => item.id),
      ["live"],
    )
    assert.equal(warnings.length, 1)
    assert.ok([...output.values()].every((value) => !value.toString().includes("ARCHIVED_PRIVATE")))
    assert.equal(
      await fs.readFile(path.join(root, `trash/${id}/sources/0.md`), "utf8"),
      "\uFEFFARCHIVED_PRIVATE_BODY\r\n",
    )
    await fs.writeFile(path.join(root, "unexpected.json"), "outside archive remains invalid")
    await assert.rejects(readLibrary(root), /不支持的文库文件/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
