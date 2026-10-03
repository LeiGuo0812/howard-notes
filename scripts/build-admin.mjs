import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { build } from "esbuild"
import { brandIconLinks } from "./lib/site-icon.mjs"
import { brokerOrigin } from "../admin/auth.mjs"
import { upgradeAdmin } from "./lib/admin-upgrade.mjs"
import { buildPreviewWorker } from "./build-preview-worker.mjs"
import { buildMaintenance } from "./build-maintenance.mjs"
import { buildMemories } from "./build-memories.mjs"
import { buildPublicationWorker } from "./build-publication-worker.mjs"
import { buildPrivateNotesWorker } from "./build-private-notes-worker.mjs"
import { buildMermaidViewer } from "./build-mermaid-viewer.mjs"
import { buildArticleShare } from "./build-article-share.mjs"
import { runtimeBrowserPlugins } from "../runtime/build.mjs"
const authConfig = JSON.parse(await fs.readFile("admin/auth-config.json", "utf8"))
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
const runtimeConfig = JSON.parse(await fs.readFile("runtime/config.json", "utf8"))
const template = await fs.readFile("admin/index.html", "utf8")
const connections = "connect-src 'self' https://api.github.com;"
if (!template.includes(connections))
  throw new Error("The admin connection policy template changed.")
const loginOrigin = authConfig.brokerOrigin ? ` ${brokerOrigin(authConfig.brokerOrigin)}` : ""
const contentOrigin = runtimeConfig.enabled ? ` ${new URL(runtimeConfig.apiBase).origin}` : ""
const preparedHtml = template
  .replace("<!-- brand-icons -->", brandIconLinks(settings, ".."))
  .replace(connections, `connect-src 'self' https://api.github.com${loginOrigin}${contentOrigin};`)
if (process.env.GITHUB_REF === "refs/heads/main" && !authConfig.brokerOrigin)
  throw new Error("Account login must be configured before deploying main.")
await fs.mkdir("public/admin/katex", { recursive: true })
const previewWorkerEntry = await buildPreviewWorker()
const workerEntry = await buildPublicationWorker()
const privateWorkerEntry = await buildPrivateNotesWorker()
const mermaidViewerEntry = await buildMermaidViewer()
const articleShareEntry = await buildArticleShare()
const bundle = await build({
  entryPoints: ["admin/app.mjs"],
  outdir: "public/admin",
  entryNames: "admin-[hash]",
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  splitting: true,
  bundle: true,
  minify: true,
  platform: "browser",
  target: ["es2022"],
  sourcemap: false,
  metafile: true,
  define: {
    __HOWARD_PUBLICATION_WORKER__: JSON.stringify(workerEntry),
    __HOWARD_PREVIEW_WORKER__: JSON.stringify(previewWorkerEntry),
  },
  plugins: runtimeBrowserPlugins(),
  loader: { ".scss": "empty" },
})
const entry = Object.entries(bundle.metafile.outputs).find(
  ([, output]) =>
    output.entryPoint && path.resolve(output.entryPoint) === path.resolve("admin/app.mjs"),
)
if (!entry) throw new Error("The admin bundle entry is missing.")
const entryName = path.basename(entry[0])
const htmlWithEntry = preparedHtml.replace("__ADMIN_SCRIPT__", entryName)
const version = createHash("sha256")
  .update(htmlWithEntry)
  .update(JSON.stringify(authConfig))
  .update(mermaidViewerEntry)
  .update(articleShareEntry)
  .digest("hex")
  .slice(0, 16)
const adminHtml = htmlWithEntry.replace("__ADMIN_VERSION__", version)
await Promise.all([
  fs.writeFile("public/runtime-config.json", JSON.stringify(runtimeConfig)),
  fs.writeFile("public/admin/index.html", adminHtml),
  fs.copyFile("admin/admin.css", "public/admin/admin.css"),
  fs.copyFile("admin/backup-manager.css", "public/admin/backup-manager.css"),
  fs.copyFile("styles/frosted-glass.css", "public/admin/frosted-glass.css"),
  fs.copyFile("admin/auth-config.json", "public/admin/auth-config.json"),
  fs.writeFile(
    "public/admin/admin.js",
    `(${upgradeAdmin.toString()})(${JSON.stringify(version)});\n`,
  ),
  fs.copyFile("node_modules/katex/dist/katex.min.css", "public/admin/katex/katex.min.css"),
  fs.cp("node_modules/katex/dist/fonts", "public/admin/katex/fonts", { recursive: true }),
])
console.log(`Built /admin ${version} with a self-hosted Markdown editor.`)
await buildMaintenance(
  template,
  workerEntry,
  privateWorkerEntry,
  mermaidViewerEntry,
  articleShareEntry,
  previewWorkerEntry,
)
await buildMemories()
