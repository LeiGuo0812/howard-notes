import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { build } from "esbuild"
import { runtimeBrowserPlugins } from "../runtime/build.mjs"
import { buildPreviewWorker } from "./build-preview-worker.mjs"
import { buildPublicationWorker } from "./build-publication-worker.mjs"
import { buildPrivateNotesWorker } from "./build-private-notes-worker.mjs"
import { buildMermaidViewer } from "./build-mermaid-viewer.mjs"
import { buildArticleShare } from "./build-article-share.mjs"

// Both entry points instantiate the same workspace controller and the same form template.
export async function buildMaintenance(
  template,
  workerEntry,
  privateWorkerEntry,
  mermaidViewerEntry,
  articleShareEntry,
  previewWorkerEntry,
  sitePreviewEntry,
) {
  previewWorkerEntry ||= await buildPreviewWorker()
  workerEntry ||= await buildPublicationWorker()
  privateWorkerEntry ||= await buildPrivateNotesWorker()
  mermaidViewerEntry ||= await buildMermaidViewer()
  articleShareEntry ||= await buildArticleShare()
  const outdir = "public/maintenance-assets"
  await fs.mkdir(outdir, { recursive: true })
  const main = template.match(/<main>([\s\S]*?)<\/main>/)?.[1]
  if (!main) throw new Error("The shared workspace template is missing.")
  const hiddenAccount =
    '<div hidden><span id="account"></span><button id="reconnect"></button><button id="logout"></button></div>'
  const styles = (
    await Promise.all([
      fs.readFile("styles/frosted-glass.css", "utf8"),
      fs.readFile("admin/admin.css", "utf8"),
      fs.readFile("admin/backup-manager.css", "utf8"),
    ])
  )
    .join("\n")
    // A ShadowRoot host is featureless: attribute selectors must live inside
    // :host(...), rather than follow :host as a separate :where compound.
    .replaceAll(
      ':root[saved-theme="dark"]:where([data-site-palette]:not([data-site-palette="current"]))',
      ':host([saved-theme="dark"]:where([data-site-palette]:not([data-site-palette="current"])))',
    )
    .replaceAll(
      ':root:where([data-site-palette]:not([data-site-palette="current"]))',
      ':host(:where([data-site-palette]:not([data-site-palette="current"])))',
    )
    .replaceAll(
      ':root[saved-theme="dark"]:where([data-site-palette="clean-multicolor"])',
      ':host([saved-theme="dark"]:where([data-site-palette="clean-multicolor"]))',
    )
    .replaceAll(
      ':root:where([data-site-palette="clean-multicolor"])',
      ':host(:where([data-site-palette="clean-multicolor"]))',
    )
    .replaceAll(':root[saved-theme="dark"]', ':host([saved-theme="dark"])')
    .replaceAll(":root:not([saved-theme])", ":host(:not([saved-theme]))")
    .replaceAll(":root", ":host")
    .replace(/(^|[\s,>])body(?=[\s{,.:[>+~])/gm, "$1.workspace-body")
  const overrides = await fs.readFile("admin/maintenance.css", "utf8")
  const templateText = hiddenAccount + main
  const styleText = styles + "\n" + overrides
  const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16)
  const workspaceTemplate = `maintenance-assets/workspace-${hash(templateText)}.txt`
  const workspaceStyle = `maintenance-assets/workspace-${hash(styleText)}.css`
  const bundle = await build({
    absWorkingDir: process.cwd(),
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
    define: {
      __HOWARD_WORKSPACE_TEMPLATE__: JSON.stringify(workspaceTemplate),
      __HOWARD_WORKSPACE_STYLE__: JSON.stringify(workspaceStyle),
      __HOWARD_PREVIEW_WORKER__: JSON.stringify(previewWorkerEntry),
      __HOWARD_SITE_PREVIEW__: JSON.stringify(sitePreviewEntry || ""),
      __HOWARD_PUBLICATION_WORKER__: JSON.stringify(workerEntry),
      __HOWARD_PRIVATE_NOTES_WORKER__: JSON.stringify(privateWorkerEntry),
    },
    plugins: runtimeBrowserPlugins(),
    loader: { ".scss": "empty" },
  })
  const entry = Object.entries(bundle.metafile.outputs).find(
    ([, output]) =>
      output.entryPoint &&
      path.resolve(output.entryPoint) === path.resolve("admin/maintenance.mjs"),
  )
  if (!entry) throw new Error("The maintenance entry is missing.")
  const version = createHash("sha256")
    .update(entry[0])
    .update(mermaidViewerEntry)
    .update(articleShareEntry)
    .update(main)
    .update(styles)
    .update(overrides)
    .digest("hex")
    .slice(0, 16)
  await Promise.all([
    fs.writeFile(path.join(outdir, "workspace.txt"), templateText),
    fs.writeFile(path.join("public", workspaceTemplate), templateText),
    fs.writeFile(path.join(outdir, "workspace.css"), styleText),
    fs.writeFile(path.join("public", workspaceStyle), styleText),
    fs.writeFile(
      path.join(outdir, "manifest.json"),
      JSON.stringify({
        entry: path.basename(entry[0]),
        version,
        workerEntry,
        privateWorkerEntry,
        mermaidViewerEntry,
        articleShareEntry,
        previewWorkerEntry,
        sitePreviewEntry,
        workspaceTemplate,
        workspaceStyle,
      }),
    ),
  ])
  console.log(`Built main-site maintenance ${version}.`)
}
