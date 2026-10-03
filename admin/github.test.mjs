import test from "node:test"
import assert from "node:assert/strict"
import { GitHubLibrary, decodeBase64, gitBlobSha } from "./github.mjs"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { pruneTrashDirectory } from "../scripts/prune-trash.mjs"
import { readLayoutDraft, writeLayoutDraft, clearLayoutDraft } from "./layout-draft.mjs"
import { TRASH_RETENTION_MS, trashPaths, trashRecordContent } from "./trash.mjs"
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))

test("GitHub requests abort on a bounded deadline without automatically repeating writes", async () => {
  let calls = 0
  const client = new GitHubLibrary(
    "fixture",
    (_url, options) =>
      new Promise((_resolve, reject) => {
        calls++
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        })
      }),
    { requestTimeoutMs: 10 },
  )
  await assert.rejects(client.request("/fixture", "POST", { title: "private" }), /请求超时/)
  assert.equal(calls, 1)
})

test("GitHub request deadline includes response bodies and honors the task's aborted signal", async () => {
  const client = new GitHubLibrary(
    "fixture",
    async (_url, options) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          }),
        ),
    }),
    { requestTimeoutMs: 10 },
  )
  await assert.rejects(client.request("/fixture"), /请求超时/)
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const cancelled = new GitHubLibrary("fixture", async () => calls++, { signal: controller.signal })
  await assert.rejects(cancelled.request("/fixture"), /请求超时/)
  assert.equal(calls, 0)
})

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
async function settingsContentsFixture() {
  const texts = new Map([
    ["library/catalog.json", JSON.stringify({ version: 2, articles: [article] })],
    ["library/site.json", JSON.stringify(settings)],
  ])
  const files = new Map()
  for (const [path, text] of texts)
    files.set(path, {
      path,
      type: "file",
      encoding: "base64",
      sha: await gitBlobSha(text),
      content: Buffer.from(text).toString("base64"),
    })
  const client = new GitHubLibrary("test-not-a-token"),
    calls = []
  let commit = "1".repeat(40),
    contentGate = Promise.resolve()
  client.repo = async (endpoint) => {
    calls.push(endpoint)
    if (endpoint === "git/ref/heads/main") return { object: { sha: commit } }
    if (endpoint.startsWith("contents/")) {
      await contentGate
      return structuredClone(files.get(endpoint.split("?")[0].slice("contents/".length)))
    }
    if (endpoint.startsWith("git/blobs/")) {
      const file = [...files.values()].find((file) => endpoint.endsWith(file.sha))
      return { content: Buffer.from(texts.get(file.path)).toString("base64") }
    }
    assert.fail(`unexpected GitHub request: ${endpoint}`)
  }
  return {
    client,
    calls,
    files,
    texts,
    setCommit(value) {
      commit = value
    },
    setContentGate(value) {
      contentGate = value
    },
  }
}
test("settings initialization reads both files in parallel at one fixed commit without a full tree", async () => {
  const f = await settingsContentsFixture()
  let release
  f.setContentGate(new Promise((resolve) => (release = resolve)))
  const pending = f.client.settingsSnapshot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.calls, [
    "git/ref/heads/main",
    `contents/library/catalog.json?ref=${"1".repeat(40)}`,
    `contents/library/site.json?ref=${"1".repeat(40)}`,
  ])
  f.setCommit("2".repeat(40))
  release()
  const first = await pending
  assert.equal(first.commit, "1".repeat(40))
  assert.equal(first.tree, null)
  assert.equal(first.settingsOnly, true)
  assert.deepEqual([...first.entries.keys()], ["library/catalog.json", "library/site.json"])
  assert.equal(first.entries.has(`library/${article.file}`), false)
  assert.equal(first.siteSha, f.files.get("library/site.json").sha)
  assert.deepEqual(first.settings, settings)
  assert.deepEqual(first.catalog.articles, [article])
  const second = await f.client.settingsSnapshot()
  assert.equal(second.commit, "2".repeat(40))
  assert.equal(f.calls.filter((call) => call === "git/ref/heads/main").length, 2)
  assert.equal(f.calls.filter((call) => call.startsWith("contents/")).length, 4)
})
test("settings Contents reuse immutable decoded bytes and fall back to the pinned blob for large files", async () => {
  const f = await settingsContentsFixture(),
    site = f.files.get("library/site.json"),
    catalog = f.files.get("library/catalog.json")
  site.encoding = "none"
  site.content = ""
  catalog.content = ""
  await f.client.settingsSnapshot()
  assert.deepEqual(
    f.calls.filter((call) => call.startsWith("git/blobs/")),
    [`git/blobs/${catalog.sha}`, `git/blobs/${site.sha}`],
  )
  await f.client.settingsSnapshot()
  assert.equal(f.calls.filter((call) => call.startsWith("git/blobs/")).length, 2)
  assert.equal(
    await f.client.blobText(f.files.get("library/catalog.json").sha),
    f.texts.get("library/catalog.json"),
  )
  assert.equal(f.calls.filter((call) => call.startsWith("git/blobs/")).length, 2)
  const inline = await settingsContentsFixture()
  await inline.client.settingsSnapshot()
  await inline.client.blobText(inline.files.get("library/site.json").sha)
  assert.equal(inline.calls.filter((call) => call.startsWith("git/blobs/")).length, 0)
})
test("settings initialization rejects malformed file metadata, mismatched bytes and invalid JSON", async () => {
  for (const change of [
    { type: "dir" },
    { path: "library/other.json" },
    { sha: "invalid" },
    { sha: "0".repeat(40) },
    { encoding: "utf-8" },
    { content: null },
  ]) {
    const f = await settingsContentsFixture()
    Object.assign(f.files.get("library/site.json"), change)
    await assert.rejects(f.client.settingsSnapshot(), /文件信息|文件版本/)
  }
  for (const text of ["broken-json", JSON.stringify({ brand: {} })]) {
    const f = await settingsContentsFixture()
    Object.assign(f.files.get("library/site.json"), {
      sha: await gitBlobSha(text),
      content: Buffer.from(text).toString("base64"),
    })
    await assert.rejects(f.client.settingsSnapshot())
  }
  const invalidCatalog = await settingsContentsFixture(),
    text = JSON.stringify({ version: 2, articles: [{ ...article, file: "../site.json" }] })
  Object.assign(invalidCatalog.files.get("library/catalog.json"), {
    sha: await gitBlobSha(text),
    content: Buffer.from(text).toString("base64"),
  })
  await assert.rejects(invalidCatalog.client.settingsSnapshot(), /原文文件路径/)
  const f = await settingsContentsFixture()
  f.setCommit("invalid")
  await assert.rejects(f.client.settingsSnapshot(), /版本信息/)
  assert.deepEqual(f.calls, ["git/ref/heads/main"])
})
test("settings bootstrap never bypasses fresh save conflict detection or writes from a partial tree", async () => {
  const f = await settingsContentsFixture(),
    opened = await f.client.settingsSnapshot()
  let freshReads = 0
  f.client.snapshot = async () => {
    freshReads++
    return {
      ...opened,
      tree: "complete-tree",
      settingsOnly: false,
      siteSha: "2".repeat(40),
    }
  }
  f.client.repo = () => assert.fail("a conflict must not write the repository")
  await assert.rejects(f.client.saveSettings({ openedSha: opened.siteSha, settings }), /另一端/)
  assert.equal(freshReads, 1)
})
test("saving from settings initialization commits against a fresh full tree with no force update", async () => {
  const f = await settingsContentsFixture(),
    opened = await f.client.settingsSnapshot(),
    latest = {
      ...opened,
      commit: "9".repeat(40),
      tree: "fresh-complete-tree",
      settingsOnly: false,
      entries: new Map([
        ...opened.entries,
        [`library/${article.file}`, { path: `library/${article.file}`, sha: "original-sha" }],
      ]),
    }
  const calls = recordWrites(f.client, latest),
    edited = { ...settings, home: { ...settings.home, title: "修改后的主页" } },
    result = await f.client.saveSettings({ openedSha: opened.siteSha, settings: edited })
  assert.equal(calls[0].body.base_tree, latest.tree)
  assert.deepEqual(
    calls[0].body.tree.map((change) => change.path),
    ["library/site.json"],
  )
  assert.deepEqual(calls[1].body.parents, [latest.commit])
  assert.equal(calls[2].body.force, false)
  assert.equal(result.snapshot.settingsOnly, false)
  assert.equal(result.snapshot.entries.get(`library/${article.file}`).sha, "original-sha")
})
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
test("draft deletion supports standalone, retracted and linked drafts while retaining every other article", async (t) => {
  const standalone = {
    ...article,
    id: "draft-standalone",
    file: "notes/网页新建/draft-standalone.md",
    published: false,
  }
  const retracted = { ...article, published: false }
  const unrelated = { ...article, id: "b", file: "notes/b.md" }
  for (const [name, draft, retained] of [
    ["standalone website draft", standalone, [article, unrelated]],
    ["retracted original article", retracted, [unrelated]],
    ["linked editing draft", revision(), [article, unrelated]],
  ]) {
    await t.test(name, async () => {
      const latest = snapshot("original", structuredClone([...retained, draft]))
      latest.entries.set(`library/${draft.file}`, { sha: "draft-version" })
      latest.entries.set("library/notes/b.md", { sha: "unrelated-version" })
      latest.entries.set("library/assets/shared.png", { sha: "image-version" })
      const client = new GitHubLibrary("test-not-a-token")
      const calls = recordWrites(client, latest)
      const result = await client.removeDraft({ opened: draft, openedSha: "draft-version" })
      assert.equal(result.sha, "new")
      assert.equal(calls.length, 3)
      const tree = calls[0].body.tree
      assert.deepEqual(JSON.parse(tree[0].content).articles, retained)
      assert.deepEqual(
        tree.filter((item) => item.path.startsWith("library/notes/")),
        [{ path: `library/${draft.file}`, mode: "100644", type: "blob", sha: null }],
      )
      assert.equal(calls[2].body.force, false)
      assert.equal(latest.entries.get("library/notes/b.md").sha, "unrelated-version")
      assert.equal(latest.entries.get("library/assets/shared.png").sha, "image-version")
    })
  }
})
test("draft deletion keeps a restored draft's original SHA and metadata baseline instead of accepting a newer remote version", async (t) => {
  const draft = { ...article, published: false }
  for (const changed of ["body", "metadata", "entry-removed", "file-removed"]) {
    await t.test(changed, async () => {
      const latest = snapshot("draft-version", [structuredClone(draft)])
      if (changed === "body") latest.entries.set("library/notes/a.md", { sha: "newer-draft" })
      if (changed === "metadata") latest.catalog.articles[0].title = "另一端的新草稿"
      if (changed === "entry-removed") latest.catalog.articles = []
      if (changed === "file-removed") latest.entries.delete("library/notes/a.md")
      const client = new GitHubLibrary("test-not-a-token")
      const calls = recordWrites(client, latest)
      await assert.rejects(
        client.removeDraft({ opened: draft, openedSha: "draft-version" }),
        /另一端/,
      )
      assert.equal(calls.length, 0)
    })
  }
})
test("draft deletion rejects missing SHAs and unsafe source paths before repository access", async (t) => {
  for (const [name, opened, openedSha] of [
    ["missing SHA", { ...article, published: false }, undefined],
    ["empty SHA", { ...article, published: false }, ""],
    ["path traversal", { ...article, published: false, file: "notes/../../README.md" }, "sha"],
    ["shared image path", { ...article, published: false, file: "assets/shared.md" }, "sha"],
  ]) {
    await t.test(name, async () => {
      const client = new GitHubLibrary("test-not-a-token")
      client.snapshot = () => assert.fail("invalid deletion baseline must not read repository")
      client.repo = () => assert.fail("invalid deletion baseline must not write")
      await assert.rejects(client.removeDraft({ opened, openedSha }))
    })
  }
})
test("draft deletion rejects a malformed latest catalog without modifying it", async () => {
  const draft = { ...article, published: false }
  const latest = snapshot("draft-version", [draft, { ...article, id: "b", file: "../site.json" }])
  const client = new GitHubLibrary("test-not-a-token")
  const calls = recordWrites(client, latest)
  await assert.rejects(client.removeDraft({ opened: draft, openedSha: "draft-version" }), /路径/)
  assert.equal(calls.length, 0)
})
function publishedDeletionFixture() {
  const draft = revision()
  const unrelated = { ...article, id: "b", file: "notes/b.md", title: "另一篇文章" }
  const unrelatedDraft = {
    ...draft,
    id: "draft-b",
    file: "notes/网页草稿/draft-b.md",
    draftOf: "b",
    draftBaseline: { article: unrelated, sha: "other-original" },
  }
  const latest = snapshot("original", structuredClone([article, draft, unrelated, unrelatedDraft]))
  latest.entries.set(`library/${draft.file}`, { sha: "draft-version" })
  latest.entries.set(`library/${unrelated.file}`, { sha: "other-original" })
  latest.entries.set(`library/${unrelatedDraft.file}`, { sha: "other-draft" })
  latest.entries.set("library/assets/shared.png", { sha: "shared-image" })
  latest.entries.set("library/site.json", { sha: "site-settings" })
  return {
    latest,
    baseline: {
      opened: structuredClone(article),
      openedSha: "original",
      openedDrafts: [{ article: structuredClone(draft), sha: "draft-version" }],
    },
  }
}
test("published deletion removes the article and linked drafts in one commit, retaining other notes and shared assets", async () => {
  const { latest, baseline } = publishedDeletionFixture()
  // Metadata from an unrelated concurrent edit must survive this deletion.
  latest.catalog.articles[2].title = "另一端更新的文章"
  const client = new GitHubLibrary("test-not-a-token")
  const calls = recordWrites(client, latest)
  const result = await client.removePublishedArticle(baseline)
  assert.deepEqual(result.removedIds, ["a", "draft-a"])
  assert.equal(result.sha, "new")
  assert.equal(calls.length, 3)
  const tree = calls[0].body.tree
  assert.equal(calls[0].body.base_tree, "tree")
  assert.deepEqual(JSON.parse(tree[0].content).articles, latest.catalog.articles.slice(2))
  assert.deepEqual(
    tree.filter((item) => item.path.startsWith("library/notes/")),
    [
      { path: "library/notes/a.md", mode: "100644", type: "blob", sha: null },
      { path: "library/notes/网页草稿/draft-a.md", mode: "100644", type: "blob", sha: null },
    ],
  )
  assert.deepEqual(calls[1].body.parents, ["head"])
  assert.match(calls[1].body.message, /^Delete article:/)
  assert.equal(calls[2].body.force, false)
  assert.equal(latest.entries.get("library/assets/shared.png").sha, "shared-image")
  assert.equal(latest.entries.get("library/site.json").sha, "site-settings")
  assert.equal(latest.entries.get("library/notes/b.md").sha, "other-original")
})
test("published deletion without linked drafts changes only its catalog entry and source file", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  const calls = recordWrites(client, snapshot())
  const result = await client.removePublishedArticle({
    opened: article,
    openedSha: "original",
    openedDrafts: [],
  })
  assert.deepEqual(result.removedIds, ["a"])
  const tree = calls[0].body.tree
  assert.deepEqual(JSON.parse(tree[0].content).articles, [])
  assert.deepEqual(
    tree.filter((entry) => !entry.path.startsWith("library/trash/")).map((entry) => entry.path),
    ["library/catalog.json", "library/notes/a.md"],
  )
  assert.equal(tree[1].sha, null)
})
test("published deletion checks every linked draft against the reviewed snapshot, even when its publishing baseline is older", async () => {
  const { latest, baseline } = publishedDeletionFixture()
  const newerOriginal = { ...article, title: "当前已发布版本" }
  latest.catalog.articles[0] = newerOriginal
  latest.entries.set("library/notes/a.md", { sha: "new-original" })
  baseline.opened = structuredClone(newerOriginal)
  baseline.openedSha = "new-original"
  const anotherDraft = {
    ...revision(),
    id: "draft-another",
    file: "notes/网页草稿/draft-another.md",
  }
  latest.catalog.articles.push(anotherDraft)
  latest.entries.set(`library/${anotherDraft.file}`, { sha: "another-draft" })
  baseline.openedDrafts.push({ article: structuredClone(anotherDraft), sha: "another-draft" })
  const client = new GitHubLibrary("test-not-a-token")
  const calls = recordWrites(client, latest)
  const result = await client.removePublishedArticle(baseline)
  assert.deepEqual(result.removedIds, ["a", "draft-a", "draft-another"])
  assert.deepEqual(
    calls[0].body.tree
      .filter((change) => change.path.startsWith("library/notes/"))
      .map((change) => change.path),
    [
      "library/notes/a.md",
      "library/notes/网页草稿/draft-a.md",
      "library/notes/网页草稿/draft-another.md",
    ],
  )
})
test("published deletion rejects original and linked-draft races before creating any tree or commit", async (t) => {
  const races = {
    "published body changed": ({ latest }) =>
      latest.entries.set("library/notes/a.md", { sha: "new-original" }),
    "published metadata changed": ({ latest }) => {
      latest.catalog.articles[0].title = "更改的标题"
    },
    "published entry removed": ({ latest }) => {
      latest.catalog.articles = latest.catalog.articles.filter((item) => item.id !== "a")
    },
    "published file removed": ({ latest }) => latest.entries.delete("library/notes/a.md"),
    "linked draft body changed": ({ latest }) =>
      latest.entries.set("library/notes/网页草稿/draft-a.md", { sha: "new-draft" }),
    "linked draft metadata changed": ({ latest }) => {
      latest.catalog.articles[1].title = "更改的草稿"
    },
    "linked draft removed": ({ latest }) => {
      latest.catalog.articles = latest.catalog.articles.filter((item) => item.id !== "draft-a")
    },
    "linked draft file removed": ({ latest }) =>
      latest.entries.delete("library/notes/网页草稿/draft-a.md"),
    "linked draft added": ({ latest }) => {
      const added = { ...revision(), id: "draft-new", file: "notes/网页草稿/draft-new.md" }
      latest.catalog.articles.push(added)
      latest.entries.set(`library/${added.file}`, { sha: "added-draft" })
    },
    "unreviewed draft set omitted": ({ baseline }) => {
      baseline.openedDrafts = []
    },
  }
  for (const [name, mutate] of Object.entries(races)) {
    await t.test(name, async () => {
      const fixture = publishedDeletionFixture()
      mutate(fixture)
      const client = new GitHubLibrary("test-not-a-token")
      const calls = recordWrites(client, fixture.latest)
      await assert.rejects(client.removePublishedArticle(fixture.baseline), /另一端/)
      assert.equal(calls.length, 0)
    })
  }
})
test("published deletion rejects incomplete or unsafe deletion baselines without reading or writing the repository", async (t) => {
  const invalid = {
    "not a published article": (baseline) => {
      baseline.opened.published = false
    },
    "missing original SHA": (baseline) => {
      baseline.openedSha = null
    },
    "missing linked draft SHA": (baseline) => {
      baseline.openedDrafts[0].sha = null
    },
    "unrelated draft": (baseline) => {
      baseline.openedDrafts[0].article.draftOf = "b"
    },
    "unsafe original path": (baseline) => {
      baseline.opened.file = "notes/../../README.md"
    },
    "unsafe linked path": (baseline) => {
      baseline.openedDrafts[0].article.file = "notes/../site.json"
    },
    "asset deletion path": (baseline) => {
      baseline.openedDrafts[0].article.file = "assets/image.md"
    },
    "duplicate linked draft": (baseline) => {
      baseline.openedDrafts.push(structuredClone(baseline.openedDrafts[0]))
    },
  }
  for (const [name, mutate] of Object.entries(invalid)) {
    await t.test(name, async () => {
      const { baseline } = publishedDeletionFixture()
      mutate(baseline)
      const client = new GitHubLibrary("test-not-a-token")
      client.snapshot = () =>
        assert.fail("invalid paths must be refused before reading the repository")
      client.repo = () => assert.fail("invalid paths must not write")
      await assert.rejects(client.removePublishedArticle(baseline))
    })
  }
})
test("published deletion refuses a malformed latest catalog before writing", async () => {
  const { latest, baseline } = publishedDeletionFixture()
  latest.catalog.articles[1].file = "notes/../../site.json"
  const client = new GitHubLibrary("test-not-a-token")
  const calls = recordWrites(client, latest)
  await assert.rejects(client.removePublishedArticle(baseline), /路径/)
  assert.equal(calls.length, 0)
})
test("a racing branch refuses published deletion without forcing or retrying the ref update", async () => {
  const { latest, baseline } = publishedDeletionFixture()
  const client = new GitHubLibrary("test-not-a-token")
  const calls = []
  let remoteHead = "head"
  client.snapshot = async () => latest
  client.repo = async (endpoint, method, body) => {
    calls.push({ endpoint, method, body })
    if (endpoint === "git/trees") remoteHead = "concurrent-head"
    if (method === "PATCH") {
      assert.equal(body.force, false)
      if (remoteHead !== latest.commit) throw new Error("branch advanced")
      remoteHead = body.sha
    }
    return { sha: "new" }
  }
  await assert.rejects(client.removePublishedArticle(baseline), /branch advanced/)
  assert.equal(remoteHead, "concurrent-head")
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1)
  assert.deepEqual(calls[1].body.parents, ["head"])
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

test("successful ref writes return exact committed content and conflict baselines without reload", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  const latest = { ...snapshot(), settings, siteSha: "site-old" }
  const calls = recordWrites(client, latest)
  const text = "\uFEFF原始字节\r\n\r\n新正文。\r\n"
  const edited = { ...article, title: "已提交标题" }
  const result = await client.save({ opened: article, openedSha: "original", edited, text })
  const expected = createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex")
  assert.equal(await gitBlobSha(text), expected)
  assert.equal(result.snapshot.entries.get("library/notes/a.md").sha, expected)
  assert.equal(result.snapshot.commit, result.sha)
  assert.equal(result.snapshot.tree, "new")
  assert.deepEqual(result.snapshot.catalog.articles[0], edited)
  const beforeRead = calls.length
  assert.deepEqual(await client.read(edited, result.snapshot), { text, sha: expected })
  assert.equal(calls.length, beforeRead)
  assert.equal(latest.entries.get("library/notes/a.md").sha, "original")
  assert.equal(latest.catalog.articles[0].title, "原文")
})

