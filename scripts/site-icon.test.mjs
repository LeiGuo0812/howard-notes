import test from "node:test"
import assert from "node:assert/strict"
import sharp from "sharp"
import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
import { brandIcon, brandIconLinks, renderBrandIconFiles } from "./lib/site-icon.mjs"
import { brandIconSvg, brandIconDataLink } from "./lib/site-icon-svg.mjs"

const settings = { brand: { name: "Howard", mark: "h." }, accent: "blue" }

test("pure SVG generation preserves the pre-extraction static icon bytes and hash", async () => {
  const svg = brandIconSvg(settings)
  const staticIcon = brandIcon(settings)
  assert.equal(svg, staticIcon.svg)
  assert.equal(staticIcon.version, "69ccdc737fe8")
  assert.equal(staticIcon.basename, "howard-icon-69ccdc737fe8")
  const { files } = await renderBrandIconFiles(settings)
  assert.ok(files.get(`static/${staticIcon.basename}.svg`).equals(Buffer.from(svg)))
})

test("live SVG favicon URI updates branding and encodes literal custom XML inside one safe link", () => {
  const custom = {
    ...settings,
    brand: { name: 'Howard " onload="alert(1)', mark: "<&>'\"" },
    design: { accentColor: "#804a5a" },
  }
  const markup = brandIconDataLink(custom)
  assert.notEqual(markup, brandIconDataLink(settings))
  const nodes = []
  visit(fromHtml(markup, { fragment: true }), "element", (node) => nodes.push(node))
  assert.equal(nodes.length, 1)
  const link = nodes[0]
  assert.equal(link.tagName, "link")
  assert.equal(link.properties.rel[0], "icon")
  assert.equal(link.properties.type, "image/svg+xml")
  assert.equal(link.properties.sizes, "any")
  const svg = decodeURIComponent(link.properties.href.slice("data:image/svg+xml,".length))
  assert.equal(svg, brandIconSvg(custom))
  assert.match(svg, /fill="#804a5a"/)
  const elements = []
  visit(fromHtml(svg, { fragment: true }), "element", (node) => elements.push(node))
  assert.equal(
    elements.find((node) => node.tagName === "text").children[0].value,
    custom.brand.mark,
  )
  assert.equal(
    elements.find((node) => node.tagName === "svg").properties.ariaLabel,
    custom.brand.name,
  )
  assert.ok(elements.every((node) => !Object.hasOwn(node.properties, "onload")))
})

test("favicon URLs change with the displayed brand and accent but remain stable for identical settings", () => {
  const original = brandIcon(settings)
  assert.equal(brandIcon(structuredClone(settings)).basename, original.basename)
  assert.notEqual(
    brandIcon({ ...settings, brand: { ...settings.brand, mark: "H" } }).basename,
    original.basename,
  )
  assert.notEqual(
    brandIcon({ ...settings, design: { accentColor: "#804a5a" } }).basename,
    original.basename,
  )
  assert.equal(
    brandIconLinks(settings, "../..").includes(`../../static/${original.basename}.svg`),
    true,
  )
})

test("custom brand labels remain literal SVG text rather than markup or attributes", () => {
  const { svg } = brandIcon({
    ...settings,
    brand: { name: 'Howard " onload="alert(1)', mark: "<&>'\"" },
  })
  const nodes = []
  visit(fromHtml(svg, { fragment: true }), "element", (node) => nodes.push(node))
  const root = nodes.find((node) => node.tagName === "svg")
  assert.equal(root.properties.ariaLabel, 'Howard " onload="alert(1)')
  assert.equal(Object.hasOwn(root.properties, "onload"), false)
  assert.equal(
    nodes.some((node) => node.tagName === "script"),
    false,
  )
  assert.equal(nodes.find((node) => node.tagName === "text").children[0].value, "<&>'\"")
})

test("favicon is a real multi-frame ICO with decodable PNG sizes and transparent rounded corners", async () => {
  const { files, basename } = await renderBrandIconFiles(settings)
  const ico = files.get("favicon.ico")
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 3)
  for (let index = 0; index < 3; index++) {
    const entry = 6 + index * 16
    const size = ico[entry]
    const start = ico.readUInt32LE(entry + 12)
    const frame = ico.subarray(start, start + ico.readUInt32LE(entry + 8))
    const metadata = await sharp(frame).metadata()
    assert.equal(metadata.format, "png")
    assert.equal(metadata.width, size)
    assert.equal(metadata.height, size)
    assert.ok([16, 32, 48].includes(size))
    const { data, info } = await sharp(frame)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    assert.equal(data[3], 0)
    assert.ok(data[((size >> 1) * info.width + (size >> 1)) * 4 + 3] > 250)
  }
  for (const [file, size] of [
    [`static/${basename}-180.png`, 180],
    ["static/icon.png", 512],
  ]) {
    const metadata = await sharp(files.get(file)).metadata()
    assert.equal(metadata.width, size)
    assert.equal(metadata.height, size)
  }
})
