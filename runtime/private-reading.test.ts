import assert from "node:assert/strict"
import test from "node:test"
import { fromHtml } from "hast-util-from-html"
import type { Element, Root } from "hast"
import { renderPrivateReading, type PrivateReadingArticle } from "./private-reading"

const siteBase = "https://notes.example/garden/"
const article: PrivateReadingArticle = {
  id: "private-owner",
  file: "notes/技术/当前文章.md",
  title: "当前文章",
  category: "技术",
  published: false,
  date: "2026-10-02",
  tags: ["测试"],
}
const privateNote: PrivateReadingArticle = {
  ...article,
  id: "private-target",
  file: "notes/技术/私密文章.md",
  title: "私密文章",
}
const publicNote: PrivateReadingArticle = {
  ...article,
  id: "public-target",
  file: "notes/技术/公开文章.md",
  title: "公开文章",
  published: true,
}
const articles = [article, privateNote, publicNote]
function elements(html: string, tagName: string) {
  const found: Element[] = []
  function walk(node: Root | Element) {
    for (const child of node.children) {
      if (child.type !== "element") continue
      if (child.tagName === tagName) found.push(child)
      walk(child)
    }
  }
  walk(fromHtml(html, { fragment: true }))
  return found
}
const input = (raw: string, extra = {}) => ({ article, articles, raw, siteBase, ...extra })

