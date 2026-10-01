import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { prepareProjection, gitBlobSha } from "./projection.mjs"

const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
const encode = (text) => new TextEncoder().encode(text)
const article = (id, extra = {}) => ({
  id,
  file: `notes/${id}.md`,
  title: id,
  category: "测试",
  date: "2026-10-01",
  published: true,
  tags: [],
  ...extra,
})
const input = (articles, notes, extra = {}) => ({
  catalog: { version: 2, articles },
  settings,
  sources: new Map(Object.entries(notes).map(([file, text]) => [file, encode(text)])),
  now: new Date("2026-10-01T00:00:00Z"),
  ...extra,
})

test("live projection preserves original Git bytes and Quartz callouts, GFM, code, math, mermaid, headings and links", async () => {
  const source =
    "\uFEFF---\r\nprivateMetadata: never-rendered\r\n---\r\n" +
    [
      "# 主标题",
      "",
      "## 重复标题",
      "",
      "## 重复标题",
      "",
      "> [!tip]+ 提示",
      "> 中文 **正文**",
      "",
      "|列 A|列 B|",
      "|---|---|",
      "|1|2|",
      "",
      "- [x] 完成",
      "",
      "~~删除线~~ ==高亮==",
      "",
      "```python",
      "print('[[b]]')",
      "```",
      "",
      "$x^2$",
      "",
      "$$",
      "\\frac{a}{b}",
      "$$",
      "",
      "```mermaid",
      "graph LR; A-->B",
      "```",
      "",
      "[[b|第二篇]] [外链](https://example.test/)",
      "![原图](https://cdn.nlark.com/image.png)",
    ].join("\r\n")
  const projected = await prepareProjection(
    input([article("a"), article("b")], {
      "notes/a.md": source,
      "notes/b.md": "# 第二篇\n\n正文",
    }),
  )
  const doc = projected.documents.find((item) => item.id === "a")
  assert.equal(doc.source, source)
  const bytes = encode(source)
  assert.equal(
    doc.sourceSha,
    createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
  )
  assert.match(doc.html, /callout/)
  assert.match(doc.html, /<table>/)
  assert.match(doc.html, /type="checkbox"/)
  assert.match(doc.html, /<del>/)
  assert.match(doc.html, /class="text-highlight"/)
  assert.match(doc.html, /data-rehype-pretty-code/)
  assert.match(doc.html, /katex/)
  assert.match(doc.html, /class="[^\"]*mermaid/)
  assert.match(doc.html, /print/)
  assert.ok(!doc.html.includes("never-rendered"))
  assert.deepEqual(doc.links, ["notes/b"])
  assert.match(doc.html, /target="_blank"/)
  assert.match(doc.html, /noopener noreferrer/)
  assert.match(doc.html, /data-router-ignore/)
  assert.match(doc.html, /referrerpolicy="no-referrer"/i)
  assert.deepEqual(
    doc.toc.map((item) => item.slug),
    ["主标题", "重复标题", "重复标题-1"],
  )
  for (const { slug } of doc.toc) assert.ok(doc.html.includes(`id="${slug}"`))
  assert.equal(projected.contentIndex["notes/a"].title, "a")
  assert.equal(projected.blogData.total, 2)
})

test("only published articles and resolved public embeds enter every projection surface", async () => {
  const projected = await prepareProjection(
    input([article("a"), article("secret", { published: false, title: "TOP_SECRET_TITLE" })], {
      "notes/a.md": "![[secret]] [[secret|未公开引用]]\n\n公开内容",
      "notes/secret.md": "TOP_SECRET_CONTENT ![image](../assets/private.png)",
      "assets/private.png": "TOP_SECRET_BINARY",
    }),
  )
  assert.deepEqual(
    projected.documents.map((item) => item.id),
    ["a"],
  )
  assert.deepEqual(
    projected.catalog.articles.map((item) => item.id),
    ["a"],
  )
  const publicJSON = JSON.stringify(projected)
  for (const secret of ["TOP_SECRET_TITLE", "TOP_SECRET_CONTENT", "TOP_SECRET_BINARY"])
    assert.ok(!publicJSON.includes(secret))
  assert.match(projected.documents[0].html, /unavailable-note/)
  assert.deepEqual(projected.documents[0].links, [])
  assert.equal(projected.contentIndex["notes/secret"], undefined)
})

test("whole-note, section, block, nested and sibling transclusions use the shared Quartz resolver", async () => {
  const projected = await prepareProjection(
    input([article("a"), article("b"), article("c")], {
      "notes/a.md": "![[b]]\n\n![[b#小节]]\n\n![[b#^line]]\n\n![[b#^line]]",
      "notes/b.md": "# B\n\n## 小节\n\n目标段落 ^line\n\n## 其他\n\n另外一段",
      "notes/c.md": "![[a]]",
    }),
  )
  const a = projected.documents.find((doc) => doc.id === "a")
  const c = projected.documents.find((doc) => doc.id === "c")
  assert.equal((a.html.match(/目标段落/g) || []).length, 4)
  assert.equal((a.html.match(/另外一段/g) || []).length, 1)
  assert.equal((c.html.match(/目标段落/g) || []).length, 4)
  assert.ok(a.html.includes("transclude-src"))
  assert.ok(c.html.includes("transclude-src"))
})

test("incremental compilation reuses unchanged ASTs and updates every transclusion ancestor", async () => {
  const articles = [article("a"), article("b"), article("c"), article("d")]
  const sources = {
    "notes/a.md": "![[b]]",
    "notes/b.md": "## B\n\n最初的内容",
    "notes/c.md": "[[b|普通链接]]",
    "notes/d.md": "![[a]]",
  }
  const first = await prepareProjection(input(articles, sources))
  const identical = await prepareProjection(input(articles, sources, { previous: first }))
  assert.deepEqual(identical.compilation, { parsed: 0, reused: 4 })
  assert.deepEqual(
    identical.documents.map((doc) => doc.html),
    first.documents.map((doc) => doc.html),
  )
  const updated = await prepareProjection(
    input(articles, { ...sources, "notes/b.md": "## B\n\n已经更新的内容" }, { previous: first }),
  )
  assert.deepEqual(updated.compilation, { parsed: 1, reused: 3 })
  for (const id of ["a", "b", "d"])
    assert.match(updated.documents.find((doc) => doc.id === id).html, /已经更新的内容/)
  assert.equal(
    updated.documents.find((doc) => doc.id === "c").html,
    first.documents.find((doc) => doc.id === "c").html,
  )
  const hidden = await prepareProjection(
    input(
      articles.map((a) => (a.id === "b" ? { ...a, published: false } : a)),
      sources,
      { previous: updated },
    ),
  )
  assert.ok(!JSON.stringify(hidden).includes("已经更新的内容"))
  assert.equal(hidden.contentIndex["notes/b"], undefined)
  for (const id of ["a", "c", "d"])
    assert.match(hidden.documents.find((doc) => doc.id === id).html, /unavailable-note/)
})

test("publication and ambiguity changes invalidate previously unresolved links without source edits", async () => {
  const articles = [
    article("a"),
    article("b", { file: "notes/one/target.md" }),
    article("c", { file: "notes/two/target.md" }),
  ]
  const notes = {
    "notes/a.md": "[[target]]",
    "notes/one/target.md": "one",
    "notes/two/target.md": "two",
  }
  const first = await prepareProjection(input(articles, notes))
  assert.match(first.documents[0].html, /unavailable-note/)
  const next = await prepareProjection(
    input(
      articles.map((a) => (a.id === "c" ? { ...a, published: false } : a)),
      notes,
      { previous: first },
    ),
  )
  assert.deepEqual(next.documents[0].links, ["notes/b"])
  assert.ok(!next.documents[0].html.includes("unavailable-note"))
  assert.equal(next.compilation.parsed, 1)
})

test("corrupt compressed cache recompiles canonical source when an embedded dependency changes", async () => {
  const articles = [article("a"), article("b")]
  const sources = { "notes/a.md": "![[b]]", "notes/b.md": "## B\n\n原始正文" }
  const first = await prepareProjection(input(articles, sources))
  first.documents.find((doc) => doc.id === "a").astCache = "invalid-cache"
  const next = await prepareProjection(
    input(
      articles,
      {
        ...sources,
        "notes/b.md": "## B\n\n更新后的正文",
      },
      { previous: first },
    ),
  )
  assert.match(next.documents.find((doc) => doc.id === "a").html, /更新后的正文/)
  assert.deepEqual(next.compilation, { parsed: 2, reused: 0 })
  for (const doc of next.documents) {
    assert.equal(doc.cacheEncoding, "gzip-base64-v1")
    assert.equal(typeof doc.astCache, "string")
    assert.equal(doc.htmlAst, undefined)
    assert.equal(doc.blocks, undefined)
  }
})

test("public local attachments resolve to immutable canonical Git URLs without downloading image bytes", async () => {
  const commit = "a".repeat(40)
  const projected = await prepareProjection(
    input(
      [article("a")],
      {
        "notes/a.md": "![图](../assets/中文 图.png)\n\n![[../assets/中文 图.png|原图]]",
      },
      { commit, entries: new Map([["library/assets/中文 图.png", { sha: "b".repeat(40) }]]) },
    ),
  )
  assert.match(projected.documents[0].html, /raw\.githubusercontent\.com/)
  assert.ok(
    projected.documents[0].html.includes(
      `/${commit}/library/assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png`,
    ),
  )
})

test("About content keeps the same Markdown and published-only transclusion semantics", async () => {
  const aboutSettings = structuredClone(settings)
  aboutSettings.about.body = "# 关于\n\n![[b]]\n\n$x^2$\n\n![[secret]]"
  const projected = await prepareProjection(
    input(
      [article("b"), article("secret", { published: false })],
      {
        "notes/b.md": "公开的关于引用",
        "notes/secret.md": "PRIVATE_ABOUT",
      },
      { settings: aboutSettings },
    ),
  )
  assert.match(projected.aboutHtml, /公开的关于引用/)
  assert.match(projected.aboutHtml, /katex/)
  assert.match(projected.aboutHtml, /unavailable-note/)
  assert.ok(!JSON.stringify(projected).includes("PRIVATE_ABOUT"))
})

test("cyclic embeds terminate and repeated siblings still render independently", async () => {
  const projected = await prepareProjection(
    input([article("a"), article("b")], {
      "notes/a.md": "![[b]]\n\n![[b]]",
      "notes/b.md": "循环正文\n\n![[a]]",
    }),
  )
  assert.equal((projected.documents[0].html.match(/循环正文/g) || []).length, 2)
  assert.match(projected.documents[0].html, /Circular transclusion detected/)
})

test("Git blob hashes depend on original UTF-8 bytes including BOM and CRLF", async () => {
  const plain = encode("中文\n"),
    original = encode("\uFEFF中文\r\n")
  assert.notEqual(await gitBlobSha(plain), await gitBlobSha(original))
  assert.equal(
    await gitBlobSha(original),
    createHash("sha1").update(`blob ${original.length}\0`).update(original).digest("hex"),
  )
})
