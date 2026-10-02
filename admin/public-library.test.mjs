import test from "node:test"
import assert from "node:assert/strict"
import { publicLibrarySnapshot } from "./public-library.mjs"
import { topicList } from "../scripts/lib/site-settings.mjs"

test("public settings never discover categories or text from the owner's private index", () => {
  const client = { token: "fixture-token" },
    publicSnapshot = {
      siteSha: "public-settings-sha",
      settings: { topics: [] },
      catalog: { articles: [{ id: "same-id", category: "公开专题", published: true }] },
      entries: new Map([["library/notes/public.md", { sha: "public-blob" }]]),
    }
  const owner = {
    ...publicSnapshot,
    client,
    catalog: {
      articles: [
        { id: "same-id", category: "PRIVATE_CATEGORY", title: "PRIVATE_TITLE", published: false },
      ],
    },
    entries: new Map([["library/notes/private.md", { sha: "pv:7" }]]),
    texts: new Map([["private.md", "PRIVATE_SOURCE"]]),
    privateArticles: new Map(),
    publicSnapshot,
  }
  const settings = publicLibrarySnapshot(owner)
  assert.equal(settings.client, client)
  assert.equal(settings.siteSha, publicSnapshot.siteSha)
  assert.equal(settings.catalog.articles[0].published, true)
  assert.equal(settings.entries, publicSnapshot.entries)
  assert.equal(settings.texts, undefined)
  assert.deepEqual(
    topicList(settings.settings, settings.catalog.articles).map((topic) => topic.category),
    ["公开专题"],
  )
  assert.doesNotMatch(JSON.stringify({ ...settings, client: undefined }), /PRIVATE|pv:/)
})

test("legacy Git-only snapshots remain unchanged and merged snapshots do not mutate their public baseline", () => {
  const publicSnapshot = { catalog: { articles: [] } }
  assert.equal(publicLibrarySnapshot(publicSnapshot), publicSnapshot)
  const owner = { client: {}, publicSnapshot }
  const result = publicLibrarySnapshot(owner)
  assert.equal(publicSnapshot.client, undefined)
  assert.equal(result.client, owner.client)
  assert.equal(result.catalog, publicSnapshot.catalog)
})
