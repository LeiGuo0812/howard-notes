import fs from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"

export async function buildArticleShare() {
  const outdir = "public/maintenance-assets"
  const fontsDir = path.join(outdir, "article-export-fonts")
  await fs.mkdir(fontsDir, { recursive: true })
  const fonts = await fs.readdir("node_modules/katex/dist/fonts")
  await Promise.all(
    fonts
      .filter((name) => name.endsWith(".woff2"))
      .map((name) =>
        fs.copyFile(path.join("node_modules/katex/dist/fonts", name), path.join(fontsDir, name)),
      ),
  )
  const result = await build({
    entryPoints: ["admin/article-share.mjs"],
    outdir,
    entryNames: "article-share-[hash]",
    chunkNames: "share-chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    platform: "browser",
    target: ["es2022"],
    loader: { ".css": "text" },
    metafile: true,
  })
  const entry = Object.entries(result.metafile.outputs).find(
    ([, output]) =>
      output.entryPoint &&
      path.resolve(output.entryPoint) === path.resolve("admin/article-share.mjs"),
  )
  if (!entry) throw new Error("Article share entry is missing.")
  const name = path.basename(entry[0])
  await fs.writeFile(path.join(outdir, "article-share.js"), `export * from "./${name}";\n`)
  console.log(`Built article share ${name}.`)
  return `maintenance-assets/${name}`
}
