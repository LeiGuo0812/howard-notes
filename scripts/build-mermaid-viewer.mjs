import fs from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"

export async function buildMermaidViewer() {
  const outdir = "public/maintenance-assets"
  await fs.mkdir(outdir, { recursive: true })
  const result = await build({
    entryPoints: ["admin/mermaid-viewer.mjs"],
    outdir,
    entryNames: "mermaid-viewer-[hash]",
    chunkNames: "mermaid-chunks/[name]-[hash]",
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
      path.resolve(output.entryPoint) === path.resolve("admin/mermaid-viewer.mjs"),
  )
  if (!entry) throw new Error("The shared Mermaid viewer entry is missing.")
  const name = path.basename(entry[0])
  await fs.writeFile(path.join(outdir, "mermaid-viewer.js"), `export * from "./${name}";\n`)
  console.log(`Built shared Mermaid viewer ${name}.`)
  return `maintenance-assets/${name}`
}
