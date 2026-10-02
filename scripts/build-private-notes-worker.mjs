import { build } from "esbuild"
import fs from "node:fs/promises"
import path from "node:path"
import { runtimeBrowserPlugins } from "../runtime/build.mjs"

export async function buildPrivateNotesWorker() {
  const bundle = await build({
    entryPoints: ["admin/private-notes-worker.mjs"],
    outdir: "public/maintenance-assets/worker",
    entryNames: "private-reading-[hash]",
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
    ([, output]) => output.entryPoint === "admin/private-notes-worker.mjs",
  )
  if (!entry) throw new Error("Missing private reading worker entry")
  await fs.mkdir("public/maintenance-assets", { recursive: true })
  await fs.writeFile(
    "public/maintenance-assets/private-notes-worker.js",
    `import "./worker/${path.basename(entry[0])}";\n`,
  )
  return `maintenance-assets/worker/${path.basename(entry[0])}`
}
