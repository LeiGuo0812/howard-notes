import test from "node:test"
import assert from "node:assert/strict"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { sanitizeArticleHtml, sanitizeSourceTree, safeArticleStyle } from "./article-security"
import { createMdProcessor, createHtmlProcessor } from "../processors/parse"
import { createMarkdownCompiler } from "../../runtime/markdown"
import { ObsidianFlavoredMarkdown } from "@quartz-community/obsidian-flavored-markdown"
import { GitHubFlavoredMarkdown } from "@quartz-community/github-flavored-markdown"
import { TableOfContentsTransformer } from "@quartz-community/table-of-contents"
import { VFile } from "vfile"
import type { BuildCtx } from "./ctx"

test("rendered copies remove active HTML, handlers, SVG execution and dangerous URLs", () => {
  const source = `<p>保留原文 <strong>重点</strong></p>
  <script>stealSession()</script><style>body{display:none}</style>
  <img src="https://images.example/p.png" onerror="stealSession()">
  <a href="jav&#x61;script:stealSession()" onclick="stealSession()">不安全链接</a>
  <a href="data:text/html,attack">数据链接</a><a href="mailto:me@example.test">邮件</a>
  <iframe srcdoc="<script>attack()</script>"></iframe>
  <object data="https://attacker.test"></object><form action="https://attacker.test"><input name="token"></form>
  <svg onload="stealSession()"><foreignObject><img src=x onerror=stealSession()></foreignObject><script>attack()</script><path d="M0 0h3" fill="url(https://attacker.test/p.svg#x)"></path></svg>`
  const html = sanitizeArticleHtml(source)
  assert.doesNotMatch(
    html,
    /<script|<style|<iframe|<form|<object|<foreignObject|stealSession|attack\(|onerror|onclick|onload|javascript:|data:text\/html|attacker\.test/i,
  )
  assert.match(html, /保留原文 <strong>重点<\/strong>/)
  assert.match(html, /src="https:\/\/images\.example\/p\.png"/)
  assert.match(html, /href="mailto:me@example.test"/)
  assert.match(html, /<svg><path d="M0 0h3"><\/path><\/svg>/)
  assert.ok(source.includes("stealSession()"), "the original source was not edited")
})

test("clobbering IDs are namespaced and matching in-note links remain usable", () => {
  const tree = fromHtml(
    `<a id="__howardContentIndex" name="fetchData"></a><div id="main-content"></div><a href="#__howardContentIndex">跳转</a><span id="t0"></span>`,
    { fragment: true },
  )
  const html = toHtml(sanitizeSourceTree(tree))
  assert.doesNotMatch(html, /\bname=|id="__howardContentIndex"|id="main-content"/)
  assert.match(html, /id="note-html-__howardContentIndex"/)
  assert.match(html, /href="#note-html-__howardContentIndex"/)
  assert.match(html, /id="t0"/)
})

test("legitimate headings, callouts, tasklists, code, diagrams, tables and safe SVG survive", () => {
  const html = sanitizeArticleHtml(`<h2 id="中文标题">中文标题</h2>
  <blockquote class="callout callout-info" data-callout="info"><p>提示</p></blockquote>
  <table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>
  <input type="checkbox" checked><pre data-language="js" data-rehype-pretty-code-figure=""><code class="language-js"><span style="color:#ff0000;--shiki-dark:#abcdef" data-line="">const a=1</span></code></pre>
  <pre><code class="mermaid" data-clipboard='"graph LR; A-->B"'>graph LR; A--&gt;B</code><button class="expand-button" aria-label="展开"></button><div id="mermaid-container"><div id="mermaid-space"></div></div></pre>
  <span class="katex"><span style="height:1.2em;vertical-align:-0.2em">数学</span><svg viewBox="0 0 10 10"><path d="M0 0 L5 5" fill="currentColor"></path></svg></span>`)
  for (const expected of [
    'id="中文标题"',
    'data-callout="info"',
    "<table>",
    'type="checkbox"',
    "disabled",
    "data-rehype-pretty-code-figure",
    "data-clipboard",
    'class="expand-button"',
    'id="mermaid-container"',
    'id="mermaid-space"',
    'class="katex"',
    'viewBox="0 0 10 10"',
  ])
    assert.ok(html.includes(expected), expected)
  assert.match(html, /color:#ff0000;--shiki-dark:#abcdef/)
  assert.match(html, /height:1.2em;vertical-align:-0.2em/)
  assert.equal(sanitizeArticleHtml(html), html, "sanitizing a reused fragment is idempotent")
})

test("CSS cannot fetch resources or pin content over the maintenance UI", () => {
  const style = safeArticleStyle(
    "color:#123456;background:url(https://attacker.test/log);position:fixed;z-index:99999;--evil:expression(alert(1));height:2em;--shiki-dark:#abcdef",
  )
  assert.equal(style, "color:#123456;height:2em;--shiki-dark:#abcdef")
  assert.equal(
    safeArticleStyle('color:e\\78pression(alert(1));background:image-set("https://attacker.test")'),
    undefined,
  )
})

test("only raster image data URIs and disabled task checkboxes remain", () => {
  const html = sanitizeArticleHtml(
    '<img src="data:image/png;base64,YQ=="><img src="data:image/svg+xml;base64,YQ=="><input type="password" name="token"><input type="checkbox" onclick="attack()">',
  )
  assert.match(html, /data:image\/png;base64,YQ==/)
  assert.doesNotMatch(html, /data:image\/svg|password|name=|onclick/)
  assert.equal((html.match(/disabled/g) || []).length, 2)
})

test("static and live compiler pipelines enforce the same safe article boundary", async () => {
  const source =
    '# 标题\n\n## maintenance-notice\n\n正文 **重点** <script>stealToken()</script>\n\n<img src="https://images.example/a.png" onerror="stealToken()">\n\n> [!info] 提示\n> 可读内容\n\n```mermaid\ngraph LR; A-->B\n```'
  const ctx = {
    allSlugs: ["notes/test"],
    argv: { directory: "content" },
    cfg: {
      configuration: { locale: "zh-CN" },
      plugins: {
        transformers: [
          ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false, enableCheckbox: true }),
          GitHubFlavoredMarkdown(),
          TableOfContentsTransformer(),
        ],
      },
    },
  } as unknown as BuildCtx
  const file = new VFile({ value: source, path: "content/notes/test.md" })
  file.data = { slug: "notes/test" as any, frontmatter: { title: "标题", tags: [] } } as any
  const markdown = createMdProcessor(ctx)
  const md = await markdown.run(markdown.parse(file), file)
  const staticTree = await createHtmlProcessor(ctx).run(md, file)
  const live = await createMarkdownCompiler(["notes/test"])(
    source,
    { title: "标题", tags: [] },
    "notes/test",
  )
  for (const tree of [staticTree, live.tree]) {
    const html = toHtml(tree)
    assert.doesNotMatch(html, /<script|onerror|stealToken/)
    assert.match(html, /class="callout/)
    assert.match(html, /data-clipboard/)
    assert.match(html, /id="note-html-maintenance-notice"/)
    assert.match(html, /href="#note-html-maintenance-notice"/)
  }
  assert.equal(file.data.toc?.[1].slug, "note-html-maintenance-notice")
  assert.equal((live.data.toc as { slug: string }[])[1].slug, "note-html-maintenance-notice")
  assert.equal(file.value, source)
})
