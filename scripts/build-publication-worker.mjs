import { build } from "esbuild"
import fs from "node:fs/promises"
import path from "node:path"
import { runtimeBrowserPlugins } from "../runtime/build.mjs"

export async function buildPublicationWorker() {
  const bundle = await build({
    entryPoints: ["admin/publication-worker.mjs"],
    outdir: "public/maintenance-assets/worker",
    entryNames: "publication-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    conditions: ["worker", "browser"],
    target: ["es2022"],
    minify: true,
    metafile: true,
    plugins: runtimeBrowserPlugins(),
    loader: { ".scss": "empty" },
  })
  const entry = Object.entries(bundle.metafile.outputs).find(
    ([, output]) => output.entryPoint === "admin/publication-worker.mjs",
  )
  if (!entry) throw new Error("Missing publication worker entry")
  await fs.writeFile(
    "public/maintenance-assets/publication-worker.js",
    `import "./worker/${path.basename(entry[0])}";\n`,
  )
  return `maintenance-assets/worker/${path.basename(entry[0])}`
}
