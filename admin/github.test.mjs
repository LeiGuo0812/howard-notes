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
      assert.deepEqual(tree.slice(1), [
        { path: `library/${draft.file}`, mode: "100644", type: "blob", sha: null },
      ])
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
  assert.deepEqual(tree.slice(1), [
    { path: "library/notes/a.md", mode: "100644", type: "blob", sha: null },
    { path: "library/notes/网页草稿/draft-a.md", mode: "100644", type: "blob", sha: null },
  ])
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
    tree.map((entry) => entry.path),
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
    calls[0].body.tree.slice(1).map((change) => change.path),
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
