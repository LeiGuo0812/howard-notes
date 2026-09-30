import fs from "node:fs/promises"
import { build } from "esbuild"
const authConfig = JSON.parse(await fs.readFile("admin/auth-config.json", "utf8"))
if (process.env.GITHUB_REF === "refs/heads/main" && !authConfig.brokerOrigin)
  throw new Error("Account login must be configured before deploying main.")
await fs.mkdir("public/admin/katex", { recursive: true })
await Promise.all([
  fs.copyFile("admin/index.html", "public/admin/index.html"),
  fs.copyFile("admin/admin.css", "public/admin/admin.css"),
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