test("private reading sanitizes active HTML while retaining formal callouts, math, code, tables and diagrams", async () => {
  const longCode = `const text = "${"long_value_".repeat(160)}"`
  const raw = `# 中文标题\n\n## 第二节\n\n### 第三节\n\n正文 **重点**\n\n> [!note] 正式提示\n> 中文引用保留\n\n行内 $x^2$ 与公式：\n\n$$\nE = mc^2\n$$\n\n\`\`\`javascript\n${longCode}\n\`\`\`\n\n| 名称 | 数据 |\n| --- | --- |\n| 长内容 | ${"表格内容".repeat(40)} |\n\n\`\`\`mermaid\ngraph LR; A-->B\n\`\`\`\n\n<script>privateAttack()</script><img src="https://images.example/a.png" onerror="privateAttack()">\n<a href="javascript:privateAttack()" onclick="privateAttack()">危险链接</a>\n`
  const result = await renderPrivateReading(input(raw))
  assert.doesNotMatch(result.html, /<script|onerror|onclick|javascript:|privateAttack\(/i)
  assert.match(result.html, /class="callout/)
  assert.match(result.html, /中文引用保留/)
  assert.match(result.html, /class="katex/)
  assert.match(result.html, /data-rehype-pretty-code-figure/)
  assert.match(result.html, /long_value_/)
  assert.match(result.html, /<table>/)
  assert.match(result.html, /表格内容/)
  assert.match(result.html, /class="mermaid"/)
  assert.match(result.html, /graph LR; A-->B/)
  assert.equal(result.toc.length, 3)
})

test("wiki and Markdown links distinguish private and public originals without changing the catalog", async () => {
  const frozen = articles.map((row) =>
    Object.freeze({ ...row, tags: Object.freeze([...row.tags!]) }),
  )
  const before = JSON.stringify(frozen)
  const raw =
    "# 当前文章\n\n## 内容\n\n[[私密文章#中文标题|私密 Wiki]]\n\n[[公开文章|公开 Wiki]]\n\n[私密 Markdown](私密文章.md#中文标题)\n\n[公开 Markdown](公开文章.md)\n\n[本地目录](#内容)\n\n[外链](https://external.example/long/link)"
  const result = await renderPrivateReading(input(raw, { articles: frozen }))
  const links = elements(result.html, "a")
  const get = (text: string) =>
    links.find((link) => link.children.some((node) => node.type === "text" && node.value === text))!
  for (const label of ["私密 Wiki", "私密 Markdown"]) {
    const url = new URL(String(get(label).properties.href))
    assert.equal(url.origin + url.pathname, "https://notes.example/garden/private/")
    assert.equal(url.searchParams.get("note"), privateNote.id)
    assert.equal(decodeURIComponent(url.hash), "#中文标题")
  }
  for (const label of ["公开 Wiki", "公开 Markdown"])
    assert.equal(get(label).properties.href, "https://notes.example/garden/notes/public-target")
  for (const link of links) {
    if (String(link.properties.href).startsWith("#"))
      assert.equal(link.properties.target, undefined)
    else {
      assert.equal(link.properties.target, "_blank")
      assert.deepEqual(link.properties.rel, ["noopener", "noreferrer"])
    }
  }
  assert.deepEqual(result.links.sort(), ["notes/private-target", "notes/public-target"])
  assert.equal(JSON.stringify(frozen), before)
  assert.equal(article.published, false)
})

test("rendering copies preserves original BOM, CRLF, frontmatter and raw bytes", async () => {
  const raw =
    "\uFEFF---\r\ntitle: 原始标题\r\ncustom: 保留原数据\r\n---\r\n# 正文\r\n\r\n## 细节\r\n\r\n[[私密文章]]\r\n"
  const bytes = new TextEncoder().encode(raw)
  const before = bytes.slice()
  const result = await renderPrivateReading(input(raw))
  const binaryResult = await renderPrivateReading({ ...input(raw), raw: bytes })
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), raw)
  assert.deepEqual(bytes, before)
  assert.equal(result.html, binaryResult.html)
  assert.match(result.html, /正文/)
  assert.doesNotMatch(result.html, /custom:|原始标题/)
})

test("only the requested original is required and missing cross-note transclusions become safe links", async () => {
  const result = await renderPrivateReading(
    input("# 当前\n\n## 正文\n\n![[私密文章#中文标题]]\n\n![[当前文章]]\n\n![[找不到的文章]]"),
  )
  assert.match(result.html, /引用内容请在原文中查看/)
  assert.match(result.html, /private-transclusion-link/)
  assert.match(result.html, /note=private-target/)
  assert.match(result.html, /note=private-owner/)
  assert.match(result.html, /unavailable-note/)
  assert.match(result.html, /找不到的文章/)
  assert.doesNotMatch(result.html, /Circular transclusion|Transclude of/)
  assert.equal(result.html.match(/<h1/g)?.length, 1)
})

test("known private wiki, Markdown and raw HTML images retain authenticated source mappings", async () => {
  const mappedArticle = {
    ...article,
    attachments: [{ source: "图像.png", aliases: ["../附件/图像.png"] }],
  }
  const direct = "https://notes.example/api/content/personal/files/opaque-id"
  const blob = "blob:https://notes.example/18db37d8-68f2-48d0-9ccf-bf46c0673d80"
  const secondBlob = "blob:https://notes.example/891264ce-9122-484e-9447-de48fb43b2b1"
  const raw = `![[图像.png|原始图像]]\n\n![相对图像](../附件/图像.png)\n\n![直接地址](${direct})\n\n<img src="${direct}" onerror="attack()" alt="HTML图像">`
  const result = await renderPrivateReading(
    input(raw, {
      article: mappedArticle,
      assetURLs: [
        ["图像.png", blob],
        [direct, secondBlob],
      ],
    }),
  )
  const images = elements(result.html, "img")
  assert.equal(images.length, 4)
  assert.deepEqual(
    images.map((image) => image.properties.src),
    [blob, blob, secondBlob, secondBlob],
  )
  assert.doesNotMatch(result.html, /private-render.invalid|onerror|attack\(/)
  assert.equal(mappedArticle.attachments[0].source, "图像.png")
  assert.equal("publicUrl" in mappedArticle.attachments[0], false)
})

test("relative mapped attachment paths work without attachment metadata and invalid URLs never become active images", async () => {
  const blob = "blob:https://notes.example/a-image"
  const result = await renderPrivateReading(
    input("![图片](../附件/图像.png)\n\n![[unknown.png]]", {
      assetURLs: [
        ["notes/附件/图像.png", blob],
        ["unknown.png", "javascript:attack()"],
      ],
    }),
  )
  assert.equal(elements(result.html, "img")[0]?.properties.src, blob)
  assert.doesNotMatch(result.html, /javascript:|attack\(|private-render.invalid/)
})

test("reserved heading fragments keep the formal sanitizer's namespaced anchor", async () => {
  const result = await renderPrivateReading(input("[[私密文章#maintenance-notice|保留锚点]]"))
  const link = elements(result.html, "a")[0]
  assert.equal(new URL(String(link.properties.href)).hash, "#note-html-maintenance-notice")
})

test("Markdown article routes and reference links resolve from metadata without a .md extension", async () => {
  const raw =
    "[私密网址](notes/private-target#内容)\n\n[公开编号](public-target)\n\n[引用形式][target]\n\n[target]: 私密文章#内容"
  const result = await renderPrivateReading(input(raw))
  const links = elements(result.html, "a")
  assert.equal(links.length, 3)
  assert.equal(
    links[0].properties.href,
    "https://notes.example/garden/private/?note=private-target#%E5%86%85%E5%AE%B9",
  )
  assert.equal(links[1].properties.href, "https://notes.example/garden/notes/public-target")
  assert.equal(links[2].properties.href, links[0].properties.href)
  assert.deepEqual(result.links.sort(), ["notes/private-target", "notes/public-target"])
  assert.equal(raw.includes("[target]: 私密文章#内容"), true)
})

test("worker returns only the requested result and a generic error without network requests or private error fragments", async () => {
  const responses: Record<string, unknown>[] = []
  const worker = {
    onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>),
    postMessage: (message: Record<string, unknown>) => responses.push(message),
  }
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, "self")
  const previousFetch = globalThis.fetch
  let networkRequests = 0
  Object.defineProperty(globalThis, "self", { configurable: true, value: worker })
  globalThis.fetch = async () => {
    networkRequests++
    throw new Error("不应请求网络")
  }
  try {
    await import(new URL("../admin/private-notes-worker.mjs", import.meta.url).href)
    assert.equal(typeof worker.onmessage, "function")
    await worker.onmessage!({ data: { id: "requested", input: input("# 授权原文\n\n正文") } })
    await worker.onmessage!({ data: { id: "invalid", input: { raw: "不应返回的私密错误内容" } } })
    assert.equal(responses[0].id, "requested")
    assert.match((responses[0].result as { html: string }).html, /授权原文/)
    assert.deepEqual(Object.keys(responses[0]).sort(), ["id", "result"])
    assert.deepEqual(responses[1], { id: "invalid", error: "笔记暂时无法显示，请重试。" })
    assert.equal(networkRequests, 0)
    assert.doesNotMatch(JSON.stringify(responses), /不应返回的私密错误内容/)
  } finally {
    globalThis.fetch = previousFetch
    if (previousSelf) Object.defineProperty(globalThis, "self", previousSelf)
    else Reflect.deleteProperty(globalThis, "self")
  }
})
