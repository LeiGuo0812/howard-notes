import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { GitHubBackupLease, BACKUP_LOCK_REF } from "./lib/offsite-lease.mjs"
import { GitHubBackupStore, FORMAT } from "./lib/offsite-backup.mjs"

const LOCK_TREE = "6383990d637ff935dec0ac38af86ba65db80d020"
function github() {
  let head = null,
    sequence = 0,
    lostAck = false
  const commits = new Map(),
    writes = []
  const error = (status) => Object.assign(new Error("synthetic"), { status })
  return {
    get head() {
      return head
    },
    commits,
    writes,
    loseAcknowledgement() {
      lostAck = true
    },
    async api(endpoint, { method = "GET", body } = {}) {
      if (method === "GET" && endpoint.endsWith("/git/ref/heads/hn-offsite-lock")) {
        if (!head) throw error(404)
        return { ref: BACKUP_LOCK_REF, object: { sha: head } }
      }
      if (method === "GET" && endpoint.includes("/git/commits/"))
        return commits.get(endpoint.split("/").at(-1))
      if (method === "POST" && endpoint.endsWith("/git/trees")) {
        assert.equal(body.tree.length, 1, "GitHub rejects empty trees")
        const item = body.tree[0]
        assert.equal(item.path, "README.md")
        assert.equal(item.mode, "100644")
        assert.equal(item.type, "blob")
        const data = Buffer.from(item.content)
        const blob = createHash("sha1").update(`blob ${data.length}\0`).update(data).digest()
        const tree = Buffer.concat([Buffer.from("100644 README.md\0"), blob])
        assert.equal(
          createHash("sha1").update(`tree ${tree.length}\0`).update(tree).digest("hex"),
          LOCK_TREE,
        )
        return { sha: LOCK_TREE }
      }
      if (method === "POST" && endpoint.endsWith("/git/commits")) {
        const sha = (++sequence).toString(16).padStart(40, "0")
        commits.set(sha, { message: body.message, tree: { sha: body.tree }, parents: body.parents })
        return { sha }
      }
      if (method === "POST" && endpoint.endsWith("/git/refs")) {
        assert.equal(body.ref, BACKUP_LOCK_REF)
        if (head) throw error(422)
        head = body.sha
      } else if (method === "PATCH" && endpoint.endsWith("/git/refs/heads/hn-offsite-lock")) {
        assert.equal(body.force, false)
        if (commits.get(body.sha)?.parents[0] !== head) throw error(422)
        head = body.sha
      } else throw Error(`unexpected synthetic operation ${method} ${endpoint}`)
      writes.push({ method, head })
      if (lostAck) {
        lostAck = false
        throw error(503)
      }
      return { ref: BACKUP_LOCK_REF, object: { sha: head } }
    },
  }
}

test("two simultaneous first writers cannot both own the remote backup lease", async () => {
  const remote = github(),
    first = new GitHubBackupLease("owner/backup", remote.api, { owner: "first" }),
    second = new GitHubBackupLease("owner/backup", remote.api, { owner: "second" })
  const result = await Promise.allSettled([first.acquire(), second.acquire()])
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1)
  assert.equal(result.find((item) => item.status === "rejected").reason.code, "LEASE_BUSY")
  assert.equal(remote.writes.length, 1)
})

test("expired takeovers are conditional fast-forwards; stale owner cannot publish or release a successor", async () => {
  let now = Date.parse("2026-10-04T00:00:00Z")
  const remote = github(),
    clock = () => now
  const old = new GitHubBackupLease("owner/backup", remote.api, { clock, owner: "old" })
  await old.acquire()
  now += 2 * 60 * 60_000 + 1
  const next = new GitHubBackupLease("owner/backup", remote.api, { clock, owner: "next" }),
    competitor = new GitHubBackupLease("owner/backup", remote.api, { clock, owner: "competitor" })
  const result = await Promise.allSettled([next.acquire(), competitor.acquire()])
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1)
  await assert.rejects(old.assert(), { code: "LEASE_LOST" })
  const head = remote.head
  assert.equal(await old.release(), false)
  assert.equal(remote.head, head)
})

