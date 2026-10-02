import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib"
import { repairCffSubset, pdfFontkit } from "./article-export-pdf-fontkit.mjs"
import {
  graphemes,
  supportedTextChunks,
  pdfColor,
  textPageIndex,
  glyphTransform,
  PDF_POINT_PER_CSS_PIXEL,
  PDF_MARGIN_POINTS,
  PDF_PAGE_POINTS,
} from "./article-export-pdf-core.mjs"

test("grapheme geometry keeps Chinese, surrogate pairs and combining marks intact", () => {
  assert.deepEqual(
    graphemes("中Á😀").map((unit) => unit.text),
    ["中", "Á", "😀"],
  )
  assert.deepEqual(
    graphemes("中😀").map(({ start, end }) => [start, end]),
    [
      [0, 1],
      [1, 3],
    ],
  )
})
test("unsupported glyphs retain their image without forfeiting adjacent selectable text", () => {
  assert.deepEqual(
    supportedTextChunks("中文😀 text", (text) => text !== "😀"),
    [
      { text: "中文", supported: true },
      { text: "😀", supported: false },
      { text: " text", supported: true },
    ],
  )
})
test("CSS text colors preserve code, links, emphasis and alpha", () => {
  assert.deepEqual(pdfColor("rgb(32, 42, 53)"), {
    red: 32 / 255,
    green: 42 / 255,
    blue: 53 / 255,
    opacity: 1,
  })
  assert.equal(pdfColor("rgba(0, 128, 255, 0.4)").opacity, 0.4)
  assert.equal(pdfColor("rgb(0 128 255 / 0.5)").blue, 1)
})
test("a line belongs to exactly one PDF page, including a boundary baseline", () => {
  const pages = [
    [0, 1000],
    [1000, 1900],
  ]
  assert.equal(textPageIndex({ baseline: 990 }, pages), 0)
  assert.equal(textPageIndex({ baseline: 1000 }, pages), 1)
  assert.equal(textPageIndex({ baseline: 1900 }, pages), 1)
  assert.equal(textPageIndex({ baseline: -2 }, pages), -1)
})
test("glyph placement maps measured CSS widths and baselines into A4 geometry", () => {
  const run = { fontSize: 20, left: 48, baseline: 1030, width: 20, fontStyle: "italic" }
  const transform = glyphTransform(run, 10, 1000)
  assert.equal(transform.x, PDF_MARGIN_POINTS + 48 * PDF_POINT_PER_CSS_PIXEL)
  assert.equal(transform.y, PDF_PAGE_POINTS[1] - PDF_MARGIN_POINTS - 30 * PDF_POINT_PER_CSS_PIXEL)
  assert.equal(transform.size, 20 * PDF_POINT_PER_CSS_PIXEL)
  assert.equal(transform.horizontal, 2 * PDF_POINT_PER_CSS_PIXEL)
  assert.equal(transform.italic, 0.18)
})

test("CID subset preserves header offSize and maps repeated font dictionaries correctly", () => {
  const cff = {
    offSize: 3,
    length: 24,
    isCIDFont: true,
    fdForGlyph: (glyph) => ({ 0: 5, 1: 2, 2: 5, 3: 7, 4: 2 })[glyph],
    topDict: {
      FDArray: Array.from({ length: 8 }, (_, index) => ({
        FontName: index,
        Private: { Subrs: [0, 1, 2] },
      })),
    },
  }
  const subset = repairCffSubset({
    cff,
    glyphs: [0, 1, 2, 3, 4],
    font: { getGlyph: (glyph) => ({ path: [], _usedSubrs: { [glyph % 3]: true } }) },
    subsetSubrs: (_, used) => Object.keys(used).map(Number),
  })
  assert.equal(subset.cff.length, 3)
  assert.equal(cff.length, 24)
  const dictionary = {}
  subset.subsetFontdict(dictionary)
  assert.deepEqual(dictionary.FDSelect.fds, [0, 1, 0, 2, 1])
  assert.deepEqual(
    dictionary.FDArray.map(({ Private }) => Private.Subrs),
    [[0, 2], [1], [0]],
  )
  assert.ok(dictionary.FDArray.every((entry) => !("FontName" in entry)))
  assert.equal(cff.topDict.FDArray[2].FontName, 2)
})

test("actual Noto CJK subsets embed legal CFF headers and Unicode text maps", async () => {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(pdfFontkit)
  const page = pdf.addPage()
  for (const weight of ["Regular", "Bold"]) {
    const bytes = await readFile(
      new URL(`../assets/article-pdf-fonts/NotoSansSC-${weight}.otf`, import.meta.url),
    )
    const font = await pdf.embedFont(bytes, {
      subset: true,
      customName: `TESTAB+NotoSansSC-${weight}`,
    })
    // Re-enter previous dictionaries repeatedly: Latin, Han and symbols have
    // different CID font dictionaries, which exercised the upstream defect.
    page.drawText("中文English测试字体123αβγ→中文English", { font, size: 18 })
  }
  const saved = await pdf.save()
  assert.ok(saved.length < 250000, "only used font glyphs should be embedded")
  const loaded = await PDFDocument.load(saved)
  const resources = loaded.getPages()[0].node.Resources()
  const fonts = resources.lookup(PDFName.of("Font"), PDFDict)
  for (const [, reference] of fonts.entries()) {
    const dictionary = loaded.context.lookup(reference, PDFDict)
    const descendants = dictionary.lookup(PDFName.of("DescendantFonts"))
    const descriptor = loaded.context
      .lookup(descendants.get(0), PDFDict)
      .lookup(PDFName.of("FontDescriptor"), PDFDict)
    const program = descriptor.lookup(PDFName.of("FontFile3"), PDFRawStream)
    const header = decodePDFRawStream(program).decode()
    assert.equal(header[0], 1)
    assert.equal(header[2], 4)
    assert.ok(header[3] >= 1 && header[3] <= 4, "CFF offSize is a byte width, not the INDEX length")
    const unicode = decodePDFRawStream(
      dictionary.lookup(PDFName.of("ToUnicode"), PDFRawStream),
    ).decode()
    assert.match(new TextDecoder().decode(unicode), /4E2D/i)
  }
})