test("committed settings snapshot carries the new independent settings SHA", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  const latest = { ...snapshot(), settings, siteSha: "site-old" }
  recordWrites(client, latest)
  const edited = { ...settings, home: { ...settings.home, title: "新的主页" } }
  const result = await client.saveSettings({ openedSha: "site-old", settings: edited })
  assert.deepEqual(result.snapshot.settings, edited)
  assert.equal(result.snapshot.siteSha, await gitBlobSha(JSON.stringify(edited, null, 2) + "\n"))
  assert.equal(result.snapshot.entries.get("library/notes/a.md").sha, "original")
})

const TRASH_ID = "11111111-2222-4333-8444-555555555555"
const RECYCLE_TIME = Date.parse("2026-10-01T00:00:00.000Z")

async function recycleFixture({ published = true, linked = true } = {}) {
  const original = { ...article, published }
  const draft = revision()
  const unrelated = { ...article, id: "b", file: "notes/b.md", title: "其他文章" }
  const notes = linked ? [original, unrelated, draft] : [original, unrelated]
  const latest = snapshot("original", structuredClone(notes))
  const source = "\uFEFF# 中文原文\r\n\r\n原始正文与链接。\r\n"
  const draftSource = "\uFEFF## 编辑中的草稿\r\n未发布修改\r\n"
  const sourceSha = await gitBlobSha(source)
  const draftSha = await gitBlobSha(draftSource)
  latest.entries.set("library/notes/a.md", { sha: sourceSha, mode: "100644" })
  latest.entries.set("library/notes/b.md", { sha: "unrelated", mode: "100644" })
  latest.entries.set("library/assets/shared.png", { sha: "shared", mode: "100644" })
  if (linked) latest.entries.set(`library/${draft.file}`, { sha: draftSha, mode: "100755" })
  const client = new GitHubLibrary("test-not-a-token", undefined, {
    now: () => RECYCLE_TIME,
    trashId: () => TRASH_ID,
  })
  const calls = recordWrites(client, latest)
  const options = {
    opened: original,
    openedSha: sourceSha,
    openedDrafts: linked ? [{ article: draft, sha: draftSha }] : [],
  }
  const result = published
    ? await client.removePublishedArticle(options)
    : await client.removeDraft(options)
  return { client, calls, original, draft, source, draftSource, sourceSha, draftSha, result }
}

