import test from "node:test"
import assert from "node:assert/strict"
import {
  imageCaptureScale,
  imageCapturePlan,
  EXPORT_WIDTH,
  MIN_IMAGE_SCALE,
  IMAGE_PIXEL_BUDGET,
  IMAGE_SIDE_LIMIT,
  pageSlices,
  ArticleExportError,
  MAX_PDF_PAGES,
} from "./article-export-renderer-core.mjs"

test("high quality images default to 2700px desktop and 2250px mobile widths", () => {
  assert.equal(imageCaptureScale(1200), 3)
  assert.equal(imageCaptureScale(1200, { mobile: true }), 2.5)
  assert.equal(imageCapturePlan(1200).width, 2700)
  assert.equal(imageCapturePlan(1200, { mobile: true }).width, 2250)
  assert.equal(imageCapturePlan(1200).reduced, false)
})
test("standard quality retains a 2x bitmap independently of screen density", () => {
  assert.equal(imageCaptureScale(1200, { quality: "standard" }), 2)
  assert.equal(imageCaptureScale(1200, { mobile: true, quality: "standard" }), 2)
  assert.equal(imageCapturePlan(1200, { quality: "standard" }).width, EXPORT_WIDTH * 2)
})
test("larger images reduce resolution only within the crisp 1.5x floor", () => {
  const desktop = imageCapturePlan(20000)
  assert.ok(desktop.scale >= MIN_IMAGE_SCALE)
  assert.ok(desktop.scale < desktop.requestedScale)
  assert.ok(desktop.width * desktop.height <= IMAGE_PIXEL_BUDGET.desktop)
  assert.ok(desktop.height <= IMAGE_SIDE_LIMIT.desktop)
  assert.equal(desktop.reduced, true)
  const mobile = imageCapturePlan(7500.7, { mobile: true })
  assert.ok(mobile.scale >= MIN_IMAGE_SCALE)
  assert.ok(mobile.scale < mobile.requestedScale)
  assert.ok(mobile.width * mobile.height <= IMAGE_PIXEL_BUDGET.mobile)
  assert.ok(mobile.height <= IMAGE_SIDE_LIMIT.mobile)
  assert.equal(mobile.reduced, true)
})
test("fractional article heights and requested scales respect actual bitmap budgets", () => {
  for (const mobile of [false, true]) {
    for (const height of [1200.3, 5000.9, 7000.01]) {
      const plan = imageCapturePlan(height, { mobile, preferredScale: 3.7 })
      assert.ok(plan.width * plan.height <= plan.pixelBudget)
      assert.ok(plan.width <= plan.sideLimit)
      assert.ok(plan.height <= plan.sideLimit)
      assert.ok(plan.scale <= 3.7)
    }
  }
})
test("image edge limits apply to both dimensions even for custom capture scales", () => {
  const desktop = imageCapturePlan(21840)
  assert.equal(desktop.scale, 1.5)
  assert.ok(desktop.height <= IMAGE_SIDE_LIMIT.desktop)
  const wide = imageCapturePlan(1, { preferredScale: 100 })
  assert.ok(wide.width <= IMAGE_SIDE_LIMIT.desktop)
  assert.ok(wide.width * wide.height <= IMAGE_PIXEL_BUDGET.desktop)
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
  assert.throws(
    () => imageCaptureScale(8000, { mobile: true }),
    (error) => error.code === "IMAGE_TOO_LONG",
  )
  assert.throws(
    () => imageCaptureScale(24000),
    (error) => error.code === "IMAGE_TOO_LONG",
  )
})
test("invalid dimensions and unsupported image quality never produce an invalid canvas", () => {
  for (const height of [NaN, Infinity, -1]) {
    assert.throws(
      () => imageCaptureScale(height),
      (error) => error.code === "EMPTY_ARTICLE",
    )
  }
  for (const preferredScale of [NaN, Infinity, 0, 1.49]) {
    assert.throws(
      () => imageCaptureScale(1200, { preferredScale }),
      (error) => error.code === "INVALID_IMAGE_QUALITY",
    )
  }
  assert.throws(
    () => imageCaptureScale(1200, { quality: "invalid" }),
    (error) => error.code === "INVALID_IMAGE_QUALITY",
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
