import assert from "node:assert/strict"
import test from "node:test"
import { mermaidConfiguration } from "./mermaid-theme.mjs"

function luminance(color) {
  const channels = color
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
for (const dark of [false, true]) {
  test(`${dark ? "dark" : "light"} Mermaid node, note and sequence text remains readable`, () => {
    const { theme, themeVariables: colors } = mermaidConfiguration({ dark })
    assert.equal(theme, "base")
    assert.equal(colors.darkMode, dark)
    for (const [text, fill] of [
      ["primaryTextColor", "primaryColor"],
      ["secondaryTextColor", "secondaryColor"],
      ["tertiaryTextColor", "tertiaryColor"],
      ["noteTextColor", "noteBkgColor"],
      ["actorTextColor", "actorBkg"],
      ["signalTextColor", "background"],
    ])
      assert.ok(contrast(colors[text], colors[fill]) >= 4.5, `${text}/${fill}`)
  })
}
test("diagram metadata cannot override renderer security or force HTML labels", () => {
  const config = mermaidConfiguration()
  assert.equal(config.securityLevel, "strict")
  assert.equal(config.htmlLabels, false)
  assert.equal(config.flowchart.htmlLabels, false)
  for (const field of [
    "secure",
    "securityLevel",
    "htmlLabels",
    "flowchart",
    "themeCSS",
    "themeVariables",
    "theme",
    "fontFamily",
    "fontSize",
    "dompurifyConfig",
    "maxTextSize",
    "maxEdges",
  ])
    assert.ok(config.secure.includes(field), field)
  assert.equal(config.maxTextSize, 50000)
  assert.equal(config.maxEdges, 300)
})
test("reading font configuration uses a supplied text family with an explicit fallback", () => {
  assert.equal(
    mermaidConfiguration({ fontFamily: '"Example Chinese", serif' }).themeVariables.fontFamily,
    '"Example Chinese", serif',
  )
  assert.match(mermaidConfiguration().themeVariables.fontFamily, /Microsoft YaHei/)
  assert.equal(mermaidConfiguration().themeVariables.fontSize, "15px")
})
test("configuration values are independent snapshots across contexts and theme changes", () => {
  const light = mermaidConfiguration(),
    dark = mermaidConfiguration({ dark: true })
  light.flowchart.htmlLabels = true
  light.themeVariables.primaryColor = "#ffffff"
  assert.equal(dark.flowchart.htmlLabels, false)
  assert.equal(mermaidConfiguration().flowchart.htmlLabels, false)
  assert.notEqual(
    mermaidConfiguration().themeVariables.primaryColor,
    light.themeVariables.primaryColor,
  )
  assert.notEqual(
    mermaidConfiguration().themeVariables.primaryColor,
    dark.themeVariables.primaryColor,
  )
})