test("recycling published notes archives all original blobs and metadata atomically outside the public catalog", async () => {
  const fixture = await recycleFixture()
  const { result, calls, original, draft, sourceSha, draftSha } = fixture
  assert.equal(result.trashId, TRASH_ID)
  assert.equal(result.record.deletedAt, "2026-10-01T00:00:00.000Z")
  assert.equal(result.record.expiresAt, "2026-10-31T00:00:00.000Z")
  assert.equal(result.scope, "published")
  assert.deepEqual(result.removedIds, ["a", "draft-a"])
  assert.deepEqual(
    result.record.articles.map((item) => item.article),
    [original, draft],
  )
  assert.deepEqual(
    result.record.articles.map((item) => item.sha),
    [sourceSha, draftSha],
  )
  assert.deepEqual(
    result.record.articles.map((item) => item.index),
    [0, 2],
  )
  assert.deepEqual(
    result.snapshot.catalog.articles.map((item) => item.id),
    ["b"],
  )
  assert.equal(result.snapshot.entries.has("library/notes/a.md"), false)
  assert.equal(result.snapshot.entries.has(`library/${draft.file}`), false)
  assert.equal(result.snapshot.entries.get(result.record.articles[0].sourcePath).sha, sourceSha)
  assert.equal(result.snapshot.entries.get(result.record.articles[1].sourcePath).sha, draftSha)
  assert.equal(result.snapshot.entries.get(result.record.articles[1].sourcePath).mode, "100755")
  assert.equal(calls.length, 3, "original Markdown does not need downloading or rewriting")
  assert.equal(calls[2].body.force, false)
  const archiveWrites = calls[0].body.tree.filter((item) => item.path.includes("/sources/"))
  assert.ok(archiveWrites.every((item) => item.sha && item.content === undefined))
  assert.deepEqual(await fixture.client.listTrash(result.snapshot), [result.record])
  assert.equal(calls.length, 3, "accepted snapshot supplies the manifest without another fetch")
})

