import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
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
  const pdfFontsSource = "assets/article-pdf-fonts"
  const pdfFontsDir = path.join(outdir, "article-pdf-fonts")
  const provenance = JSON.parse(
    await fs.readFile(path.join(pdfFontsSource, "provenance.json"), "utf8"),
  )
  await fs.rm(pdfFontsDir, { recursive: true, force: true })
  await fs.mkdir(pdfFontsDir, { recursive: true })
  for (const [name, expected] of Object.entries(provenance.files)) {
    const bytes = await fs.readFile(path.join(pdfFontsSource, name))
    if (
      bytes.length !== expected.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256
    )
      throw new Error(`PDF font integrity check failed: ${name}`)
    await fs.writeFile(path.join(pdfFontsDir, name), bytes)
  }
  await fs.copyFile(path.join(pdfFontsSource, "LICENSE"), path.join(pdfFontsDir, "LICENSE.txt"))
  await fs.copyFile(
    path.join(pdfFontsSource, "provenance.json"),
    path.join(pdfFontsDir, "provenance.json"),
  )
  // Reuse the locked KaTeX package's small ASCII monospace font. The same
  // original bytes serve browser layout and PDF embedding; do not stretch
  // proportional glyphs to fit platform-specific code font widths.
  const codeFontName = "KaTeX_Typewriter-Regular.ttf"
  const codeFont = await fs.readFile(path.join("node_modules/katex/dist/fonts", codeFontName))
  const codeFontSha = createHash("sha256").update(codeFont).digest("hex")
  const katex = JSON.parse(await fs.readFile("node_modules/katex/package.json", "utf8"))
  if (
    katex.version !== "0.18.9" ||
    codeFont.length !== 27556 ||
    codeFontSha !== "f01f3e87d9c6a61c0c081ceb577abd864eb00a612f7ac1620dd6915fad2ef5aa"
  )
    throw new Error(
      "PDF code font source changed; verify its provenance and rendering before updating.",
    )
  await fs.writeFile(path.join(pdfFontsDir, codeFontName), codeFont)
  await fs.copyFile("node_modules/katex/LICENSE", path.join(pdfFontsDir, "KaTeX-LICENSE.txt"))
  // The package uses MIT, but the original font's name table identifies OFL
  // 1.1 with a reserved name. Publish its notice and the complete font license.
  await fs.writeFile(
    path.join(pdfFontsDir, "KaTeX-Typewriter-LICENSE.txt"),
    "Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n" +
      "Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\n" +
      "with Reserved Font Name KaTeX_Typewriter.\n\n" +
      (await fs.readFile(path.join(pdfFontsSource, "LICENSE"), "utf8")),
  )
  await fs.writeFile(
    path.join(pdfFontsDir, "code-font-provenance.json"),
    JSON.stringify(
      {
        package: "katex",
        version: katex.version,
        file: codeFontName,
        bytes: codeFont.length,
        sha256: codeFontSha,
        fontLicense: "SIL Open Font License 1.1",
        fontLicenseFile: "KaTeX-Typewriter-LICENSE.txt",
        packageLicense: "MIT",
        packageLicenseFile: "KaTeX-LICENSE.txt",
      },
      null,
      2,
    ) + "\n",
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
