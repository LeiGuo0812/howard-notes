import test from "node:test"
import assert from "node:assert/strict"
import type { Element, Root } from "hast"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { Fragment, jsx, jsxs } from "preact/jsx-runtime"
import renderToString from "preact-render-to-string"
import { prepareArticleLinks } from "./article-links"
import { prepareArticleImages } from "./article-images"

const link = (href: string, properties: Element["properties"] = {}): Element => ({
  type: "element",
  tagName: "a",
  properties: { href, ...properties },
  children: [{ type: "text", value: "链接" }],
})

test("article wiki, external, fragment and download links open independently without changing their destinations", () => {
  for (const href of [
    "../notes/another-note",
    "https://example.test/guide",
    "#section",
    "/files/code.zip",
    "",
  ]) {
    const source = link(href, { className: ["internal"], target: "_self", title: "原有提示" })
    const original = structuredClone(source)
    const rendered = prepareArticleLinks(source)
    assert.equal(rendered.properties.href, href)
    assert.equal(rendered.properties.target, "_blank")
    assert.deepEqual(rendered.properties.rel, ["noopener", "noreferrer"])
    assert.equal(rendered.properties.dataRouterIgnore, "")
    assert.deepEqual(rendered.properties.className, ["internal"])
    assert.equal(rendered.properties.title, "原有提示")
    assert.deepEqual(source, original)
  }
})

test("nested article links retain rel tokens and become safe when clicked through child elements", () => {
  const legacyRelLink = link("https://example.test")
  // Tolerate legacy transformer output that supplied the HTML rel string directly.
  Object.assign(legacyRelLink.properties, { rel: "author sponsored noreferrer" })
  const source: Root = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            ...link("../notes/another-note", { rel: ["nofollow", "noopener"] }),
            children: [
              {
                type: "element",
                tagName: "strong",
                properties: {},
                children: [{ type: "text", value: "嵌套标题" }],
              },
            ],
          },
          legacyRelLink,
        ],
      },
    ],
  }
  const original = structuredClone(source)
  const rendered = prepareArticleLinks(source)
  const html = renderToString(toJsxRuntime(rendered, { Fragment, jsx, jsxs }))
  assert.match(html, /target="_blank"/)
  assert.match(html, /data-router-ignore(?:="")?[ >]/)
  assert.match(html, /rel="nofollow noopener noreferrer"/)
  assert.match(html, /rel="author sponsored noreferrer noopener"/)
  assert.match(html, /<strong>嵌套标题<\/strong>/)
  assert.deepEqual(source, original)
  assert.deepEqual(prepareArticleLinks(rendered), rendered)
})

test("anchors without href and unrelated elements remain unchanged", () => {
  for (const source of [
    { type: "element", tagName: "a", properties: { id: "heading" }, children: [] },
    { type: "element", tagName: "span", properties: { href: "../notes/one" }, children: [] },
    { type: "text", value: "正文" },
  ] as const) {
    assert.deepEqual(prepareArticleLinks(source), source)
  }
})

test("article link and image transforms compose without mutating the source tree", () => {
  const source: Root = {
    type: "root",
    children: [
      {
        ...link("https://example.test/full-image"),
        children: [
          {
            type: "element",
            tagName: "img",
            properties: { src: "https://cdn.nlark.com/image.png", alt: "原图片" },
            children: [],
          },
        ],
      },
    ],
  }
  const original = structuredClone(source)
  const rendered = prepareArticleLinks(prepareArticleImages(source))
  const html = renderToString(toJsxRuntime(rendered, { Fragment, jsx, jsxs }))
  assert.match(html, /target="_blank"/)
  assert.match(html, /data-router-ignore(?:="")?[ >]/)
  assert.match(html, /referrerpolicy="no-referrer"/i)
  assert.deepEqual(source, original)
})