test("restoring recycled articles uses original blobs, exact metadata, source paths and catalog positions", async () => {
  const { client, result, source, draftSource, sourceSha, draftSha, original, draft } =
    await recycleFixture()
  const calls = recordWrites(client, result.snapshot)
  const restored = await client.restoreTrash(result.record, result.snapshot)
  assert.deepEqual(restored.restoredIds, ["a", "draft-a"])
  assert.equal(restored.scope, "published")
  assert.deepEqual(
    restored.snapshot.catalog.articles.map((item) => item.id),
    ["a", "b", "draft-a"],
  )
  assert.deepEqual(restored.snapshot.catalog.articles[0], original)
  assert.deepEqual(restored.snapshot.catalog.articles[2], draft)
  assert.equal(restored.snapshot.entries.get("library/notes/a.md").sha, sourceSha)
  assert.equal(restored.snapshot.entries.get(`library/${draft.file}`).sha, draftSha)
  assert.equal(restored.snapshot.entries.get(`library/${draft.file}`).mode, "100755")
  assert.ok(trashPaths(result.record).every((file) => !restored.snapshot.entries.has(file)))
  assert.equal(restored.snapshot.entries.get("library/assets/shared.png").sha, "shared")
  assert.equal(calls[2].body.force, false)
  const bytes = new Map([
    [sourceSha, source],
    [draftSha, draftSource],
  ])
  client.repo = async (endpoint) => ({
    content: Buffer.from(bytes.get(endpoint.replace("git/blobs/", ""))).toString("base64"),
  })
  const restoredOriginal = await client.read(original, restored.snapshot)
  const restoredDraft = await client.read(draft, restored.snapshot)
  assert.deepEqual(Buffer.from(restoredOriginal.text), Buffer.from(source))
  assert.deepEqual(Buffer.from(restoredDraft.text), Buffer.from(draftSource))
})

