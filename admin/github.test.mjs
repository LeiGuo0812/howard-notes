import test from "node:test"
import assert from "node:assert/strict"
import { GitHubLibrary, decodeBase64 } from "./github.mjs"
import fs from "node:fs/promises"
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
const article = {
  id: "a",
  file: "notes/a.md",
  title: "原文",
  category: "测试",
  date: "2026-09-30",
  published: true,
}
const snapshot = (sha = "original", articles = [article]) => ({
  commit: "head",
  tree: "tree",
  entries: new Map([["library/notes/a.md", { sha }]]),
  catalog: { version: 2, articles },
})
test("refuses to overwrite an article changed since it was opened", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  client.snapshot = async () => snapshot("new remote sha")
  client.repo = () => assert.fail("must not write")
  await assert.rejects(
    client.save({ opened: article, openedSha: "original", edited: article, text: "local" }),
    /另一端/,
  )
})
test("saves article and settings atomically and never forces the branch", async () => {
  const client = new GitHubLibrary("test-not-a-token"),
    calls = []
  client.snapshot = async () => snapshot()
  client.repo = async (endpoint, method, body) => {
    calls.push({ endpoint, method, body })
    return { sha: endpoint === "git/trees" ? "new-tree" : "new-commit" }
  }
  await client.save({
    opened: article,
    openedSha: "original",
    edited: { ...article, published: false },
    text: "exact\r\n",
  })
  assert.deepEqual(
    calls[0].body.tree.map((item) => item.path),
    ["library/catalog.json", "library/notes/a.md"],
  )
  assert.equal(calls[0].body.tree[1].content, "exact\r\n")
  assert.deepEqual(calls[1].body.parents, ["head"])
  assert.equal(calls[2].body.force, false)
})
test("a racing branch update is surfaced as failure, without forced retry", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  let patches = 0
  client.snapshot = async () => snapshot()
  client.repo = async (endpoint, method) => {
    if (method === "PATCH") {
      patches++
      throw new Error("branch advanced")
    }
    return { sha: "new" }
  }
  await assert.rejects(
    client.save({ opened: article, openedSha: "original", edited: article, text: "new" }),
    /branch advanced/,
  )
  assert.equal(patches, 1)
})
test("decodes UTF-8 with BOM and CRLF losslessly", () => {
  const original = "\uFEFF中文\r\n原文\r\n"
  assert.equal(decodeBase64(Buffer.from(original).toString("base64")), original)
})
test("page settings use independent conflict detection and never write Markdown", async () => {
  const client = new GitHubLibrary("test-not-a-token"),
    calls = []
  client.snapshot = async () => ({ ...snapshot(), siteSha: "site-old", settings })
  client.repo = async (endpoint, method, body) => {
    calls.push({ endpoint, method, body })
    return { sha: "new" }
  }
  const edited = structuredClone(settings)
  edited.home.title = "新首页"
  await client.saveSettings({ openedSha: "site-old", settings: edited })
  assert.deepEqual(
    calls[0].body.tree.map((item) => item.path),
    ["library/site.json"],
  )
  assert.equal(calls[2].body.force, false)
  calls.length = 0
  await assert.rejects(client.saveSettings({ openedSha: "stale", settings: edited }), /另一端/)
  assert.equal(calls.length, 0)
})
test("settings cannot silently reassign article categories or delete an occupied topic", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  const inTopic = { ...article, category: settings.topics[0].category }
  client.snapshot = async () => ({
    ...snapshot("original", [inTopic]),
    siteSha: "site-old",
    settings,
  })
  client.repo = () => assert.fail("must not write")
  const changed = structuredClone(settings)
  changed.topics[0].category = "其他"
  await assert.rejects(client.saveSettings({ openedSha: "site-old", settings: changed }), /归属/)
  const removed = structuredClone(settings)
  removed.topics.shift()
  await assert.rejects(
    client.saveSettings({ openedSha: "site-old", settings: removed }),
    /仍有文章/,
  )
})
