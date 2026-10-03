import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { build } from "esbuild"

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16)
export async function buildSitePreview({ outputDirectory = "public/admin", siteStyle } = {}) {
  if (!siteStyle) {
    const home = await fs.readFile("public/index.html", "utf8")
    siteStyle = home.match(
      /<link\b[^>]*href=["'](?:\.\/)?(index-[a-f0-9]{8,64}\.css)["'][^>]*>/,
    )?.[1]
    if (!siteStyle) throw new Error("The built site's shared stylesheet is missing.")
    await fs.access(path.join("public", siteStyle))
  }
  if (!/^index-[a-f0-9]{8,64}\.css$/.test(siteStyle))
    throw new Error("Invalid site preview stylesheet.")
  await fs.mkdir(outputDirectory, { recursive: true })
  const result = await build({
    entryPoints: ["admin/site-preview-sample-runtime.mjs"],
    outdir: outputDirectory,
    entryNames: "site-preview-sample-[hash]",
    format: "esm",
    bundle: true,
    minify: true,
    platform: "browser",
    target: ["es2022"],
    metafile: true,
  })
  const entry = Object.entries(result.metafile.outputs).find(
    ([, output]) =>
      output.entryPoint &&
      path.resolve(output.entryPoint) === path.resolve("admin/site-preview-sample-runtime.mjs"),
  )
  if (!entry) throw new Error("The site sample preview entry is missing.")
  const scriptName = path.basename(entry[0])
  const styles = await fs.readFile("admin/site-preview-sample.css", "utf8")
  const styleName = `site-preview-sample-${hash(styles)}.css`
  const template = await fs.readFile("admin/site-preview-sample.html", "utf8")
  const html = template
    .replace("__SITE_STYLE__", `../${siteStyle}`)
    .replace("__SAMPLE_STYLE__", styleName)
    .replace("__SAMPLE_SCRIPT__", scriptName)
  const htmlName = `site-preview-${hash(html)}.html`
  await Promise.all([
    fs.writeFile(path.join(outputDirectory, styleName), styles),
    fs.writeFile(path.join(outputDirectory, htmlName), html),
    fs.writeFile(path.join(outputDirectory, "site-preview.html"), html),
  ])
  console.log(`Built bounded site sample preview ${htmlName}.`)
  return `admin/${htmlName}`
}
