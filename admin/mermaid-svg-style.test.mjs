import assert from "node:assert/strict"
import test from "node:test"
import { safeDiagramCss } from "./mermaid-svg-style.mjs"

test("SVG paint styles keep local fragments and normal text typography", () => {
  assert.equal(
    safeDiagramCss('fill:url("#paint");stroke:#738194;font-family:"Microsoft YaHei"'),
    'fill:url(#paint);stroke:#738194;font-family:"Microsoft YaHei"',
  )
  assert.equal(
    safeDiagramCss("#diagram .node{fill:#e8edf2;stroke-width:1px}"),
    "#diagram .node{fill:#e8edf2;stroke-width:1px}",
  )
})
test("external paint URLs are removed even when their tokens use CSS escapes or comments", () => {
  for (const source of [
    "fill:url(https://probe.invalid/image)",
    String.raw`fill:\75rl(https://probe.invalid/image)`,
    String.raw`fill:u\72l('https://probe.invalid/image')`,
    "fill:u/**/rl(https://probe.invalid/image)",
    String.raw`fill:u\000072 l(https://probe.invalid/image)`,
  ])
    assert.equal(safeDiagramCss(source), "fill:none", source)
})
test("stylesheet imports and image functions cannot bypass SVG download sanitation", () => {
  for (const source of [
    '@import "https://probe.invalid/style.css";',
    String.raw`@\69mport "https://probe.invalid/style.css";`,
    String.raw`@\000069 mport "https://probe.invalid/style.css";`,
    'background-image:image-set("https://probe.invalid/image" 1x)',
    String.raw`background-image:im\61ge-set("https://probe.invalid/image" 1x)`,
    "fill:var(--external-paint)",
    "@font-face{src:local(font)}",
  ])
    assert.equal(safeDiagramCss(source), "", source)
})
test("Mermaid's built-in keyframes are removed without discarding the diagram palette and alignment", () => {
  const styles =
    "#diagram{font-family:system-ui}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#diagram .node{fill:#e8edf2;text-anchor:middle}"
  assert.equal(
    safeDiagramCss(styles),
    "#diagram{font-family:system-ui}#diagram .node{fill:#e8edf2;text-anchor:middle}",
  )
  assert.equal(
    safeDiagramCss('@keyframes x{from{content:"}";}to{opacity:1;}}.node{fill:#abc}'),
    ".node{fill:#abc}",
  )
  assert.equal(safeDiagramCss("@keyframes unfinished{from{opacity:1}"), "")
  assert.equal(
    safeDiagramCss('@keyframes x{from{opacity:1;}}@import "https://probe.invalid/style";'),
    "",
  )
})
