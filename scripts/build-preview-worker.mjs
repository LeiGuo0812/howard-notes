import { build } from "esbuild"
import fs from "node:fs/promises"
import path from "node:path"
import { runtimeBrowserPlugins } from "../runtime/build.mjs"
export async function buildPreviewWorker() {
  const bundle = await build({
    entryPoints: ["admin/preview-worker.mjs"],
    outdir: "public/maintenance-assets/worker",
    entryNames: "preview-[hash]",
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
    ([, output]) => output.entryPoint === "admin/preview-worker.mjs",
  )
  if (!entry) throw new Error("Missing preview worker entry")
  await fs.writeFile(
    "public/maintenance-assets/preview-worker.js",
    `import "./worker/${path.basename(entry[0])}";\n`,
  )
  return `maintenance-assets/worker/${path.basename(entry[0])}`
}
