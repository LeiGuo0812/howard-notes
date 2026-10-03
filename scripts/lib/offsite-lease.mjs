import { randomUUID } from "node:crypto"

export const BACKUP_LOCK_REF = "refs/heads/hn-offsite-lock"
const FORMAT = "howard-notes-backup-lease-v1"
const LOCK_TREE = "6383990d637ff935dec0ac38af86ba65db80d020"
const LOCK_NOTICE =
  "This branch coordinates Howard Notes offsite backups. Do not delete or force-push.\n"
const TTL = 2 * 60 * 60_000
const SAFETY = 5 * 60_000
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value)

export class BackupLeaseError extends Error {
  constructor(code) {
    super(
      code === "LEASE_BUSY"
        ? "Another backup or cleanup owns the private-repository lease; retry later."
        : "Private backup lease is unavailable or lost; no further publication or cleanup is allowed.",
    )
    this.name = "BackupLeaseError"
    this.code = code
  }
}
const fail = (code = "LEASE_LOST") => {
  throw new BackupLeaseError(code)
}

/** All participating writers share a remote fast-forward-only ref. No deletion
 * or forced updates: two children of the same previous head cannot both win. */
export class GitHubBackupLease {
  constructor(repository, api, { clock = Date.now, owner = randomUUID() } = {}) {
    this.repository = repository
    this.api = api
    this.clock = clock
    this.owner = owner
    this.current = null
  }
  async read() {
    let ref
    try {
      ref = await this.api(`repos/${this.repository}/git/ref/heads/hn-offsite-lock`)
    } catch (error) {
      if (error.status === 404) return null
      throw error
    }
    if (ref?.ref !== BACKUP_LOCK_REF || !sha(ref.object?.sha)) fail()
    const commit = await this.api(`repos/${this.repository}/git/commits/${ref.object.sha}`)
    let metadata
    try {
      metadata = JSON.parse(commit.message)
    } catch {
      fail()
    }
    if (
      commit.tree?.sha !== LOCK_TREE ||
      metadata.format !== FORMAT ||
      typeof metadata.owner !== "string" ||
      !metadata.owner ||
      !["held", "released"].includes(metadata.state) ||
      !Number.isSafeInteger(metadata.expiresAt)
    )
      fail()
    return { sha: ref.object.sha, metadata }
  }
  async transition(previous, metadata) {
    // GitHub rejects empty tree creation. Use one fixed notice with a verified
    // tree hash; no application files, handoff material or credentials enter it.
    const tree = await this.api(`repos/${this.repository}/git/trees`, {
      method: "POST",
      body: { tree: [{ path: "README.md", mode: "100644", type: "blob", content: LOCK_NOTICE }] },
    })
    if (tree?.sha !== LOCK_TREE) fail()
    const commit = await this.api(`repos/${this.repository}/git/commits`, {
      method: "POST",
      body: {
        message: JSON.stringify(metadata),
        tree: LOCK_TREE,
        parents: previous ? [previous.sha] : [],
      },
    })
    if (!sha(commit?.sha)) fail()
    let acknowledgementError
    try {
      if (previous)
        await this.api(`repos/${this.repository}/git/refs/heads/hn-offsite-lock`, {
          method: "PATCH",
          body: { sha: commit.sha, force: false },
        })
      else
        await this.api(`repos/${this.repository}/git/refs`, {
          method: "POST",
          body: { ref: BACKUP_LOCK_REF, sha: commit.sha },
        })
    } catch (error) {
      acknowledgementError = error
    }
    // A timed-out response is not proof that a conditional write failed. Re-read
    // the exact commit and owner before deciding whether this process owns it.
    const actual = await this.read()
    if (
      actual?.sha === commit.sha &&
      actual.metadata.owner === this.owner &&
      actual.metadata.state === metadata.state
    )
      return actual
    if (acknowledgementError && ![409, 422].includes(acknowledgementError.status)) fail()
    fail("LEASE_BUSY")
  }
  async acquire() {
    const previous = await this.read(),
      now = this.clock()
    if (previous?.metadata.state === "held" && previous.metadata.expiresAt > now) fail("LEASE_BUSY")
    const metadata = { format: FORMAT, owner: this.owner, state: "held", expiresAt: now + TTL }
    this.current = await this.transition(previous, metadata)
    await this.assert()
    return { expiresAt: metadata.expiresAt }
  }
  async assert() {
    if (!this.current) fail()
    const actual = await this.read()
    if (
      actual?.sha !== this.current.sha ||
      actual.metadata.owner !== this.owner ||
      actual.metadata.state !== "held" ||
      actual.metadata.expiresAt - this.clock() < SAFETY
    )
      fail()
    return true
  }
  async release() {
    if (!this.current) return false
    const actual = await this.read()
    if (
      actual?.sha !== this.current.sha ||
      actual.metadata.owner !== this.owner ||
      actual.metadata.state !== "held" ||
      actual.metadata.expiresAt <= this.clock()
    ) {
      this.current = null
      return false
    }
    await this.transition(actual, {
      format: FORMAT,
      owner: this.owner,
      state: "released",
      expiresAt: this.clock(),
    })
    this.current = null
    return true
  }
}
