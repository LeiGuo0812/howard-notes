import fs from "node:fs/promises"
import path from "node:path"
const root = ".local/cloudflare-assets"
const current = `${root}-current`
const next = `${root}-next`
const stage = `${root}-stage`
await fs.rm(next, { recursive: true, force: true })
await fs.cp("public", `${next}/howard-notes`, { recursive: true })
await fs.rm(stage, { recursive: true, force: true })
let previous = current
try {
  await fs.access(previous)
} catch {
  previous = root
}
// Keep one prior set of JS/CSS resources so an open maintenance panel or the
// previous D1 shell can finish loading while the new content version switches.
// Previous reading HTML and attachments are deliberately not copied.
try {
  const files = await fs.readdir(`${previous}/howard-notes`, { withFileTypes: true })
  for (const file of files) {
    // Quartz emits hashed component and main styles at the site root, outside
    // static/. Keep those too until the D1 shell switches to their new hashes.
    if (file.isFile() && /^(?:index|component)-[a-f0-9]+\.css$/.test(file.name)) {
      const destination = `${stage}/howard-notes/${file.name}`
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(`${previous}/howard-notes/${file.name}`, destination)
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error
}
for (const folder of ["admin", "maintenance-assets", "memory-assets", "static"]) {
  const source = `${previous}/howard-notes/${folder}`
  try {
    await fs.access(source)
  } catch {
    continue
  }
  await fs.cp(source, `${stage}/howard-notes/${folder}`, {
    recursive: true,
    filter: async (file) =>
      (await fs.stat(file)).isDirectory() ||
      /\.(?:js|css|wasm)$|\.LICENSE\.txt$/.test(path.basename(file)),
  })
}
await fs.cp(next, stage, { recursive: true, force: true })
await fs.rm(root, { recursive: true, force: true })
await fs.rename(stage, root)
await fs.rm(current, { recursive: true, force: true })
await fs.rename(next, current)
// Public reading HTML is always served by D1. Admin and hashed static resources
// are served directly by Assets and do not invoke the Worker or D1.
console.log("Prepared Cloudflare assets at /howard-notes/.")
