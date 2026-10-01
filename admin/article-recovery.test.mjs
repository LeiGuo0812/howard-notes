import test from "node:test"
import assert from "node:assert/strict"
import { GitHubLibrary } from "./github.mjs"
import {
  RECOVERY_FIELDS,
  clearArticleRecovery,
  editorSourceText,
  listArticleRecoveries,
  readArticleRecovery,
  recoveredBaseline,
  writeArticleRecovery,
} from "./article-recovery.mjs"

const article = {
  id: "a",
  file: "notes/a.md",
  title: "原文",
  category: "测试",
  date: "2026-09-30",
  published: true,
}
function fixture() {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const form = Object.fromEntries(
    RECOVERY_FIELDS.map((key) => [key, key === "featured" ? false : ""]),
  )
  form.body = "修改正文\n"
  form.slug = "a"
  return {
    storage,
    values,
    recovery: {
      id: "a",
      article,
      raw: "\uFEFF原文\r\n",
      openedSha: "original",
      savedForm: "original-form",
      form,
      token: "must-not-persist",
      formExtra: "not-content",
    },
  }
}

test("article recovery retains original content and conflict baseline, never credentials", () => {
  const { storage, values, recovery } = fixture()
  assert.equal(readArticleRecovery(storage, "a"), null)
  writeArticleRecovery(storage, recovery)
  const loaded = readArticleRecovery(storage, "a")
  assert.equal(loaded.openedSha, "original")
  assert.equal(loaded.raw, "\uFEFF原文\r\n")
  assert.deepEqual(loaded.form, recovery.form)
  assert.equal(loaded.token, undefined)
  assert.ok(![...values.values()].join("").includes("must-not-persist"))
  clearArticleRecovery(storage, "a")
  assert.deepEqual(listArticleRecoveries(storage), [])
})

test("restoration does not silently rebase against a changed remote article", async () => {
  const { storage, recovery } = fixture()
  writeArticleRecovery(storage, recovery)
  const latestArticle = { ...article, title: "另一端修改" }
  const restored = recoveredBaseline(readArticleRecovery(storage, "a"), latestArticle, "new-sha")
  assert.equal(restored.stale, true)
  assert.equal(restored.openedSha, "original")
  assert.deepEqual(restored.article, article)
  const client = new GitHubLibrary("test-not-a-token")
  client.snapshot = async () => ({
    catalog: { version: 2, articles: [latestArticle] },
    entries: new Map([["library/notes/a.md", { sha: "new-sha" }]]),
  })
  client.commit = async () => assert.fail("stale recovery must not write a commit")
  await assert.rejects(
    client.save({
      opened: restored.article,
      openedSha: restored.openedSha,
      edited: { ...article },
      text: restored.form.body,
    }),
    /另一端更改/,
  )
})

test("new article recovery remains an insert and cancellation removes only its record", () => {
  const { storage, recovery } = fixture()
  writeArticleRecovery(storage, recovery)
  const fresh = {
    ...recovery,
    id: "new-note",
    article: null,
    openedSha: null,
    raw: "",
    form: { ...recovery.form, slug: "new-note" },
  }
  writeArticleRecovery(storage, fresh)
  const restored = recoveredBaseline(readArticleRecovery(storage, "new-note"), null, null)
  assert.equal(restored.stale, false)
  assert.equal(restored.article, null)
  assert.equal(restored.openedSha, null)
  clearArticleRecovery(storage, "new-note")
  assert.equal(listArticleRecoveries(storage).length, 1)
  assert.equal(readArticleRecovery(storage, "a").id, "a")
})

test("unmodified and edited source retain original BOM and newline convention", () => {
  const raw = "\uFEFF第一行\r\n第二行\r\n"
  assert.equal(editorSourceText(raw, "\uFEFF第一行\n第二行\n"), raw)
  assert.equal(editorSourceText(raw, "第一行\n第三行\n"), "\uFEFF第一行\r\n第三行\r\n")
  assert.equal(editorSourceText("正文\n", "修改\n"), "修改\n")
})

test("invalid and oversized recovery data cannot be restored", () => {
  const { storage, values, recovery } = fixture()
  writeArticleRecovery(storage, recovery)
  const key = [...values.keys()][0]
  storage.setItem(key, "broken-json")
  assert.deepEqual(listArticleRecoveries(storage), [])
  storage.setItem(key, "x".repeat(4000001))
  assert.deepEqual(listArticleRecoveries(storage), [])
  assert.throws(() => writeArticleRecovery(storage, { ...recovery, openedSha: null }), /不完整/)
})
