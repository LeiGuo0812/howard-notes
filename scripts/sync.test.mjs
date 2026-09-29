import test from "node:test"
import assert from "node:assert/strict"
import { planSync } from "./lib/sync-plan.mjs"
const files = (object) =>
  new Map(Object.entries(object).map(([name, value]) => [name, Buffer.from(value)]))
test("one-way edits and additions merge in both directions without changing original bytes", () => {
  const base = files({ a: "old\r\n", b: "old b" })
  const local = files({ a: "local\r\n", b: "old b", c: "new local" })
  const remote = files({ a: "old\r\n", b: "remote b", d: "new remote" })
  const result = planSync(base, local, remote)
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.merged.get("a").toString(), "local\r\n")
  assert.equal(result.merged.get("b").toString(), "remote b")
  assert.equal(result.merged.size, 4)
})
test("conflicting edits do not choose a winner", () => {
  const result = planSync(files({ a: "base" }), files({ a: "local" }), files({ a: "remote" }))
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.merged.has("a"), false)
})
test("concurrent identical edits are safe", () => {
  const result = planSync(files({ a: "base" }), files({ a: "same" }), files({ a: "same" }))
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.merged.get("a").toString(), "same")
})
test("deletion needs explicit opt-in and deletion versus edit is always a conflict", () => {
  assert.equal(planSync(files({ a: "" }), files({}), files({ a: "" })).conflicts.length, 1)
  const allowed = planSync(files({ a: "" }), files({}), files({ a: "" }), { allowDelete: true })
  assert.equal(allowed.conflicts.length, 0)
  assert.equal(allowed.merged.size, 0)
  assert.equal(
    planSync(files({ a: "old" }), files({}), files({ a: "new" }), { allowDelete: true }).conflicts
      .length,
    1,
  )
})
test("initial empty mirror accepts remote files without treating them as deletions", () => {
  const result = planSync(files({}), files({}), files({ "notes/a.md": "原文\r\n" }))
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.merged.get("notes/a.md").toString(), "原文\r\n")
})
