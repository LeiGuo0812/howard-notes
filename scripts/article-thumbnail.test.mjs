import test from "node:test"
import assert from "node:assert/strict"
import { fromHtml } from "hast-util-from-html"
import {
  extractArticleThumbnail,
  renderedArticleThumbnails,
  thumbnailSource,
} from "./lib/article-thumbnail.mjs"

test("thumbnail extraction chooses the first actual image and ignores code, comments and dangerous sources", () => {
  const tree = fromHtml(
    '<!-- <img src="https://example.test/comment.png"> -->' +
      '<pre><code><img src="https://example.test/code.png"></code></pre>' +
      '<template><img src="https://example.test/template.png"></template>' +
      '<img src="javascript:alert(1)"><img src="data:image/svg+xml,anything">' +
      '<img src="https://example.test/figure.svg" alt="图示"><img src="/later.png">',
    { fragment: true },
  )
  assert.deepEqual(extractArticleThumbnail(tree, "notes/article"), {
    src: "https://example.test/figure.svg",
    alt: "图示",
  })
})

test("thumbnail sources preserve safe external URLs and normalize article-relative attachments", () => {
  assert.equal(
    thumbnailSource("../assets/中文 图.png", "notes/a"),
    "assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png",
  )
  assert.equal(thumbnailSource("//example.test/image?width=100"), "//example.test/image?width=100")
  assert.equal(
    thumbnailSource("/howard-notes/assets/figure.svg"),
    "/howard-notes/assets/figure.svg",
  )
  assert.equal(
    thumbnailSource("https://example.test/image?width=100"),
    "https://example.test/image?width=100",
  )
  for (const unsafe of [
    "javascript:alert(1)",
    "https:ambiguous-relative.png",
    "data:image/png;base64,payload",
    "blob:https://example.test/file",
    "file:///private/image.png",
    "https://user:password@example.test/a.png",
    "java\nscript:alert(1)",
    "\\\\example.test/a.png",
    "../../outside.png",
    "#anchor",
    "",
  ])
    assert.equal(thumbnailSource(unsafe, "notes/a"), undefined, unsafe)
})

test("static thumbnails support Markdown references, raw HTML, dimensions and missing-image notes without changing input", () => {
  const note =
    "\uFEFF---\r\ntype: article\r\n---\r\n" +
    '```html\r\n<img src="https://example.test/code.png">\r\n```\r\n\r\n' +
    "![架构|400][figure]\r\n\r\n[figure]: ../assets/architecture.svg\r\n"
  const output = new Map([
    ["notes/a.md", Buffer.from(note)],
    ["notes/html.md", Buffer.from('<img src="https://example.test/first.png" alt="HTML 图">')],
    ["notes/none.md", Buffer.from("正文中 `![不是图片](https://example.test/code.png)`")],
    ["about.md", Buffer.from("![不属于文章](https://example.test/about.png)")],
  ])
  const thumbnails = renderedArticleThumbnails(output)
  assert.deepEqual(thumbnails.get("a"), { src: "assets/architecture.svg", alt: "架构" })
  assert.deepEqual(thumbnails.get("html"), {
    src: "https://example.test/first.png",
    alt: "HTML 图",
  })
  assert.equal(thumbnails.has("none"), false)
  assert.equal(thumbnails.has("about"), false)
  assert.equal(output.get("notes/a.md").toString(), note)
})
