import fs from "node:fs/promises"
import { build } from "esbuild"
import { brandIconLinks } from "./lib/site-icon.mjs"
const authConfig = JSON.parse(await fs.readFile("admin/auth-config.json", "utf8"))
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
const adminHtml = (await fs.readFile("admin/index.html", "utf8")).replace(
  "<!-- brand-icons -->",
  brandIconLinks(settings, ".."),
)
if (process.env.GITHUB_REF === "refs/heads/main" && !authConfig.brokerOrigin)
  throw new Error("Account login must be configured before deploying main.")
await fs.mkdir("public/admin/katex", { recursive: true })
await Promise.all([
  fs.writeFile("public/admin/index.html", adminHtml),
  fs.copyFile("admin/admin.css", "public/admin/admin.css"),
  fs.copyFile("styles/frosted-glass.css", "public/admin/frosted-glass.css"),
  fs.copyFile("admin/auth-config.json", "public/admin/auth-config.json"),
  build({
    entryPoints: ["admin/app.mjs"],
    outdir: "public/admin",
    entryNames: "admin",
    chunkNames: "chunks/[name]-[hash]",
    format: "esm",
    splitting: true,
    bundle: true,
    minify: true,
    platform: "browser",
    target: ["es2022"],
    sourcemap: false,
  }),
  fs.copyFile("node_modules/katex/dist/katex.min.css", "public/admin/katex/katex.min.css"),
  fs.cp("node_modules/katex/dist/fonts", "public/admin/katex/fonts", { recursive: true }),
])
console.log("Built /admin with a self-hosted Markdown editor.")