test("all unpublished article states can be recycled and restored without changing their visibility", async (t) => {
  for (const linked of [false, true]) {
    await t.test(linked ? "retracted original and linked edit" : "standalone draft", async () => {
      const { client, result, original } = await recycleFixture({ published: false, linked })
      assert.equal(result.scope, "draft")
      assert.equal(result.record.published, false)
      recordWrites(client, result.snapshot)
      const restored = await client.restoreTrash(result.record)
      assert.equal(restored.published, false)
      assert.equal(restored.scope, "draft")
      assert.deepEqual(restored.snapshot.catalog.articles[0], original)
    })
  }
  await t.test("linked editing draft while published original remains untouched", async () => {
    const draft = revision()
    const latest = snapshot("original", [article, draft])
    latest.entries.set(`library/${draft.file}`, { sha: "draft-version" })
    const client = new GitHubLibrary("test-not-a-token", undefined, { now: () => RECYCLE_TIME })
    recordWrites(client, latest)
    const deleted = await client.removeDraft({ opened: draft, openedSha: "draft-version" })
    assert.equal(deleted.scope, "draft")
    recordWrites(client, deleted.snapshot)
    const restored = await client.restoreTrash(deleted.record)
    assert.deepEqual(restored.snapshot.catalog.articles, [article, draft])
    assert.equal(restored.snapshot.entries.get("library/notes/a.md").sha, "original")
  })
})

