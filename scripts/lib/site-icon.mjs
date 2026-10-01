import { createHash } from "node:crypto"
import sharp from "sharp"
import { brandIconSvg } from "./site-icon-svg.mjs"

export function brandIcon(settings) {
  const svg = brandIconSvg(settings)
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
