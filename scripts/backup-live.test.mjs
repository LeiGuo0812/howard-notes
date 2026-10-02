import test from "node:test"
import assert from "node:assert/strict"
import { captureLiveBackup } from "./lib/backup-live.mjs"

test("live capture starts once, resumes existing work and pins the newly completed snapshot", async () => {
  const actions = []
  const states = [
    { configured: true, latest: { id: "old" }, checkedAt: "before" },
    { latest: { id: "old" }, progress: { id: "new", rows: 25, copiedTables: 1, totalTables: 10 } },
    { latest: { id: "old" }, progress: { id: "new", rows: 50, copiedTables: 2, totalTables: 10 } },
    { latest: { id: "new" }, progress: null },
  ]
  let clock = 0
  const result = await captureLiveBackup({
    request: async (route, body) => {
      if (route === "backups/status") return states.shift()
      actions.push(body.action)
      return { status: "accepted" }
    },
    clock: () => clock,
    wait: async () => {
      clock += 1500
    },
  })
  assert.equal(result.latest.id, "new")
  assert.deepEqual(actions, ["start", "continue", "continue"])
})
test("stalled accepted execution times out without repeatedly forcing a new backup", async () => {
  let calls = 0,
    clock = 0
  await assert.rejects(
    captureLiveBackup({
      request: async (route) => {
        if (route === "backups/run") {
          calls++
          return { status: "accepted" }
        }
        return { configured: true, latest: { id: "previous" }, progress: null }
      },
      clock: () => clock,
      wait: async () => {
        clock += 100
      },
      timeout: 300,
    }),
    /did not complete in time/,
  )
  assert.equal(calls, 1)
})
test("a changed failed snapshot stops capture without another mutation or source-body logging", async () => {
  const initial = { configured: true, latest: { id: "old" }, checkedAt: "a" }
  let reads = 0,
    writes = 0
  await assert.rejects(
    captureLiveBackup({
      request: async (route) => {
        if (route === "backups/run") {
          writes++
          return { status: "accepted" }
        }
        return reads++ === 0
          ? initial
          : {
              ...initial,
              checkedAt: "b",
              error: "private internal detail not forwarded",
            }
      },
      wait: async () => {},
    }),
    (error) =>
      /stopped before completion/.test(error.message) &&
      !error.message.includes("private internal"),
  )
  assert.equal(writes, 1)
})
