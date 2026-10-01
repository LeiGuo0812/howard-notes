import fs from "node:fs/promises"
import { build } from "esbuild"
await fs.mkdir(".local", { recursive: true })
await build({
  entryPoints: ["scripts/content-sync-entry.ts"],
  outfile: ".local/content-sync-entry.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  packages: "external",
  loader: { ".scss": "empty" },
  plugins: [
    {
      name: "runtime-node-inline",
      setup(b) {
        b.onLoad({ filter: /\.inline\.(ts|js)$/ }, () => ({ contents: "", loader: "text" }))
      },
    },
  ],
})
await import(new URL("../.local/content-sync-entry.mjs", import.meta.url))
