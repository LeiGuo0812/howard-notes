import test from "node:test"
import assert from "node:assert/strict"
import {
  SITE_PALETTES,
  getSitePalette,
  paletteVariables,
  paletteCategory,
} from "./lib/site-palettes.mjs"

const luminance = (hex) => {
  const channels = hex.match(/[\da-f]{2}/gi).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test("legacy and invalid selections own no CSS variables; selection never mutates settings", () => {
  for (const value of [
    undefined,
    null,
    {},
    { design: {} },
    "current",
    "unknown",
    "__proto__",
    "x; color:red",
  ])
    assert.deepEqual(paletteVariables(value), {})
  const settings = { design: { palette: "minimal-soft", accentColor: "#123456" } }
  const before = structuredClone(settings)
  assert.equal(getSitePalette(settings), getSitePalette("minimal-soft"))
  assert.equal(getSitePalette(settings.design), getSitePalette("minimal-soft"))
  const variables = paletteVariables(settings)
  assert.equal(variables["--site-palette-page-light"], "#f9f2e7")
  assert.equal(variables["--site-palette-signal-light"], "#e99f72")
  assert.equal(variables["--site-palette-reader-light"], "#f7f8f8")
  assert.ok(!Object.hasOwn(variables, "--site-accent-light"))
  assert.deepEqual(settings, before)
  variables["--site-palette-page-light"] = "#000000"
  assert.equal(paletteVariables(settings)["--site-palette-page-light"], "#f9f2e7")
})

test("preset catalog is deeply immutable and contains colors only", () => {
  assert.equal(SITE_PALETTES.length, 6)
  assert.equal(new Set(SITE_PALETTES.map((palette) => palette.id)).size, 6)
  assert.throws(() => SITE_PALETTES.push({}), TypeError)
  assert.throws(() => (SITE_PALETTES[0].light.page = "#000000"), TypeError)
  const multicolor = getSitePalette("clean-multicolor")
  assert.throws(() => (multicolor.categories.light[0].bg = "#000000"), TypeError)
  for (const palette of SITE_PALETTES)
    for (const [key, value] of Object.entries(paletteVariables(palette.id))) {
      assert.match(key, /^--site-palette-[a-z\d-]+-(light|dark)$/)
      assert.match(value, /^#[\da-f]{6}$/i)
      assert.doesNotMatch(key, /blur|shadow|radius|motion|animation|mouse|size|gap/)
    }
})

test("presets retain approved base colors and all fixed pastel categories", () => {
  const friendly = getSitePalette("friendly-comfort").light
  assert.deepEqual(
    [friendly.page, friendly.signal, friendly.reader, friendly.text],
    ["#dde9e3", "#03856f", "#fefaf4", "#212529"],
  )
  const fresh = getSitePalette("fresh-minimal").light
  assert.deepEqual(
    [fresh.page, fresh.mark, fresh.text, fresh.signal],
    ["#efeae1", "#b9b2a1", "#1c1b19", "#b0bcbb"],
  )
  const multicolor = getSitePalette("clean-multicolor")
  assert.equal(multicolor.light.page, "#f5fafe")
  assert.equal(multicolor.categories.light.length, 7)
  assert.equal(multicolor.categories.dark.length, 7)
  const pastels = multicolor.categories.light.map((category) => category.bg)
  for (const color of ["#ffdce1", "#fcefd4", "#c4f2e8", "#f0d9f8", "#cbe2f8"])
    assert.ok(pastels.includes(color))
  assert.equal(paletteVariables("clean-multicolor")["--site-palette-category-7-bg-dark"], "#424939")
  assert.ok(
    !Object.keys(paletteVariables("friendly-comfort")).some((key) => key.includes("category")),
  )
})

test("body, links and action foregrounds have readable baseline color contrast", () => {
  for (const palette of SITE_PALETTES)
    for (const mode of ["light", "dark"]) {
      const colors = palette[mode]
      for (const foreground of [colors.text, colors.muted, colors.accent])
        for (const background of [colors.page, colors.surface, colors.reader, colors.code])
          assert.ok(
            contrast(foreground, background) >= 4.5,
            `${palette.id}/${mode}: ${foreground} on ${background}`,
          )
      assert.ok(
        contrast(colors.onSignal, colors.signal) >= 4.5,
        `${palette.id}/${mode}: action text`,
      )
      for (const category of palette.categories?.[mode] ?? []) {
        assert.ok(contrast(category.fg, category.bg) >= 4.5, `${palette.id}/${mode}: category text`)
        for (const foreground of [colors.text, colors.muted, colors.accent])
          assert.ok(contrast(foreground, category.bg) >= 4.5, `${palette.id}/${mode}: card text`)
      }
    }
})

test("category assignment survives shuffling and new topics, including Unicode identities", () => {
  const topics = ["开发工具", "知识管理", "网站开发", "学习记录", "ＡＰＩ", "Emoji 📝"]
  const before = Object.fromEntries(topics.map((topic) => [topic, paletteCategory(topic)]))
  const shuffled = ["新增专题", ...topics.toReversed()]
  for (const topic of shuffled) {
    assert.match(paletteCategory(topic), /^[1-7]$/)
    if (Object.hasOwn(before, topic)) assert.equal(paletteCategory(topic), before[topic])
  }
  assert.equal(paletteCategory(" API "), paletteCategory("ＡＰＩ"))
})
