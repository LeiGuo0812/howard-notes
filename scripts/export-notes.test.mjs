import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const command = path.resolve("scripts/export-notes.mjs")
const header = (publish = true, extra = "") =>
  `---\ntitle: Public\ndescription: Example\ndate: 2026-09-29\npublish: ${publish}\ndraft: false\npermalink: notes/example\n${extra}---\n`
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-publish-"))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const source = path.join(dir, "source"),
    destination = path.join(dir, "content")
  await fs.mkdir(source)
  const run = (...args) =>
    execFileSync(
      process.execPath,
      [command, "--source", source, "--destination", destination, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
  return { dir, source, destination, run }
}

test("publishes only opted-in notes and referenced assets, strips private fields and comments", async (t) => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.source, "assets"))
  await fs.writeFile(path.join(f.source, "assets", "shown.png"), "public image")
  await fs.writeFile(path.join(f.source, "assets", "unused.png"), "private image")
  await fs.writeFile(
    path.join(f.source, "Public.md"),
    header(true, "private_field: SECRET_FIELD\n") +
      "Hello %% SECRET_COMMENT %%\n![Figure](assets/shown.png)\n`[[Private]]`\n```text\n[[Private]]\n```",
  )
  await fs.writeFile(path.join(f.source, "Private.md"), header(false) + "SECRET_NOTE")
  await fs.writeFile(path.join(f.source, "MissingFlag.md"), "# PRIVATE_DEFAULT")
  f.run()
  const text = await fs.readFile(path.join(f.destination, "notes/example.md"), "utf8")
  assert(!text.includes("SECRET_"))
  assert(text.includes("`[[Private]]`"))
  assert.equal((await fs.readdir(path.join(f.destination, "assets"))).length, 1)
  assert.equal(
    (await fs.readdir(path.join(f.destination, "notes"))).filter((name) => name !== "index.md")
      .length,
    1,
  )
})

test("unpublished link or embed fails before destination is created", async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.source, "Private.md"), header(false) + "SECRET_NOTE")
  for (const reference of ["[[Private]]", "![[Private]]"]) {
    await fs.writeFile(path.join(f.source, "Public.md"), header() + reference)
    assert.throws(() => f.run(), /未公开笔记/)
    await assert.rejects(fs.stat(f.destination), { code: "ENOENT" })
  }
})

test("rejects attachment escaping source, including symbolic links", async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.dir, "outside.png"), "SECRET")
  await fs.symlink(path.join(f.dir, "outside.png"), path.join(f.source, "shortcut.png"))
  for (const image of ["../outside.png", "shortcut.png"]) {
    await fs.writeFile(path.join(f.source, "Public.md"), header() + `![x](${image})`)
    assert.throws(() => f.run(), /附件超出发布目录/)
  }
})

test("retraction removes generated article and asset while preserving unmanaged files", async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.source, "figure.png"), "data")
  await fs.writeFile(path.join(f.source, "Public.md"), header() + "![x](figure.png)")
  f.run()
  await fs.writeFile(path.join(f.destination, "manual.txt"), "keep")
  await fs.writeFile(path.join(f.source, "Public.md"), header(false))
  f.run("--dry-run")
  assert(
    (await fs.readFile(path.join(f.destination, "notes/example.md"), "utf8")).includes("Public"),
  )
  f.run()
  await assert.rejects(fs.stat(path.join(f.destination, "notes/example.md")), { code: "ENOENT" })
  assert.equal((await fs.readdir(path.join(f.destination, "assets"))).length, 0)
  assert.equal(await fs.readFile(path.join(f.destination, "manual.txt"), "utf8"), "keep")
})

test("duplicate public URLs are rejected", async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.source, "First.md"), header() + "one")
  await fs.writeFile(path.join(f.source, "Second.md"), header() + "two")
  assert.throws(() => f.run(), /重复地址/)
})
