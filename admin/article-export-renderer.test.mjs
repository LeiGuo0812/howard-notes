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
  finalDocumentHeight,
  publicImageExportPlan,
  exportImageSourceDigest,
  exportImageMime,
  EXPORT_IMAGE_BYTE_LIMIT,
} from "./article-export-renderer-core.mjs"

const ownedImage = "https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202308132223603.png"
const publicArticle = {
  id: "note-2e22f4d52c4d",
  private: false,
  revision: "38",
  siteBase: "https://notes.example/howard-notes/",
}
const imageApiOptions = {
  pageUrl: "https://notes.example/howard-notes/notes/note-2e22f4d52c4d",
  trustedApiBase: "https://service.example/howard-notes/api/content",
}

test("public non-CORS images use article ordinals and revision without forwarding their URL", () => {
  const plan = publicImageExportPlan(publicArticle, 3, ownedImage, imageApiOptions)
  assert.equal(plan.source, ownedImage)
  assert.deepEqual(plan.urls, [
    "https://notes.example/howard-notes/api/content/export-image/note-2e22f4d52c4d/3?revision=38",
    "https://service.example/howard-notes/api/content/export-image/note-2e22f4d52c4d/3?revision=38",
  ])
  assert.ok(plan.urls.every((url) => !url.includes("aliyuncs")))
  assert.deepEqual(
    publicImageExportPlan(publicArticle, 0, ownedImage, {
      ...imageApiOptions,
      trustedApiBase: "https://notes.example/howard-notes/api/content/",
    }).urls,
    ["https://notes.example/howard-notes/api/content/export-image/note-2e22f4d52c4d/0?revision=38"],
  )
})

test("private and unknown reading contexts never send an image to the public API", () => {
  for (const privateValue of [true, undefined, null, "false"])
    assert.equal(
      publicImageExportPlan(
        { ...publicArticle, private: privateValue },
        0,
        ownedImage,
        imageApiOptions,
      ),
      null,
    )
  for (const patch of [
    { id: "../private" },
    { id: "" },
    { revision: "38&url=https://attacker.invalid" },
    { revision: "-1" },
    { revision: "Infinity" },
    { revision: 9007199254740992 },
    { siteBase: "https://attacker.invalid/howard-notes/" },
    { siteBase: "https://notes.example/howard-notes/?url=secret" },
    { siteBase: "https://user:secret@notes.example/howard-notes/" },
  ])
    assert.equal(
      publicImageExportPlan({ ...publicArticle, ...patch }, 0, ownedImage, imageApiOptions),
      null,
    )
  for (const index of [-1, 0.5, Infinity, "0", 10000, 10001])
    assert.equal(publicImageExportPlan(publicArticle, index, ownedImage, imageApiOptions), null)
})

test("public fallback is limited to explicit published image hosts and clean anonymous addresses", () => {
  for (const source of [
    "https://attacker.invalid/image.png",
    "https://picture-of-howard.oss-cn-shanghai.aliyuncs.com.attacker.invalid/img/1.png",
    "https://user:secret@picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/1.png",
    "https://picture-of-howard.oss-cn-shanghai.aliyuncs.com:8443/img/1.png",
    "https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/private/1.png",
    `${ownedImage}?token=secret`,
    ownedImage.replace("https:", "http:"),
    "blob:https://notes.example/private-image",
    "data:image/png;base64,aGVsbG8=",
    "javascript:alert(1)",
    `${ownedImage}\n`,
  ])
    assert.equal(publicImageExportPlan(publicArticle, 0, source, imageApiOptions), null)
  assert.equal(
    publicImageExportPlan(
      publicArticle,
      0,
      "https://cdn.nlark.com/yuque/0/2021/png/example.png#height=180&token=not-sent",
      imageApiOptions,
    ).source,
    "https://cdn.nlark.com/yuque/0/2021/png/example.png",
  )
})

test("static Pages images can check current public source identity without inventing a revision", () => {
  const plan = publicImageExportPlan(
    { ...publicArticle, revision: "" },
    2,
    ownedImage,
    imageApiOptions,
  )
  assert.equal(new URL(plan.urls[0]).search, "")
  const noTrusted = publicImageExportPlan(publicArticle, 1, ownedImage, {
    ...imageApiOptions,
    trustedApiBase: "https://user:secret@service.example/howard-notes/api/content?token=secret",
  })
  assert.equal(noTrusted.urls.length, 1)
})