test("recycle restoration refuses ID, original-path, new-draft and archive races without any writes", async (t) => {
  const races = {
    "article ID reused": (latest) =>
      latest.catalog.articles.push({ ...article, file: "notes/new.md" }),
    "source path reused": (latest) => latest.entries.set("library/notes/a.md", { sha: "new" }),
    "catalog path reused": (latest) =>
      latest.catalog.articles.push({ ...article, id: "different" }),
    "manifest modified": (latest, record) => latest.entries.set(record.path, { sha: "different" }),
    "source modified": (latest, record) =>
      latest.entries.set(record.articles[0].sourcePath, { sha: "different" }),
    "source removed": (latest, record) => latest.entries.delete(record.articles[0].sourcePath),
  }
  for (const [name, mutate] of Object.entries(races)) {
    await t.test(name, async () => {
      const { client, result } = await recycleFixture()
      mutate(result.snapshot, result.record)
      const calls = recordWrites(client, result.snapshot)
      await assert.rejects(client.restoreTrash(result.record), /冲突|另一端|覆盖/)
      assert.equal(calls.length, 0)
    })
  }
})

test("recycle restoration refuses a replacement linked draft and missing original article", async () => {
  const draft = revision()
  const latest = snapshot("original", [article, draft])
  latest.entries.set(`library/${draft.file}`, { sha: "draft-version" })
  const client = new GitHubLibrary("test-not-a-token", undefined, { now: () => RECYCLE_TIME })
  recordWrites(client, latest)
  const deleted = await client.removeDraft({ opened: draft, openedSha: "draft-version" })
  const newer = { ...draft, id: "new-draft", file: "notes/new-draft.md" }
  deleted.snapshot.catalog.articles.push(newer)
  const calls = recordWrites(client, deleted.snapshot)
  await assert.rejects(client.restoreTrash(deleted.record), /已有修改草稿/)
  assert.equal(calls.length, 0)
  deleted.snapshot.catalog.articles = []
  await assert.rejects(client.restoreTrash(deleted.record), /原文章尚未恢复/)
  assert.equal(calls.length, 0)
})

