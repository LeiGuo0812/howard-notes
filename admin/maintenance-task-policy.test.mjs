import assert from "node:assert/strict"
import test from "node:test"
import { keepMaintenanceTaskWindowOpen } from "./maintenance-task-policy.mjs"

test("recycle-bin purges and restores preserve the panel regardless of storage scope or batch size", () => {
  for (const kind of ["purge", "restore"])
    for (const scope of ["local", "draft", "private", "published"])
      for (const count of [1, 20])
        assert.equal(keepMaintenanceTaskWindowOpen({ kind, scope, panel: "trash", count }), true)
})

test("ordinary article deletion, publication and editor restoration keep their existing dismissal behavior", () => {
  for (const kind of ["article", "draft", "settings", "delete", "unpublish", "restore", "purge"])
    for (const panel of [undefined, "articles", "editor", "settings"])
      assert.equal(keepMaintenanceTaskWindowOpen({ kind, scope: "private", panel }), false)
  assert.equal(keepMaintenanceTaskWindowOpen(undefined), false)
  assert.equal(keepMaintenanceTaskWindowOpen({ kind: "delete", panel: "trash" }), false)
})

test("a retained task remains attributable to its submitted panel after unrelated view changes", () => {
  const task = Object.freeze({ kind: "purge", panel: "trash", scope: "draft" })
  assert.equal(keepMaintenanceTaskWindowOpen(task), true)
  assert.deepEqual(task, { kind: "purge", panel: "trash", scope: "draft" })
})
