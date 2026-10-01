import test from "node:test"
import assert from "node:assert/strict"
import { listLocalTrash, trashLocalRecovery, removeLocalTrash } from "./local-trash.mjs"
function storage() {
  const values = new Map()
  return {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  }
}
const recovery = {
  id: "new-note",
  raw: "\uFEFF# 原文\r\n",
  form: { title: "未保存文章", body: "编辑正文" },
  article: null,
  openedSha: null,
  savedForm: "baseline",
}
test("local trash preserves the full recovery and expires exactly after thirty days", () => {
  const store = storage(),
    now = 10000,
    row = trashLocalRecovery(store, recovery, now)
  assert.deepEqual(listLocalTrash(store, now)[0].recovery, recovery)
  assert.equal(row.expiresAt, now + 30 * 86400000)
  assert.equal(listLocalTrash(store, row.expiresAt - 1).length, 1)
  assert.deepEqual(listLocalTrash(store, row.expiresAt), [])
})
test("removing one local trash record retains unrelated drafts", () => {
  const store = storage(),
    a = trashLocalRecovery(store, recovery),
    b = trashLocalRecovery(store, { ...recovery, id: "other" })
  removeLocalTrash(store, a.id)
  assert.deepEqual(
    listLocalTrash(store).map((row) => row.id),
    [b.id],
  )
})
test("unavailable and full storage fail before callers discard the editor", () => {
  assert.throws(() => trashLocalRecovery(null, recovery), /下载正文/)
  assert.throws(
    () =>
      trashLocalRecovery(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota")
          },
        },
        recovery,
      ),
    /quota/,
  )
})
