import fs from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"

export async function buildMemories() {
  const outdir = "public/memory-assets"
  await fs.mkdir(outdir, { recursive: true })
  const result = await build({
    entryPoints: ["admin/memory-cards.mjs"],
    outdir,
    entryNames: "memory-[hash]",
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    target: ["es2022"],
    metafile: true,
  })
  const entry = Object.entries(result.metafile.outputs).find(
    ([, output]) =>
      output.entryPoint &&
      path.resolve(output.entryPoint) === path.resolve("admin/memory-cards.mjs"),
  )
  if (!entry) throw new Error("The memory entry is missing.")
  await fs.writeFile(
    path.join(outdir, "manifest.json"),
    JSON.stringify({ entry: path.basename(entry[0]) }),
  )
  console.log(`Built independent memory cards ${path.basename(entry[0])}.`)
}
