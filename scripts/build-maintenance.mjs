import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { build } from "esbuild"
import { runtimeBrowserPlugins } from "../runtime/build.mjs"
import { buildPublicationWorker } from "./build-publication-worker.mjs"

// Both entry points instantiate the same workspace controller and the same form template.
export async function buildMaintenance(template) {
  await buildPublicationWorker()
  const outdir = "public/maintenance-assets"
  await fs.mkdir(outdir, { recursive: true })
  const bundle = await build({
    entryPoints: ["admin/maintenance.mjs"],
    outdir,
    entryNames: "maintenance-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    format: "esm",
    splitting: true,
    bundle: true,
    minify: true,
    platform: "browser",
    target: ["es2022"],
    metafile: true,
    plugins: runtimeBrowserPlugins(),
    loader: { ".scss": "empty" },
  })
  const entry = Object.entries(bundle.metafile.outputs).find(
    ([, output]) =>
      output.entryPoint &&
      path.resolve(output.entryPoint) === path.resolve("admin/maintenance.mjs"),
  )
  if (!entry) throw new Error("The maintenance entry is missing.")
  const main = template.match(/<main>([\s\S]*?)<\/main>/)?.[1]
  if (!main) throw new Error("The shared workspace template is missing.")
  const hiddenAccount =
    '<div hidden><span id="account"></span><button id="reconnect"></button><button id="logout"></button></div>'
  const styles = (
    await Promise.all([
      fs.readFile("styles/frosted-glass.css", "utf8"),
      fs.readFile("admin/admin.css", "utf8"),
    ])
  )
    .join("\n")
    .replaceAll(':root[saved-theme="dark"]', ':host([saved-theme="dark"])')
    .replaceAll(":root:not([saved-theme])", ":host(:not([saved-theme]))")
    .replaceAll(":root", ":host")
    .replace(/(^|[\s,>])body(?=[\s{,.:[>+~])/gm, "$1.workspace-body")
  const overrides = await fs.readFile("admin/maintenance.css", "utf8")
  const version = createHash("sha256")
    .update(entry[0])
    .update(main)
    .update(styles)
    .update(overrides)
    .digest("hex")
    .slice(0, 16)
  await Promise.all([
    fs.writeFile(path.join(outdir, "workspace.txt"), hiddenAccount + main),
    fs.writeFile(path.join(outdir, "workspace.css"), styles + "\n" + overrides),
    fs.writeFile(
      path.join(outdir, "manifest.json"),
      JSON.stringify({ entry: path.basename(entry[0]), version }),
    ),
  ])
  console.log(`Built main-site maintenance ${version}.`)
}
