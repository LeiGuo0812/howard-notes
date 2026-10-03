import test from "node:test"
import assert from "node:assert/strict"
import { compileEditorPreview } from "./editor-preview"
import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
const article = { id: "preview-note", file: "notes/current.md", title: "当前", published: false }
test("editor preview uses formal callouts math highlighting diagrams and safe private links", async () => {
  const input = {
    article,
    articles: [{ id: "other", file: "notes/other.md", title: "私密目标", published: false }],
    siteBase: "https://notes.test/site/",
    raw: "> [!note] 提示\n> 内容\n\n$x^2$\n\n```js\nconst answer = 42\n```\n\n```mermaid\ngraph LR; A-->B\n```\n\n[[私密目标]]\n\n<script>alert(1)</script><img src=x onerror=alert(2)>",
  }
  const result = await compileEditorPreview(input)
  assert.match(result.html, /class="callout/)
  assert.match(result.html, /class="katex/)
  assert.match(result.html, /data-rehype-pretty-code-figure/)
  assert.match(result.html, /class="mermaid"/)
  assert.match(result.html, /private\/\?note=other/)
  assert.doesNotMatch(result.html, /onerror|<script|alert\(/)
  assert.equal(input.raw.includes("[[私密目标]]"), true)
})
test("relative wiki markdown reference and raw HTML images remain owner-resolvable without worker fetches", async () => {
  const result = await compileEditorPreview({
    article,
    articles: [],
    siteBase: "https://notes.test/site/",
    raw: '![[picture.png]]\n\n![图](../assets/local.jpg)\n\n![图][source]\n\n[source]: ../assets/reference.png\n\n<img src="private.png">\n\n![外链](https://images.test/public.png)',
  })
  const images: any[] = []
  visit(fromHtml(result.html, { fragment: true }), (node) => {
    if (node.type === "element" && node.tagName === "img") images.push(node.properties)
  })
  assert.deepEqual(
    images.map((image) => image.dataPreviewSource || image.src),
    [
      "picture.png",
      "../assets/local.jpg",
      "../assets/reference.png",
      "private.png",
      "https://images.test/public.png",
    ],
  )
  assert.ok(images.slice(0, 4).every((image) => !image.src))
  assert.doesNotMatch(result.html, /editor-preview.invalid/)
})
