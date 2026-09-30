import test from "node:test"
import assert from "node:assert/strict"
import { GitHubLibrary, decodeBase64 } from "./github.mjs"
import fs from "node:fs/promises"
import { readLayoutDraft, writeLayoutDraft, clearLayoutDraft } from "./layout-draft.mjs"
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))

test("layout drafts persist the original version without credentials or repository writes", () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  assert.equal(readLayoutDraft(storage), null)
  writeLayoutDraft(storage, "baseline-sha", settings)
  const restored = readLayoutDraft(storage)
  assert.equal(restored.openedSha, "baseline-sha")
  assert.deepEqual(restored.settings, settings)
  assert.ok(!JSON.stringify(restored).includes("token"))
  clearLayoutDraft(storage)
  assert.equal(readLayoutDraft(storage), null)
  storage.setItem("howard-notes:layout-draft:v1", "broken-json")
  assert.equal(readLayoutDraft(storage), null)
})
test("restore previous layout reads settings history without creating a commit", async () => {
  const client = new GitHubLibrary("test-not-a-token"),
    calls = []
  client.repo = async (endpoint) => {
    calls.push(endpoint)
    return endpoint.startsWith("commits?")
      ? [{ sha: "current" }, { sha: "previous" }]
      : { content: Buffer.from(JSON.stringify(settings)).toString("base64") }
  }
  assert.deepEqual(await client.previousSettings(), settings)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].endsWith("ref=previous"))
  client.repo = async () => [{ sha: "only" }]
  await assert.rejects(client.previousSettings(), /尚无/)
})
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
const revision = () => ({
  ...article,
  id: "draft-a",
  file: "notes/网页草稿/draft-a.md",
  published: false,
  draftOf: article.id,
  draftBaseline: { article: structuredClone(article), sha: "original" },
})
function recordWrites(client, latest) {
  const calls = []
  client.snapshot = async () => latest
  client.repo = async (endpoint, method, body) => {
    calls.push({ endpoint, method, body })
    return { sha: "new" }
  }
  return calls
}
test("saving a published article's editing draft leaves published metadata and bytes untouched", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  const calls = recordWrites(client, snapshot())
  const draft = revision()
  await client.save({ opened: null, openedSha: null, edited: draft, text: "new draft\r\n" })
  const tree = calls[0].body.tree
  assert.deepEqual(
    tree.map((change) => change.path),
    ["library/catalog.json", `library/${draft.file}`],
  )
  assert.deepEqual(JSON.parse(tree[0].content).articles[0], article)
  assert.equal(tree[1].content, "new draft\r\n")
  assert.equal(calls.at(-1).body.force, false)
})
test("publishing an editing draft atomically updates the original route and retires only that draft", async () => {
  const draft = revision(),
    latest = snapshot("original", [article, draft, { ...article, id: "b", file: "notes/b.md" }])
  latest.entries.set(`library/${draft.file}`, { sha: "draft-version" })
  const client = new GitHubLibrary("test-not-a-token"),
    calls = recordWrites(client, latest)
  const result = await client.publishDraft({
    opened: draft,
    openedSha: "draft-version",
    edited: { ...draft, title: "新标题" },
    text: "new original\r\n",
  })
  const tree = calls[0].body.tree,
    catalog = JSON.parse(tree[0].content)
  assert.equal(result.articleId, "a")
  assert.equal(catalog.articles.length, 2)
  assert.equal(catalog.articles[0].id, "a")
  assert.equal(catalog.articles[0].file, "notes/a.md")
  assert.equal(catalog.articles[0].published, true)
  assert.equal(catalog.articles[0].draftOf, undefined)
  assert.equal(catalog.articles[1].id, "b")
  assert.deepEqual(tree[1], {
    path: "library/notes/a.md",
    mode: "100644",
    type: "blob",
    content: "new original\r\n",
  })
  assert.equal(tree[2].path, `library/${draft.file}`)
  assert.equal(tree[2].sha, null)
  assert.equal(calls.at(-1).body.force, false)
})
test("new editing drafts reject a newer published version or an existing editing draft", async () => {
  const draft = revision(),
    client = new GitHubLibrary("test-not-a-token")
  for (const latest of [snapshot("new original"), snapshot("original", [article, draft])]) {
    const calls = recordWrites(client, latest)
    await assert.rejects(
      client.save({ opened: null, openedSha: null, edited: draft, text: "draft" }),
      /另一端|已有编辑草稿/,
    )
    assert.equal(calls.length, 0)
  }
})
test("draft publishing detects changes to either draft or published version before writing", async () => {
  for (const changed of ["draft-body", "original-body", "draft-settings", "original-settings"]) {
    const draft = revision(),
      latest = snapshot("original", [article, draft])
    latest.catalog = structuredClone(latest.catalog)
    latest.entries.set(`library/${draft.file}`, {
      sha: changed === "draft-body" ? "new-draft" : "draft-version",
    })
    if (changed === "original-body")
      latest.entries.set("library/notes/a.md", { sha: "new-original" })
    if (changed === "draft-settings") latest.catalog.articles[1].title = "concurrent"
    if (changed === "original-settings") latest.catalog.articles[0].title = "concurrent"
    const client = new GitHubLibrary("test-not-a-token"),
      calls = recordWrites(client, latest)
    await assert.rejects(
      client.publishDraft({
        opened: draft,
        openedSha: "draft-version",
        edited: draft,
        text: "new",
      }),
      /另一端/,
    )
    assert.equal(calls.length, 0)
  }
})
test("deleting an editing draft preserves the published article and refuses stale or published entries", async () => {
  const draft = revision(),
    latest = snapshot("original", [article, draft])
  latest.entries.set(`library/${draft.file}`, { sha: "draft-version" })
  const client = new GitHubLibrary("test-not-a-token"),
    calls = recordWrites(client, latest)
  await client.removeDraft({ opened: draft, openedSha: "draft-version" })
  const tree = calls[0].body.tree
  assert.deepEqual(JSON.parse(tree[0].content).articles, [article])
  assert.equal(tree[1].path, `library/${draft.file}`)
  assert.equal(tree[1].sha, null)
  calls.length = 0
  await assert.rejects(client.removeDraft({ opened: article, openedSha: "original" }), /未发布/)
  await assert.rejects(client.removeDraft({ opened: draft, openedSha: "stale" }), /另一端/)
  assert.equal(calls.length, 0)
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