test("returned public image identity is verified with SHA-256 of its canonical source", async () => {
  assert.equal(
    await exportImageSourceDigest("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  )
  const first = publicImageExportPlan(publicArticle, 0, `${ownedImage}#height=200`, imageApiOptions)
  const second = publicImageExportPlan(
    publicArticle,
    0,
    `${ownedImage}#height=800`,
    imageApiOptions,
  )
  assert.equal(
    await exportImageSourceDigest(first.source),
    await exportImageSourceDigest(second.source),
  )
  assert.notEqual(
    await exportImageSourceDigest(first.source),
    await exportImageSourceDigest(ownedImage.replace("603", "604")),
  )
})

test("image fallback validates real bitmap signatures instead of trusting a MIME header", () => {
  const png = new Uint8Array(24)
  png.set([137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(exportImageMime(png, "image/png; charset=binary"), "image/png")
  assert.equal(exportImageMime(new Uint8Array([255, 216, 255, 224]), "image/jpeg"), "image/jpeg")
  const gif = new Uint8Array(13)
  gif.set(new TextEncoder().encode("GIF89a"))
  assert.equal(exportImageMime(gif, "image/gif"), "image/gif")
  const webp = new Uint8Array(16)
  webp.set(new TextEncoder().encode("RIFF"))
  webp.set(new TextEncoder().encode("WEBP"), 8)
  assert.equal(exportImageMime(webp, "image/webp"), "image/webp")
  const avif = new Uint8Array(16)
  avif.set(new TextEncoder().encode("ftypavif"), 4)
  assert.equal(exportImageMime(avif, "image/avif"), "image/avif")
  const compatibleAvif = new Uint8Array(24)
  compatibleAvif.set(new TextEncoder().encode("ftypmif1"), 4)
  compatibleAvif.set(new TextEncoder().encode("avif"), 16)
  assert.equal(exportImageMime(compatibleAvif, "image/avif"), "image/avif")
  for (const [bytes, type] of [
    [new TextEncoder().encode("<!DOCTYPE html><html>login</html>"), "image/png"],
    [new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/svg+xml"],
    [png, "text/html"],
    [png, "image/jpeg"],
    [new Uint8Array(0), "image/png"],
    [new Uint8Array(EXPORT_IMAGE_BYTE_LIMIT + 1), "image/png"],
  ])
    assert.throws(
      () => exportImageMime(bytes, type),
      (error) => error.code === "IMAGE_INVALID",
    )
})

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

test("final capture keeps overflowing last lines and bottom reading padding", () => {
  assert.equal(
    finalDocumentHeight({
      boxHeight: 6400.2,
      scrollHeight: 6480,
      contentBottom: 6503.75,
      paddingBottom: 44,
    }),
    6548,
  )
  assert.equal(
    finalDocumentHeight({
      boxHeight: 800,
      scrollHeight: 799,
      contentBottom: 740,
      paddingBottom: 44,
    }),
    800,
  )
})

test("fractional final page fragments are covered instead of silently dropped", () => {
  const pages = pageSlices(2000.2, [], 1000)
  assert.deepEqual(pages, [
    [0, 1000],
    [1000, 2000],
    [2000, 2000.2],
  ])
  assert.equal(pages.at(-1)[1], 2000.2)
})

test("a long code block retains its final measured line across many pages", () => {
  const codeLines = Array.from({ length: 290 }, (_, index) => [
    180 + index * 23.8,
    198 + index * 23.8,
  ])
  const finalLine = codeLines.at(-1)
  const height = finalDocumentHeight({
    boxHeight: 6200,
    scrollHeight: 6200,
    contentBottom: finalLine[1],
    paddingBottom: 44,
  })
  const pages = pageSlices(height, codeLines, 1000)
  assert.ok(pages.length > 5)
  assert.equal(pages.at(-1)[1], height)
  assert.ok(
    pages.some(([start, end]) => finalLine[0] >= start && finalLine[1] < end),
    "last code line must be wholly represented on a final page",
  )
  for (let index = 1; index < pages.length; index++)
    assert.equal(pages[index - 1][1], pages[index][0])
})