test("purging and automatic expiry touch only archive files and refuse changed archive baselines", async () => {
  const { client, result } = await recycleFixture()
  const calls = recordWrites(client, result.snapshot)
  const purged = await client.purgeTrash(result.record)
  assert.deepEqual(
    calls[0].body.tree.map((item) => item.path),
    trashPaths(result.record),
  )
  assert.ok(
    calls[0].body.tree.every((item) => item.sha === null && item.path.startsWith("library/trash/")),
  )
  assert.deepEqual(purged.snapshot.catalog, result.snapshot.catalog)
  assert.equal(calls[2].body.force, false)
  calls.length = 0
  assert.equal(await client.pruneExpiredTrash(), null)
  assert.equal(calls.length, 0)
  client.now = () => RECYCLE_TIME + TRASH_RETENTION_MS
  assert.deepEqual(await client.listTrash(result.snapshot), [])
  await assert.rejects(client.restoreTrash(result.record), /超过 30 天/)
  assert.equal(calls.length, 0)
  await client.pruneExpiredTrash()
  assert.deepEqual(
    calls[0].body.tree.map((item) => item.path),
    trashPaths(result.record),
  )
  calls.length = 0
  result.snapshot.entries.set(result.record.path, { sha: "changed" })
  await assert.rejects(client.purgeTrash(result.record), /另一端/)
  assert.equal(calls.length, 0)
})

test("invalid recycle paths and record content cannot read or overwrite repository files", async () => {
  const { client, result } = await recycleFixture()
  client.snapshot = () => assert.fail("invalid manifests must be rejected before repository reads")
  const attacks = [
    { ...result.record, id: "../../site.json" },
    {
      ...result.record,
      articles: [{ ...result.record.articles[0], sourcePath: "library/site.json" }],
    },
    { ...result.record, expiresAt: "2099-01-01T00:00:00.000Z" },
    {
      ...result.record,
      articles: [
        { ...result.record.articles[0], article: { ...article, file: "notes/../../README.md" } },
      ],
    },
  ]
  for (const record of attacks) {
    await assert.rejects(client.restoreTrash(record))
    await assert.rejects(client.purgeTrash(record))
  }
})

test("local 30-day cleanup removes only complete expired archives and retains malformed, newer or foreign files", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "howard-trash-"))
  try {
    const { result, source, draftSource } = await recycleFixture()
    const originals = new Map([
      ["library/catalog.json", "catalog unchanged"],
      ["library/notes/new.md", "new article unchanged"],
      ["library/assets/shared.png", "shared image unchanged"],
    ])
    for (const [file, text] of originals) {
      await fs.mkdir(path.dirname(path.join(repository, file)), { recursive: true })
      await fs.writeFile(path.join(repository, file), text)
    }
    const records = [
      [result.record, "expired"],
      [{ ...result.record, id: "22222222-2222-4333-8444-555555555555" }, "newer"],
      [{ ...result.record, id: "33333333-2222-4333-8444-555555555555" }, "foreign-file"],
      [{ ...result.record, id: "44444444-2222-4333-8444-555555555555" }, "bad-body"],
    ]
    for (const [record, state] of records) {
      record.articles = structuredClone(record.articles)
      const root = `library/trash/${record.id}/`
      record.articles.forEach((item, i) => {
        item.sourcePath = `${root}sources/${i}.md`
      })
      if (state === "newer") {
        record.deletedAt = new Date(RECYCLE_TIME + 1).toISOString()
        record.expiresAt = new Date(RECYCLE_TIME + 1 + TRASH_RETENTION_MS).toISOString()
      }
      await fs.mkdir(path.join(repository, root, "sources"), { recursive: true })
      await fs.writeFile(path.join(repository, root, "record.json"), trashRecordContent(record))
      await fs.writeFile(
        path.join(repository, record.articles[0].sourcePath),
        state === "bad-body" ? "changed" : source,
      )
      await fs.writeFile(path.join(repository, record.articles[1].sourcePath), draftSource)
      if (state === "foreign-file")
        await fs.writeFile(path.join(repository, root, "extra.md"), "foreign")
    }
    const brokenRoot = "library/trash/55555555-2222-4333-8444-555555555555"
    await fs.mkdir(path.join(repository, brokenRoot), { recursive: true })
    await fs.writeFile(path.join(repository, brokenRoot, "record.json"), "invalid-json")
    const preview = await pruneTrashDirectory(repository, {
      now: RECYCLE_TIME + TRASH_RETENTION_MS,
    })
    assert.deepEqual(preview.expired, [TRASH_ID])
    assert.deepEqual(preview.removed, [])
    assert.equal(preview.retained.length, 1)
    assert.equal(preview.warnings.length, 3)
    const cleaned = await pruneTrashDirectory(repository, {
      now: RECYCLE_TIME + TRASH_RETENTION_MS,
      write: true,
    })
    assert.deepEqual(cleaned.removed, trashPaths(result.record))
    for (const [file, text] of originals)
      assert.equal(await fs.readFile(path.join(repository, file), "utf8"), text)
    for (const file of trashPaths(result.record))
      await assert.rejects(fs.access(path.join(repository, file)))
    for (const [record, state] of records.slice(1))
      assert.ok(
        await fs.readFile(path.join(repository, `library/trash/${record.id}/record.json`)),
        state,
      )
  } finally {
    await fs.rm(repository, { recursive: true, force: true })
  }
})

