import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildMaintenance } from "./build-maintenance.mjs"

test("lazy maintenance entries bind immutable matching template and style generations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "howard-workspace-assets-"))
  const originalDirectory = process.cwd()
  try {
    for (const folder of ["admin", "styles"]) await fs.mkdir(path.join(root, folder))
    for (const file of [
      "styles/frosted-glass.css",
      "admin/admin.css",
      "admin/backup-manager.css",
      "admin/maintenance.css",
    ])
      await fs.writeFile(path.join(root, file), ":root { color: black; }")
    await fs.writeFile(
      path.join(root, "admin/maintenance.mjs"),
      "export const template = __HOWARD_WORKSPACE_TEMPLATE__; export const css = __HOWARD_WORKSPACE_STYLE__;",
    )
    process.chdir(root)
    const build = async (text) => {
      await buildMaintenance(
        `<main>${text}</main>`,
        "publish.js",
        "private.js",
        "mermaid.js",
        "share.js",
        "preview.js",
      )
      return JSON.parse(await fs.readFile("public/maintenance-assets/manifest.json", "utf8"))
    }
    const first = await build("generation A")
    assert.match(first.workspaceTemplate, /^maintenance-assets\/workspace-[a-f0-9]{16}\.txt$/)
    assert.match(first.workspaceStyle, /^maintenance-assets\/workspace-[a-f0-9]{16}\.css$/)
    const entryA = await fs.readFile(path.join("public/maintenance-assets", first.entry), "utf8")
    assert.ok(entryA.includes(first.workspaceTemplate))
    assert.ok(entryA.includes(first.workspaceStyle))
    await fs.writeFile("admin/admin.css", ":root { color: blue; }")
    const second = await build("generation B")
    assert.notEqual(first.entry, second.entry)
    assert.notEqual(first.workspaceTemplate, second.workspaceTemplate)
    assert.notEqual(first.workspaceStyle, second.workspaceStyle)
    assert.match(
      await fs.readFile(path.join("public", first.workspaceTemplate), "utf8"),
      /generation A/,
    )
    assert.match(
      await fs.readFile(path.join("public", second.workspaceTemplate), "utf8"),
      /generation B/,
    )
    assert.match(
      await fs.readFile("public/maintenance-assets/workspace.txt", "utf8"),
      /generation B/,
    )
    assert.equal(
      await fs.readFile(path.join("public/maintenance-assets", first.entry), "utf8"),
      entryA,
    )
  } finally {
    process.chdir(originalDirectory)
    await fs.rm(root, { recursive: true, force: true })
  }
})