test("lost write acknowledgements are reconciled by commit and owner; release keeps a monotonic ref", async () => {
  const remote = github(),
    lease = new GitHubBackupLease("owner/backup", remote.api, { owner: "owner" })
  remote.loseAcknowledgement()
  await lease.acquire()
  assert.equal(await lease.assert(), true)
  const owned = remote.head
  remote.loseAcknowledgement()
  assert.equal(await lease.release(), true)
  assert.notEqual(remote.head, owned)
  assert.deepEqual(remote.commits.get(remote.head).parents, [owned])
  assert.equal(JSON.parse(remote.commits.get(remote.head).message).state, "released")
  assert.equal(await lease.release(), false)
})

test("lease stops mutations before expiry with time reserved for bounded API writes", async () => {
  let now = 0
  const remote = github(),
    lease = new GitHubBackupLease("owner/backup", remote.api, { clock: () => now })
  await lease.acquire()
  now = 2 * 60 * 60_000 - 4 * 60_000
  await assert.rejects(lease.assert(), { code: "LEASE_LOST" })
})

test("publication and cleanup require a lease; a writer appearing after the final reference scan is excluded", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lease-retention-test-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const remote = github(),
    now = Date.now(),
    hash = (value) => createHash("sha256").update(value).digest("hex")
  const make = (kind, value, id) => {
    const tag =
      kind === "archive"
        ? `hn-offsite-archive-howard-notes-${hash(value).slice(0, 32)}`
        : `hn-offsite-snapshot-2026-10-04-${hash(value).slice(0, 24)}`
    return {
      id,
      tag_name: tag,
      draft: false,
      published_at: new Date(now - 60 * 86400000).toISOString(),
      assets: [{ size: 100 }],
      body: JSON.stringify({
        format: FORMAT,
        kind,
        tag,
        identity: hash(value),
        state: "verified",
        completedAt: new Date(now).toISOString(),
        unreferencedSince: new Date(now - 60 * 86400000).toISOString(),
      }),
    }
  }
  const snapshot = make("snapshot", "current", 1),
    archive = make("archive", "old", 2)
  const cleaner = new GitHubBackupStore("owner/backup", directory),
    writer = new GitHubBackupStore("owner/backup", directory)
  let scans = 0,
    excluded = false,
    deletions = 0
  for (const store of [cleaner, writer])
    store.api = async (endpoint, options) => {
      if (endpoint.includes("/git/") && !endpoint.includes("/tags/"))
        return remote.api(endpoint, options)
      if (options?.method === "DELETE") {
        deletions++
        return null
      }
      throw Error("unexpected release mutation")
    }
  await assert.rejects(cleaner.prune(now, { archiveCleanup: "apply" }), { code: "LEASE_LOST" })
  await assert.rejects(writer.publish({}, []), { code: "LEASE_LOST" })
  await cleaner.acquireLease()
  cleaner.listReleases = async () => {
    scans++
    return [snapshot, archive]
  }
  cleaner.complete = async () => {
    if (scans === 2) {
      await assert.rejects(writer.acquireLease(), { code: "LEASE_BUSY" })
      excluded = true
    }
    return { manifest: { archives: [] } }
  }
  const result = await cleaner.prune(now, { archiveCleanup: "apply" })
  assert.equal(excluded, true)
  assert.equal(result.removedArchives, 1)
  assert.equal(deletions, 2)
  await cleaner.releaseLease()
  await writer.acquireLease()
  // Once publication owns the lease, cleanup cannot even begin a stale scan.
  await assert.rejects(cleaner.prune(now, { archiveCleanup: "apply" }), { code: "LEASE_LOST" })
  await writer.releaseLease()
})
