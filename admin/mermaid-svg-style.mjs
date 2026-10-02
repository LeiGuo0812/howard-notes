// SVG sanitation also needs to cover CSS: DOMPurify deliberately does not parse
// stylesheets. Decode CSS escapes before rejecting rules/functions that can
// request resources, then allow only fragment-local paint URLs.
function withoutKeyframes(css) {
  let result = "",
    cursor = 0
  const blocks = /@(?:-webkit-)?keyframes\b/gi
  let match
  while ((match = blocks.exec(css))) {
    result += css.slice(cursor, match.index)
    const open = css.indexOf("{", blocks.lastIndex)
    if (open < 0 || !/^\s+[\w-]+\s*$/.test(css.slice(blocks.lastIndex, open))) return ""
    let depth = 1,
      quote = "",
      end = open + 1
    for (; end < css.length && depth; end++) {
      const char = css[end]
      if (quote) {
        if (char === "\\") end++
        else if (char === quote) quote = ""
      } else if (char === '"' || char === "'") quote = char
      else if (char === "{") depth++
      else if (char === "}") depth--
    }
    if (depth) return ""
    cursor = end
    blocks.lastIndex = end
  }
  return result + css.slice(cursor)
}
export function safeDiagramCss(input) {
  const decoded = withoutKeyframes(
    String(input)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\\(?:([0-9a-f]{1,6})\s?|([^\r\n\f])|[\r\n\f])/gi, (_, hex, char) => {
        if (!hex) return char || ""
        const number = parseInt(hex, 16)
        return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "\ufffd"
      }),
  )
  if (
    /@|\b(?:image-set|-webkit-image-set|cross-fade|paint|src|var|expression|attr)\s*\(/i.test(
      decoded,
    )
  )
    return ""
  return decoded.replace(/url\s*\(\s*([^)]*)\)/gi, (match, value) => {
    const target = value.trim().replace(/^(?:"([^"\n]*)"|'([^'\n]*)')$/, (_, a, b) => a ?? b)
    return /^#[\w:.-]+$/.test(target) ? `url(${target})` : "none"
  })
}
