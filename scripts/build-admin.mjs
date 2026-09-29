import fs from "node:fs/promises"
import { build } from "esbuild"
await fs.mkdir("public/admin", { recursive: true })
await Promise.all([
  fs.copyFile("admin/index.html", "public/admin/index.html"),
  fs.copyFile("admin/admin.css", "public/admin/admin.css"),
  build({
    entryPoints: ["admin/app.mjs"],
    outfile: "public/admin/admin.js",
    bundle: true,
    minify: true,
    platform: "browser",
    target: ["es2022"],
    sourcemap: false,
  }),
])
console.log("Built /admin with a self-hosted Markdown editor.")
