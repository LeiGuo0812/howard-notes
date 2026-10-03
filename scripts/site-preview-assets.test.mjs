import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildSitePreview } from "./build-site-preview.mjs"

test("sample previews bind immutable HTML, script and the exact shared site stylesheet", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "howard-site-sample-"))
  try {
    const entry = await buildSitePreview({
      outputDirectory: directory,
      siteStyle: "index-01234567.css",
    })
    assert.match(entry, /^admin\/site-preview-[a-f0-9]{16}\.html$/)
    const html = await fs.readFile(path.join(directory, path.basename(entry)), "utf8")
    assert.match(html, /href="\.\.\/index-01234567\.css"/)
    assert.match(html, /site-preview-sample-[A-Z0-9]+\.js/)
    assert.match(html, /connect-src 'none'/)
    assert.doesNotMatch(
      html,
      /postscript|maintenance-assets|contentIndex|api\/content|runtime-config/,
    )
    const script = html.match(/src="([^"]+\.js)"/)?.[1]
    const bytes = await fs.readFile(path.join(directory, script), "utf8")
    assert.ok(bytes.length < 75000, "a bounded layout preview must not bundle a full-site runtime")
    assert.doesNotMatch(
      bytes,
      /https:\/\/api\.github\.com|howard_session|new Worker\(|pixi\.js|d3\.min|mermaid\.render/,
    )
    assert.equal(await fs.readFile(path.join(directory, "site-preview.html"), "utf8"), html)
    const second = await buildSitePreview({
      outputDirectory: directory,
      siteStyle: "index-89abcdef.css",
    })
    assert.notEqual(second, entry)
    assert.equal(
      await fs.readFile(path.join(directory, path.basename(entry)), "utf8"),
      html,
      "old preview HTML must remain unchanged for old settings bundles",
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("preview builds reject remote styles and paths outside the built site", async () => {
  for (const siteStyle of [
    "https://untrusted.example/index-01234567.css",
    "../../index-01234567.css",
    "index.css",
  ]) {
    await assert.rejects(buildSitePreview({ siteStyle }), /Invalid site preview stylesheet/)
  }
})
