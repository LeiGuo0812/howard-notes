import test from "node:test"
import assert from "node:assert/strict"
import {
  imageCaptureScale,
  pageSlices,
  ArticleExportError,
  MAX_PDF_PAGES,
} from "./article-export-renderer-core.mjs"

test("short image retains a crisp scale while long image honors desktop pixel budget", () => {
  assert.equal(imageCaptureScale(1200), 1.5)
  const scale = imageCaptureScale(20000)
  assert.ok(900 * 20000 * scale * scale <= 24_000_000)
  assert.ok(20000 * scale <= 32760)
})
test("mobile long image uses a smaller pixel and edge budget", () => {
  const scale = imageCaptureScale(12000, { mobile: true })
  assert.ok(900 * 12000 * scale * scale <= 12_000_000)
  assert.ok(12000 * scale <= 16384)
})
test("unsafe long images produce a useful PDF fallback instead of a blank canvas", () => {
  assert.throws(
    () => imageCaptureScale(50000),
    (error) => error instanceof ArticleExportError && error.code === "IMAGE_TOO_LONG",
  )
  assert.throws(
    () => imageCaptureScale(0),
    (error) => error.code === "EMPTY_ARTICLE",
  )
})
test("PDF slices preserve all content and stop before text lines and table rows", () => {
  const pages = pageSlices(
    2700,
    [
      [940, 1000],
      [970, 1010],
      [1870, 1950],
    ],
    1000,
  )
  assert.deepEqual(pages, [
    [0, 939],
    [939, 1869],
    [1869, 2700],
  ])
  assert.equal(pages[0][0], 0)
  assert.equal(pages.at(-1)[1], 2700)
  for (let index = 1; index < pages.length; index++)
    assert.equal(pages[index - 1][1], pages[index][0])
})
test("oversized atomic content cannot create an infinite pagination loop", () => {
  const pages = pageSlices(2200, [[0, 2100]], 1000)
  assert.deepEqual(pages, [
    [0, 1000],
    [1000, 2000],
    [2000, 2200],
  ])
})
test("PDF page count is bounded and invalid intervals are ignored", () => {
  assert.deepEqual(
    pageSlices(400, [
      [NaN, 9],
      [40, Infinity],
      [20, 10],
    ]),
    [[0, 400]],
  )
  assert.throws(
    () => pageSlices((MAX_PDF_PAGES + 1) * 1000, [], 1000),
    (error) => error.code === "PDF_TOO_LONG",
  )
})
