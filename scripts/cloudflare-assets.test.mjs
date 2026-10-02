import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import test from "node:test"

const run = promisify(execFile)
const script = new URL("./prepare-cloudflare-assets.mjs", import.meta.url).pathname

test("Cloudflare assets retain prior hashed root styles and scripts without prior reading content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-assets-"))
  const put = async (name, body) => {
    const file = path.join(directory, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
  }
  const get = (name) => fs.readFile(path.join(directory, name), "utf8")
  try {
    const previous = ".local/cloudflare-assets-current/howard-notes/"
    await put(previous + "index-abcdef.css", "old main")
    await put(previous + "component-123abc.css", "old component")
    await put(previous + "static/script-abcd.js", "old script")
    await put(previous + "notes/removed.html", "old note")
    await put(previous + "index.html", "old home")
    await put(previous + "static/removed.png", "old attachment")
    await put(previous + "custom.css", "not hashed")
    await put("public/index-123456.css", "new main")
    await put("public/index.html", "new home")
    await put("public/static/script-abcd.js", "new script")
    await run(process.execPath, [script], { cwd: directory })
    const assets = ".local/cloudflare-assets/howard-notes/"
    assert.equal(await get(assets + "index-abcdef.css"), "old main")
    assert.equal(await get(assets + "component-123abc.css"), "old component")
    assert.equal(await get(assets + "index-123456.css"), "new main")
    assert.equal(await get(assets + "static/script-abcd.js"), "new script")
    assert.equal(await get(assets + "index.html"), "new home")
    for (const missing of ["notes/removed.html", "static/removed.png", "custom.css"]) {
      await assert.rejects(get(assets + missing), { code: "ENOENT" })
    }
    await assert.rejects(get(previous + "index-abcdef.css"), { code: "ENOENT" })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