test("account and repository authorization reads start concurrently and still require push permission", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  let releaseUser
  const user = new Promise((resolve) => {
    releaseUser = resolve
  })
  const paths = []
  client.request = async (endpoint) => {
    paths.push(endpoint)
    if (endpoint === "/user") return user
    return { permissions: { push: true } }
  }
  const login = client.authenticate()
  assert.deepEqual(paths, ["/user", "/repos/LeiGuo0812/howard-notes"])
  releaseUser({ login: "owner" })
  assert.equal(await login, "owner")
  client.request = async (endpoint) =>
    endpoint === "/user" ? { login: "reader" } : { permissions: { push: false } }
  await assert.rejects(client.authenticate(), /写入权限/)
})

test("snapshot reads immutable catalog and settings blobs in parallel from one current tree and never caches branch heads", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  let releaseCatalog
  const catalog = new Promise((resolve) => {
    releaseCatalog = resolve
  })
  const paths = []
  let head = "head-one"
  client.repo = async (endpoint) => {
    paths.push(endpoint)
    if (endpoint === "git/ref/heads/main") return { object: { sha: head } }
    if (endpoint.startsWith("git/commits/")) return { tree: { sha: "current-tree" } }
    if (endpoint === "git/trees/current-tree?recursive=1")
      return {
        tree: [
          { path: "library/catalog.json", type: "blob", sha: "catalog-from-this-tree" },
          { path: "library/site.json", type: "blob", sha: "site-from-this-tree" },
        ],
      }
    if (endpoint === "git/blobs/catalog-from-this-tree") return catalog
    if (endpoint === "git/blobs/site-from-this-tree")
      return {
        content: Buffer.from(JSON.stringify(settings)).toString("base64"),
      }
    assert.fail(`unexpected request: ${endpoint}`)
  }
  const first = client.snapshot()
  while (!paths.includes("git/blobs/site-from-this-tree"))
    await new Promise((resolve) => setImmediate(resolve))
  assert.ok(paths.includes("git/blobs/catalog-from-this-tree"))
  releaseCatalog({
    content: Buffer.from(JSON.stringify({ version: 2, articles: [article] })).toString("base64"),
  })
  assert.equal((await first).commit, "head-one")
  head = "head-two"
  const second = await client.snapshot()
  assert.equal(second.commit, "head-two")
  assert.equal(paths.filter((item) => item === "git/ref/heads/main").length, 2)
  assert.equal(paths.filter((item) => item.startsWith("git/trees/")).length, 2)
  assert.equal(paths.filter((item) => item.startsWith("git/blobs/")).length, 2)
  assert.deepEqual(second.settings, settings)
  assert.deepEqual(second.catalog.articles, [article])
})

test("article reads coalesce immutable SHA requests while newer versions and failed reads remain fresh", async () => {
  const client = new GitHubLibrary("test-not-a-token")
  const source = "\uFEFF原文字节\r\n"
  let release
  const blob = new Promise((resolve) => {
    release = resolve
  })
  const calls = []
  client.repo = async (endpoint) => {
    calls.push(endpoint)
    return blob
  }
  const first = client.read(article, snapshot("old-blob"))
  const parallel = client.read(article, snapshot("old-blob"))
  assert.deepEqual(calls, ["git/blobs/old-blob"])
  release({ content: Buffer.from(source).toString("base64") })
  assert.deepEqual(await first, { text: source, sha: "old-blob" })
  assert.deepEqual(await parallel, { text: source, sha: "old-blob" })
  await client.read(article, snapshot("old-blob"))
  assert.equal(calls.length, 1)
  client.repo = async (endpoint) => {
    calls.push(endpoint)
    return { content: Buffer.from("new version").toString("base64") }
  }
  assert.equal((await client.read(article, snapshot("new-blob"))).text, "new version")
  assert.deepEqual(calls, ["git/blobs/old-blob", "git/blobs/new-blob"])
  let failures = 0
  client.repo = async () => {
    failures++
    if (failures === 1) throw new Error("temporary outage")
    return { content: Buffer.from("retried").toString("base64") }
  }
  await assert.rejects(client.read(article, snapshot("retry-blob")), /temporary outage/)
  assert.equal((await client.read(article, snapshot("retry-blob"))).text, "retried")
  assert.equal(failures, 2)
})
