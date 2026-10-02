import test from "node:test"
import assert from "node:assert/strict"
import {
  createPrivateReadingGate,
  privateReadingPage,
  privateReadingRows,
  privateNoteUrl,
  privateApiBase,
  privateReadingAnchor,
} from "./private-notes-core.mjs"

test("private API accepts the same-site route and exact configured Pages fallback", () => {
  const trusted = "https://api.notes.test/howard-notes/api/content"
  assert.equal(privateApiBase(trusted, "https://owner.github.io/howard-notes/", trusted), trusted)
  assert.equal(
    privateApiBase("api/content/", "https://notes.test/howard-notes/", trusted),
    "https://notes.test/howard-notes/api/content",
  )
  for (const unsafe of [
    "https://evil.test/howard-notes/api/content",
    "https://api.notes.test/other/api/content",
    "https://api.notes.test/howard-notes/api/content?target=evil",
    "https://api.notes.test/howard-notes/api/content#fragment",
    "https://owner:password@api.notes.test/howard-notes/api/content",
    "http://api.notes.test/howard-notes/api/content",
    "https://notes.test/another/api/content",
  ])
    assert.throws(() => privateApiBase(unsafe, "https://notes.test/howard-notes/", trusted))
})

const row = (id, values = {}) => ({
  status: "ACTIVE",
  article: {
    id,
    title: id,
    published: false,
    category: "技术",
    tags: ["学习"],
    created: "2024-01-01",
    modified: "2025-01-01",
    ...values,
  },
})
test("private reading excludes published archives, trash and editing drafts", () => {
  const rows = [
    row("private-one"),
    row("public-one", { published: true }),
    { ...row("trash-one"), status: "TRASH" },
    row("draft-one", { draft: true }),
    row("edit-one", { draftOf: "public-one" }),
  ]
  assert.deepEqual(
    privateReadingRows(rows).map((item) => item.article.id),
    ["private-one"],
  )
})
test("private lists paginate twenty rows, filter metadata and clamp page after filtering", () => {
  const rows = Array.from({ length: 45 }, (_, index) =>
    row(`note-${index}`, { modified: `2025-01-${String((index % 28) + 1).padStart(2, "0")}` }),
  )
  assert.equal(privateReadingPage(rows).rows.length, 20)
  assert.equal(privateReadingPage(rows, { page: 3 }).rows.length, 5)
  const filtered = privateReadingPage(rows, { query: "note-44", page: 3 })
  assert.equal(filtered.page, 1)
  assert.equal(filtered.total, 1)
  assert.equal(privateReadingPage(rows, { tag: "不存在" }).total, 0)
  assert.equal(privateReadingPage(rows, { category: "技术" }).total, 45)
})
test("private URL identifies the article without copying titles or filters", () => {
  const url = new URL(
    privateNoteUrl("https://notes.test/howard-notes/", "private-one", "article-h-heading"),
  )
  assert.equal(url.pathname, "/howard-notes/private/")
  assert.equal(url.search, "?note=private-one")
  assert.equal(url.hash, "#article-h-heading")
})
test("reading fragments handle Unicode anchors and malformed URL encoding safely", () => {
  assert.equal(privateReadingAnchor("#%E6%96%87%E7%AB%A0"), "文章")
  assert.equal(privateReadingAnchor("#%"), "%")
  assert.equal(privateReadingAnchor(""), "")
})
test("logout and session expiry invalidate even late responses ignoring abort", () => {
  let access = { account: "owner", token: "first-owner-token" }
  const gate = createPrivateReadingGate(() => access)
  assert.equal(gate.sync().access, access)
  const ticket = gate.begin()
  assert.equal(gate.valid(ticket), true)
  access = null
  assert.equal(gate.valid(ticket), false)
  assert.equal(gate.sync().access, null)
  assert.equal(ticket.signal.aborted, true)
  access = { account: "owner", token: "another-owner-token" }
  gate.sync()
  const next = gate.begin()
  assert.equal(gate.valid(ticket), false)
  assert.equal(gate.valid(next), true)
  gate.dispose()
  assert.equal(gate.valid(next), false)
  assert.equal(next.signal.aborted, true)
})
test("new requests discard old identity epochs, and anonymous gate never authorizes", () => {
  const anonymous = createPrivateReadingGate(() => null)
  assert.equal(anonymous.sync().access, null)
  assert.equal(anonymous.valid(anonymous.begin()), false)
  const gate = createPrivateReadingGate(() => ({ account: "owner", token: "same" }))
  gate.sync()
  const old = gate.begin()
  gate.invalidate()
  assert.equal(gate.valid(old), false)
  assert.equal(gate.valid(gate.begin()), true)
})
