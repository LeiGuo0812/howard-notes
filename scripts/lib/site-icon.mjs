import { createHash } from "node:crypto"
import sharp from "sharp"
import { siteDesign } from "./site-design.mjs"

const escapeXml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch],
  )

export function brandIcon(settings) {
  const mark = settings.brand?.mark || "h."
  const design = siteDesign(settings)
  const accent = /^#[\da-f]{6}$/i.test(design.accentColor) ? design.accentColor : "#365f8b"
  // An original serif monogram keeps the default mark crisp without loading a font.
  const glyph =
    mark === "h."
      ? `<path d="M14 14h13v20c2-5 6-7 10-7 7 0 10 4 10 11v12h3v3H32v-3h5V38c0-4-1-6-4-6-4 0-6 4-6 9v9h4v3H14v-3h5V17h-5z"/><circle cx="56" cy="50" r="3.2"/>`
      : `<text x="32" y="45" text-anchor="middle" font-family="Georgia, 'DejaVu Serif', serif" font-weight="700" font-size="${mark.length > 2 ? 25 : 38}"${mark.length > 2 ? ' textLength="46" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(mark)}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(settings.brand?.name || "Howard")}">
<defs>
  <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5fbff"/><stop offset="1" stop-color="#dceaf5"/></linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="${accent}" stop-opacity=".3"/></linearGradient>
</defs>
<rect x="1.5" y="1.5" width="61" height="61" rx="19" fill="url(#plate)" stroke="${accent}" stroke-opacity=".32"/>
<rect x="2.5" y="2.5" width="59" height="59" rx="18" fill="none" stroke="url(#rim)"/>
<g fill="${accent}" transform="translate(-3 -1)">${glyph}</g>
</svg>`
  const version = createHash("sha256").update(svg).digest("hex").slice(0, 12)
  return { svg, version, basename: `howard-icon-${version}` }
}

export async function renderBrandIconFiles(settings) {
  const icon = brandIcon(settings)
  const input = Buffer.from(icon.svg)
  const sizes = [16, 32, 48]
  const frames = await Promise.all(
    sizes.map((size) => sharp(input).resize(size, size).png().toBuffer()),
  )
  // Windows ICO directory containing PNG frames; keep the actual ICO header,
  // rather than writing PNG bytes to a file with an .ico extension.
  const directory = Buffer.alloc(6 + frames.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(frames.length, 4)
  let offset = directory.length
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16
    directory[entry] = directory[entry + 1] = sizes[index]
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frame.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  })
  const ico = Buffer.concat([directory, ...frames])
  const apple = await sharp(input).resize(180, 180).png().toBuffer()
  const large = await sharp(input).resize(512, 512).png().toBuffer()
  return {
    ...icon,
    files: new Map([
      [`static/${icon.basename}.svg`, input],
      [`static/${icon.basename}-32.png`, frames[1]],
      [`static/${icon.basename}-180.png`, apple],
      [`static/${icon.basename}.ico`, ico],
      ["static/icon.png", large],
      ["favicon.ico", ico],
    ]),
  }
}

export function brandIconLinks(settings, base = ".") {
  const { basename } = brandIcon(settings)
  const prefix = `${base.replace(/\/$/, "")}/static/${basename}`
  return `<link rel="icon" href="${prefix}.ico" sizes="16x16 32x32 48x48" />
<link rel="icon" href="${prefix}-32.png" type="image/png" sizes="32x32" />
<link rel="icon" href="${prefix}.svg" type="image/svg+xml" sizes="any" />
<link rel="apple-touch-icon" href="${prefix}-180.png" sizes="180x180" />`
}
