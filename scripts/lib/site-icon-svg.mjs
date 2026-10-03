import { siteDesign } from "./site-design.mjs"
import { getSitePalette } from "./site-palettes.mjs"
import { brandMarkColors } from "./site-brand-colors.mjs"

const escapeXml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch],
  )

// Shared by the static raster/ICO generator and live browser-rendered page settings.
export function brandIconSvg(settings) {
  const mark = settings.brand?.mark || "h."
  const design = siteDesign(settings)
  const accent = /^#[\da-f]{6}$/i.test(design.accentColor) ? design.accentColor : "#365f8b"
  const { background, foreground } = brandMarkColors(getSitePalette(design.palette)?.light, accent)
  // An original serif monogram keeps the default mark crisp without loading a font.
  const glyph =
    mark === "h."
      ? `<path d="M14 14h13v20c2-5 6-7 10-7 7 0 10 4 10 11v12h3v3H32v-3h5V38c0-4-1-6-4-6-4 0-6 4-6 9v9h4v3H14v-3h5V17h-5z"/><circle cx="56" cy="50" r="3.2"/>`
      : `<text x="32" y="45" text-anchor="middle" font-family="Georgia, 'DejaVu Serif', serif" font-weight="700" font-size="${mark.length > 2 ? 25 : 38}"${mark.length > 2 ? ' textLength="46" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(mark)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(settings.brand?.name || "Howard")}">
<rect x="1.5" y="1.5" width="61" height="61" rx="19" fill="${background}"/>
<g fill="${foreground}" transform="translate(-3 -1)">${glyph}</g>
</svg>`
}

// Append after static icon links so modern browsers select the current live branding.
// The static ICO, PNG and Apple links remain available as compatibility fallbacks.
export function brandIconDataLink(settings) {
  return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(brandIconSvg(settings))}" type="image/svg+xml" sizes="any" />`
}
