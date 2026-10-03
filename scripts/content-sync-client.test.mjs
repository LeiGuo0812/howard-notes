import assert from "node:assert/strict"
import test from "node:test"
import { needsDailyRefresh, synchronizeContent } from "./lib/content-sync-client.mjs"
const now = new Date("2026-10-03T01:00:00Z")
const blogData = { activity: { periods: [{ id: "recent", asOf: "2026-10-03" }] } }
const base = { revision: 3, commit: "old" }
const prepared = {
  chunks: [{ pages: [{ path: "index", html: "fresh" }] }],
  metadata: [],
  summary: { changedPages: 1 },
}

test("daily refresh compares Shanghai activity date rather than Git commit alone", () => {
  assert.equal(needsDailyRefresh(blogData, now), false)
  assert.equal(needsDailyRefresh(blogData, new Date("2026-10-03T16:00:00Z")), true)
})

test("same commit skips only when the activity calendar is current", async () => {
  const calls = []
  const result = await synchronizeContent({
    commit: "new",
    now,
    request: async (route) => {
      calls.push(route)
      return route === "status" ? { ...base, commit: "new" } : blogData
    },
    prepare: () => assert.fail("must not render"),
  })
  assert.equal(result.unchanged, true)
  assert.deepEqual(calls, ["status", "blogData"])
})

test("same commit on next Shanghai day forces a bounded synchronization", async () => {
  const calls = []
  const result = await synchronizeContent({
    commit: "new",
    now: new Date("2026-10-03T16:00:00Z"),
    request: async (route, body) => {
      calls.push([route, body])
      if (route === "status" || route === "snapshot") return { ...base, commit: "new" }
      if (route === "blogData") return blogData
      if (route === "sync/begin") return { syncId: "a", revision: 4, currentCommit: "new" }
      if (route === "sync/finish") return { status: "synchronized", commit: "new", revision: 4 }
      return {}
    },
    prepare: async () => prepared,
  })
  assert.equal(calls.find(([route]) => route === "sync/begin")[1].force, true)
  assert.equal(result.changedPages, 1)
})

test("a competing publication after begin never uploads a stale diff and retries from a fresh base", async () => {
  let begins = 0,
    renders = 0
  const uploaded = []
  const result = await synchronizeContent({
    commit: "new",
    now,
    wait: async () => {},
    request: async (route, body) => {
      if (route === "sync/begin") {
        begins++
        return {
          syncId: `s${begins}`,
          revision: begins + 3,
          currentCommit: begins === 1 ? "old" : "competitor",
        }
      }
      if (route === "status" || route === "snapshot")
        return begins ? { revision: 4, commit: "competitor" } : base
      if (route === "sync/chunk") uploaded.push(body.syncId)
      if (route === "sync/finish") return { status: "synchronized", commit: "new", revision: 5 }
      return {}
    },
    prepare: async ({ previous }) => {
      renders++
      assert.equal(previous.commit, "competitor")
      return prepared
    },
  })
  assert.equal(result.revision, 5)
  assert.equal(begins, 2)
  assert.equal(renders, 1)
  assert.deepEqual(uploaded, ["s2"])
})

test("repeated conflicts stop after three attempts and other errors do not retry", async () => {
  for (const status of [409, 401]) {
    let calls = 0
    await assert.rejects(
      synchronizeContent({
        commit: "new",
        request: async () => {
          calls++
          throw Object.assign(new Error("fail"), { status })
        },
        wait: async () => {},
        prepare: () => prepared,
      }),
      /fail/,
    )
    assert.equal(calls, status === 409 ? 3 : 1)
  }
})
