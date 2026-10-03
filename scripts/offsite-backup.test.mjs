import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  FORMAT,
  TRUSTED_SITE_BASE,
  MAX_ASSET_BYTES,
  validateConfiguration,
  assertPrivateRepository,
  latestSnapshot,
  assertRelativePath,
  sourceIdentity,
  parseRemoteRefs,
  retentionPlan,
  fileInfo,
  verifyFile,
  BackupBundleValidator,
  fetchBackupStatus,
  downloadContentBackup,
  createHandoffTar,
  GitHubBackupStore,
  parseOwnedRelease,
  parseGitHubPages,
  validateBackupManifest,
  sourceArchive,
  command,
  runOffsiteBackup,
  stageHandoffMaterials,
} from "./lib/offsite-backup.mjs"

const sha = (value) => createHash("sha256").update(value).digest("hex")
const now = Date.parse("2026-10-04T12:00:00Z")
const snapshot = "2026-10-04T10-00-00-000Z-aabbccdd"
const secret = "synthetic-scope-key-only-for-test-0000000000000"
const config = {
  version: 1,
  siteBase: TRUSTED_SITE_BASE,
  sourceRepositories: ["LeiGuo0812/howard-notes", "LeiGuo0812/pic_cloud_gl"],
  handoffDirectory: "handoff",
  retention: { dailyDays: 30, monthlyMonths: 12 },
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offsite-test-"))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}
function status(completedAt = "2026-10-04T10:00:00Z") {
  return {
    configured: true,
    latest: {
      id: snapshot,
      createdAt: completedAt,
      completedAt,
      rows: 4,
      tables: 10,
      privateFiles: 0,
    },
  }
}
function bundle(id = snapshot, records = [{ key: `snapshots/${id}/manifest.hnbackup`, size: 32 }]) {
  const output = [
    Buffer.from(JSON.stringify({ format: "howard-notes-backup-bundle-v2", snapshot: id }) + "\n"),
  ]
  for (const record of records) {
    const header = Buffer.from(JSON.stringify(record)),
      length = Buffer.alloc(4)
    length.writeUInt32BE(header.length)
    output.push(length, header, Buffer.alloc(record.size, 42))
  }
  return Buffer.concat(output)
}
async function validateBundle(bytes, id = snapshot) {
  const validator = new BackupBundleValidator(id)
  await pipeline(
    Readable.from([...bytes].map((byte) => Buffer.from([byte]))),
    validator,
    new TransformSink(),
  )
  return validator
}
class TransformSink extends (await import("node:stream")).Writable {
  _write(_chunk, _encoding, callback) {
    callback()
  }
}

test("configuration limits sources, HTTPS and safe materials paths", () => {
  assert.equal(validateConfiguration(config).sourceRepositories.length, 2)
  for (const patch of [
    { siteBase: "http://notes.example/" },
    { siteBase: "https://notes.example/howard-notes/" },
    { siteBase: "https://howard-notes.howard-notes-login.workers.dev/other/" },
    { siteBase: "https://token:secret@notes.example/" },
    { siteBase: "https://notes.example/?token=secret" },
    { siteBase: "https://notes.example/#secret" },
    { sourceRepositories: ["attacker/private"] },
    { sourceRepositories: [config.sourceRepositories[0], config.sourceRepositories[0]] },
    { handoffDirectory: "../secrets" },
    { retention: { dailyDays: 1, monthlyMonths: 12 } },
  ])
    assert.throws(() => validateConfiguration({ ...config, ...patch }))
  for (const value of ["../key", "/etc/passwd", "C:/private", "a\\b", "a/./b", "a//b", "a\nkey"])
    assert.throws(() => assertRelativePath(value), { code: "PATH" })
})
test("destination must be explicitly private and match the requested repository", () => {
  assertPrivateRepository({ private: true, full_name: "owner/backup" }, "owner/backup")
  for (const meta of [
    { private: false, full_name: "owner/backup" },
    { full_name: "owner/backup" },
    { private: true, full_name: "other/backup" },
    { private: true, full_name: "owner/backup", archived: true },
  ])
    assert.throws(() => assertPrivateRepository(meta, "owner/backup"), {
      code: "PRIVATE_REPOSITORY",
    })
})
test("latest completed snapshot freshness fails closed at 48 hours", () => {
  assert.equal(latestSnapshot(status(), now).id, snapshot)
  assert.equal(
    latestSnapshot(status(new Date(now - 48 * 60 * 60_000).toISOString()), now).id,
    snapshot,
  )
  assert.throws(
    () => latestSnapshot(status(new Date(now - 48 * 60 * 60_000 - 1).toISOString()), now),
    { code: "STALE" },
  )
  for (const value of [
    { configured: false, latest: status().latest },
    { configured: true, latest: { id: "../private", completedAt: status().latest.completedAt } },
    status("not-a-date"),
    status(new Date(now + 6 * 60_000).toISOString()),
  ])
    assert.throws(() => latestSnapshot(value, now), { code: "STATUS" })
})
test("scoped status request has no owner token, cookie, body or redirects", async () => {
  let request
  const latest = await fetchBackupStatus(config.siteBase, secret, {
    now,
    fetcher: async (url, options) => {
      request = { url: String(url), options }
      return Response.json(status())
    },
  })
  assert.equal(latest.id, snapshot)
  assert.equal(request.url, new URL("api/content/backups/export/status", TRUSTED_SITE_BASE).href)
  assert.deepEqual(request.options.headers, { "X-Howard-Backup-Key": secret })
  assert.equal(request.options.redirect, "error")
  assert.equal(request.options.credentials, "omit")
  assert.equal(request.options.method, "GET")
  assert.equal(request.options.body, undefined)
  await assert.rejects(
    fetchBackupStatus(config.siteBase, secret, {
      fetcher: async () =>
        new Response(null, { status: 302, headers: { Location: "https://attacker.invalid" } }),
    }),
    { code: "REDIRECT" },
  )
  let called = false
  await assert.rejects(
    fetchBackupStatus("http://notes.example/", secret, {
      fetcher: async () => {
        called = true
        return Response.json(status())
      },
    }),
    { code: "CONFIG" },
  )
  assert.equal(called, false)
  await assert.rejects(
    fetchBackupStatus("https://attacker.invalid/howard-notes/", secret, {
      fetcher: async () => {
        called = true
        return Response.json(status())
      },
    }),
    { code: "CONFIG" },
  )
  assert.equal(called, false)
})
test("encrypted framing validation handles single-byte chunks without decrypting", async () => {
  const input = bundle(snapshot, [
    { key: `snapshots/${snapshot}/manifest.hnbackup`, size: 32 },
    { key: `snapshots/${snapshot}/000000.hnbackup`, size: 64 },
    { key: `objects/${"a".repeat(64)}/manifest.hnbackup`, size: 40 },
  ])
  const result = await validateBundle(input)
  assert.equal(result.seen.size, 3)
  assert.equal(result.bytes, input.length)
})
test("bundle rejects wrong snapshot, traversal, duplicate objects and truncation", async () => {
  await assert.rejects(validateBundle(bundle("2026-10-04T10-00-00-000Z-deadbeef")), {
    code: "FRAMING",
  })
  for (const key of [
    "../private",
    "snapshots/elsewhere/manifest.hnbackup",
    `snapshots/${snapshot}/../manifest.hnbackup`,
    `objects/${"a".repeat(64)}/../../private`,
  ])
    await assert.rejects(validateBundle(bundle(snapshot, [{ key, size: 32 }])), { code: "FRAMING" })
  await assert.rejects(
    validateBundle(
      bundle(snapshot, [
        { key: `snapshots/${snapshot}/manifest.hnbackup`, size: 32 },
        { key: `snapshots/${snapshot}/manifest.hnbackup`, size: 32 },
      ]),
    ),
    { code: "FRAMING" },
  )
  await assert.rejects(validateBundle(bundle().subarray(0, -1)), { code: "FRAMING" })
  await assert.rejects(validateBundle(Buffer.from("<!DOCTYPE html>")), { code: "FRAMING" })
})
test("content download writes mode600 and records framing/hash without claiming AES authentication", async (t) => {
  const dir = await temporary(t),
    file = path.join(dir, "content.hnbackup"),
    input = bundle()
  let request
  const result = await downloadContentBackup(config.siteBase, secret, snapshot, file, {
    fetcher: async (url, options) => {
      request = { url: String(url), options }
      return new Response(input, { headers: { "Content-Length": String(input.length) } })
    },
  })
  assert.equal(result.sha256, sha(input))
  assert.equal(result.bytes, input.length)
  assert.equal(result.framingVerified, true)
  assert.equal(result.ciphertextAuthenticated, false)
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  assert.equal(new URL(request.url).searchParams.get("id"), snapshot)
  assert.equal(request.options.headers.Authorization, undefined)
})
test("bad content download removes partial files and preserves unrelated earlier backups", async (t) => {
  const dir = await temporary(t),
    previous = path.join(dir, "previous.hnbackup"),
    file = path.join(dir, "new.hnbackup")
  await fs.writeFile(previous, "unchanged")
  await assert.rejects(
    downloadContentBackup(config.siteBase, secret, snapshot, file, {
      fetcher: async () => new Response(bundle().subarray(0, -1)),
    }),
    { code: "FRAMING" },
  )
  await assert.rejects(fs.stat(file), { code: "ENOENT" })
  assert.equal(await fs.readFile(previous, "utf8"), "unchanged")
  await assert.rejects(
    downloadContentBackup(config.siteBase, secret, snapshot, file, {
      fetcher: async () =>
        new Response(bundle(), { headers: { "Content-Length": String(MAX_ASSET_BYTES + 1) } }),
    }),
    { code: "SIZE" },
  )
})
test("HTTP failure or existing output path cannot remove an earlier backup file", async (t) => {
  const dir = await temporary(t),
    file = path.join(dir, "content.hnbackup")
  await fs.writeFile(file, "existing backup")
  await assert.rejects(
    downloadContentBackup(config.siteBase, secret, snapshot, file, {
      fetcher: async () => new Response("error", { status: 503 }),
    }),
    { code: "HTTP" },
  )
  assert.equal(await fs.readFile(file, "utf8"), "existing backup")
  await assert.rejects(
    downloadContentBackup(config.siteBase, secret, snapshot, file, {
      fetcher: async () => new Response(bundle()),
    }),
    { code: "HTTP" },
  )
  assert.equal(await fs.readFile(file, "utf8"), "existing backup")
})
test("handoff tar is deterministic, supports Chinese paths and stores no absolute paths", async (t) => {
  const dir = await temporary(t),
    materials = path.join(dir, "handoff")
  await fs.mkdir(materials)
  await fs.writeFile(path.join(materials, "复现指南.md"), "私有交接资料，合成测试。")
  await fs.mkdir(path.join(materials, "nested"))
  await fs.writeFile(path.join(materials, "nested", "README.md"), "Recovery guide")
  const first = await createHandoffTar(materials, path.join(dir, "first.tar"))
  await fs.utimes(path.join(materials, "复现指南.md"), new Date(), new Date())
  const second = await createHandoffTar(materials, path.join(dir, "second.tar"))
  assert.equal(first.sha256, second.sha256)
  const bytes = await fs.readFile(path.join(dir, "first.tar"))
  assert.equal(bytes.includes(Buffer.from(materials)), false)
  assert.equal(bytes.includes(Buffer.from("handoff/复现指南.md")), true)
  const listing = await command("tar", ["-tf", path.join(dir, "first.tar")])
  assert.equal(listing.includes("handoff/复现指南.md"), true)
  assert.equal((await fs.stat(path.join(dir, "first.tar"))).mode & 0o777, 0o600)
})
test("handoff traversal, symlinks and hardlinks are rejected before uploading", async (t) => {
  const dir = await temporary(t),
    materials = path.join(dir, "handoff")
  await fs.mkdir(materials)
  const original = path.join(dir, "secret"),
    link = path.join(materials, "link")
  await fs.writeFile(original, "test only")
  await fs.symlink(original, link)
  await assert.rejects(createHandoffTar(materials, path.join(dir, "symlink.tar")), { code: "PATH" })
  await fs.rm(link)
  await fs.link(original, link)
  await assert.rejects(createHandoffTar(materials, path.join(dir, "hardlink.tar")), {
    code: "PATH",
  })
  await fs.rm(link)
  await fs.writeFile(path.join(materials, "bad\\name"), "bad")
  await assert.rejects(createHandoffTar(materials, path.join(dir, "badpath.tar")), { code: "PATH" })
})
test("complete refs identity changes for branches and tags even with unchanged main", () => {
  const main = "a".repeat(40),
    extra = "b".repeat(40),
    refs = [
      { name: "refs/heads/main", sha: main },
      { name: "refs/heads/dev", sha: extra },
    ],
    head = { symbolicRef: "refs/heads/main", sha: main }
  const first = sourceIdentity(config.sourceRepositories[0], refs, head)
  assert.notEqual(
    first.refsSha256,
    sourceIdentity(
      config.sourceRepositories[0],
      [refs[0], { ...refs[1], sha: "c".repeat(40) }],
      head,
    ).refsSha256,
  )
  assert.notEqual(
    first.refsSha256,
    sourceIdentity(
      config.sourceRepositories[0],
      [...refs, { name: "refs/tags/v1", sha: main }],
      head,
    ).refsSha256,
  )
  assert.equal(
    first.refsSha256,
    sourceIdentity(config.sourceRepositories[0], [...refs].reverse(), head).refsSha256,
  )
  const remote = `ref: refs/heads/main\tHEAD\n${main}\tHEAD\n${main}\trefs/heads/main\n${extra}\trefs/heads/dev\n`
  assert.equal(parseRemoteRefs(remote, config.sourceRepositories[0]).refsSha256, first.refsSha256)
})
test("retention keeps all recent copies plus latest per month, ignoring foreign and incomplete releases", () => {
  const releases = []
  for (let day = 0; day < 70; day++) {
    const time = now - day * 86_400_000,
      identity = sha(String(day))
    releases.push({
      tag: `hn-offsite-snapshot-${new Date(time).toISOString().slice(0, 10)}-${identity.slice(0, 24)}`,
      identity,
      completedAt: new Date(time).toISOString(),
      complete: true,
    })
  }
  const foreign = {
      tag: "manual-important-backup",
      identity: sha("foreign"),
      completedAt: "2020-01-01T00:00:00Z",
      complete: true,
    },
    incomplete = {
      ...releases.at(-1),
      tag: `hn-offsite-snapshot-2020-01-01-${sha("incomplete").slice(0, 24)}`,
      completedAt: "2020-01-01T00:00:00Z",
      complete: false,
    },
    archive = { ...foreign, tag: `hn-offsite-archive-howard-notes-${sha("archive").slice(0, 32)}` }
  const plan = retentionPlan([...releases, foreign, incomplete, archive], now)
  assert.equal(
    plan.keep.filter((r) => Date.parse(r.completedAt) >= now - 30 * 86_400_000).length,
    31,
  )
  assert.ok(plan.keep.some((r) => r.completedAt.startsWith("2026-08")))
  assert.ok(plan.remove.length > 0)
  assert.ok(
    !plan.remove.includes(foreign) &&
      !plan.remove.includes(incomplete) &&
      !plan.remove.includes(archive),
  )
})
test("monthly retention keeps the latest 12 successful months across gaps", () => {
  const dates = [
    "2026-10-01",
    "2026-07-01",
    "2026-04-01",
    "2026-01-01",
    "2025-10-01",
    "2025-07-01",
    "2025-04-01",
    "2025-01-01",
    "2024-10-01",
    "2024-07-01",
    "2024-04-01",
    "2024-01-01",
    "2023-10-01",
  ]
  const records = dates.map((date) => {
    const identity = sha(date)
    return {
      tag: `hn-offsite-snapshot-${date}-${identity.slice(0, 24)}`,
      identity,
      completedAt: `${date}T10:00:00Z`,
      complete: true,
    }
  })
  const newer = {
    ...records[1],
    tag: `hn-offsite-snapshot-2026-07-02-${sha("newer").slice(0, 24)}`,
    identity: sha("newer"),
    completedAt: "2026-07-02T10:00:00Z",
  }
  const future = {
    ...records[0],
    tag: `hn-offsite-snapshot-2026-11-01-${sha("future").slice(0, 24)}`,
    identity: sha("future"),
    completedAt: "2026-11-01T10:00:00Z",
  }
  const plan = retentionPlan([...records, newer, future], now)
  assert.equal(plan.keep.filter((record) => Date.parse(record.completedAt) <= now).length, 12)
  assert.equal(plan.keep.includes(newer), true)
  assert.equal(plan.keep.includes(records[1]), false)
  assert.equal(plan.keep.includes(records[11]), true)
  assert.equal(plan.keep.includes(records[12]), false)
  assert.equal(plan.keep.includes(future), true)
})

async function snapshotFixture(dir, completedAt = "2026-10-04T10:00:00Z") {
  const content = path.join(dir, "content.hnbackup"),
    handoff = path.join(dir, "handoff.tar"),
    manifestFile = path.join(dir, "manifest.json")
  await fs.writeFile(content, bundle(), { mode: 0o600 })
  await fs.writeFile(handoff, "synthetic handoff tar", { mode: 0o600 })
  const contentInfo = {
      ...(await fileInfo(content)),
      snapshot,
      framingVerified: true,
      ciphertextAuthenticated: false,
    },
    handoffInfo = await fileInfo(handoff)
  const source = sourceIdentity(
    config.sourceRepositories[0],
    [{ name: "refs/heads/main", sha: "a".repeat(40) }],
    { symbolicRef: "refs/heads/main", sha: "a".repeat(40) },
  )
  const archives = [
    {
      ...source,
      tag: `hn-offsite-archive-howard-notes-${source.refsSha256.slice(0, 32)}`,
      asset: { name: "archive.gitbundle", sha256: sha("bundle"), bytes: 123 },
    },
  ]
  const identity = sha(
    JSON.stringify({
      snapshot,
      contentSha256: contentInfo.sha256,
      handoffSha256: handoffInfo.sha256,
      archives: archives.map((archive) => ({
        repository: archive.repository,
        refsSha256: archive.refsSha256,
      })),
    }),
  )
  const tag = `hn-offsite-snapshot-${completedAt.slice(0, 10)}-${identity.slice(0, 24)}`
  const metadata = { kind: "snapshot", tag, identity, completedAt }
  const manifest = {
    format: FORMAT,
    kind: "snapshot",
    identity,
    snapshot: status(completedAt).latest,
    content: contentInfo,
    handoff: handoffInfo,
    archives,
  }
  await fs.writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 })
  const files = [content, handoff, manifestFile]
  const receipt = {
    format: FORMAT,
    kind: "snapshot",
    identity,
    verification: "github-roundtrip-sha256",
    verifiedAt: new Date(now).toISOString(),
    files: await Promise.all(files.map((file) => fileInfo(file))),
  }
  return { metadata, manifest, receipt, files }
}
function fakeGitHub(
  dir,
  { corrupt = false, privateDestination = true, initialRelease = null } = {},
) {
  const calls = [],
    assets = new Map()
  let next = 1,
    release = initialRelease
  const runner = async (program, args, options = {}) => {
    assert.equal(program, "gh")
    assert.equal(options.env?.GH_HOST, "github.com")
    calls.push({ args: [...args] })
    if (args[0] === "release" && args[1] === "upload") {
      const file = args.at(-1),
        bytes = await fs.readFile(file),
        name = path.basename(file),
        id = next++
      assets.set(id, bytes)
      release.assets.push({ id, name, size: bytes.length })
      return ""
    }
    const endpoint = args[1],
      method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET",
      body = args.includes("--input")
        ? JSON.parse(await fs.readFile(args[args.indexOf("--input") + 1], "utf8"))
        : null
    if (endpoint === "repos/owner/backup")
      return JSON.stringify({
        private: privateDestination,
        full_name: "owner/backup",
        default_branch: "main",
      })
    if (endpoint.includes("/releases/tags/")) {
      if (!release || release.draft) {
        const error = new Error("not found")
        error.status = 404
        throw error
      }
      return JSON.stringify(release)
    }
    if (endpoint === "repos/owner/backup/releases?per_page=100") {
      assert.equal(args.includes("--slurp"), false)
      return JSON.stringify(release ? [release] : [])
    }
    if (endpoint === "repos/owner/backup/releases" && method === "POST") {
      release = { ...body, id: 1, assets: [] }
      return JSON.stringify(release)
    }
    if (endpoint.startsWith("repos/owner/backup/releases/assets/")) {
      const id = Number(endpoint.split("/").at(-1)),
        input = assets.get(id)
      await fs.writeFile(options.outputFile, corrupt ? Buffer.alloc(input.length, 0) : input, {
        mode: 0o600,
        flag: "wx",
      })
      return { bytes: input.length }
    }
    if (endpoint === "repos/owner/backup/releases/1" && method === "GET")
      return JSON.stringify(release)
    if (endpoint === "repos/owner/backup/releases/1" && method === "PATCH") {
      Object.assign(release, body)
      return JSON.stringify(release)
    }
    if (endpoint === "repos/owner/backup/releases/1" && method === "DELETE") {
      release = null
      return ""
    }
    throw new Error("Unexpected mock operation")
  }
  const store = new GitHubBackupStore("owner/backup", dir, runner)
  // These fixtures exercise release integrity; lease races have their own real
  // conditional-ref simulator in offsite-lease.test.mjs.
  store.assertLease = async () => true
  return { runner, calls, release: () => release, store }
}
test("GitHub draft publishes only after every roundtrip SHA and final receipt verification", async (t) => {
  const dir = await temporary(t),
    fixture = await snapshotFixture(dir)
  const mock = fakeGitHub(dir)
  const value = await mock.store.publish(fixture.metadata, fixture.files)
  assert.equal(value.release.draft, false)
  assert.equal(
    (await mock.store.complete(value.release, fixture.metadata.identity)).manifest.kind,
    "snapshot",
  )
  const uploads = mock.calls.filter((c) => c.args[0] === "release")
  assert.equal(path.basename(uploads.at(-1).args.at(-1)), "receipt.json")
  const patch = mock.calls.findIndex((c) => c.args.includes("PATCH")),
    receiptUpload = mock.calls.findIndex(
      (c) => c.args[0] === "release" && c.args.at(-1).endsWith("receipt.json"),
    )
  assert.ok(patch > receiptUpload)
  assert.equal(
    mock.calls.slice(receiptUpload + 1, patch).some((c) => c.args[1].includes("/releases/assets/")),
    true,
  )
})
test("older gh paginated arrays are parsed with embedded strings and no --slurp", () => {
  const rows = [{ body: 'brackets ][ and escaped "words"\\ end', assets: [{ id: 1 }] }]
  assert.deepEqual(
    parseGitHubPages(JSON.stringify(rows) + "\n" + JSON.stringify([{ id: 2 }]) + "\n[]"),
    [...rows, { id: 2 }],
  )
  assert.deepEqual(parseGitHubPages("[]\n[]"), [])
  for (const text of ['[{"id":1}', "{}", "[] extra", "[1]", "[null]"])
    assert.throws(() => parseGitHubPages(text), { code: "COMMAND" })
})
test("failed owned draft retries after real REST tag 404 and list fallback", async (t) => {
  const dir = await temporary(t),
    fixture = await snapshotFixture(dir)
  const initialRelease = {
    id: 1,
    tag_name: fixture.metadata.tag,
    draft: true,
    assets: [],
    body: JSON.stringify({ ...fixture.metadata, format: FORMAT, state: "draft" }),
  }
  const mock = fakeGitHub(dir, { initialRelease })
  const result = await mock.store.publish(fixture.metadata, fixture.files)
  assert.equal(result.release.draft, false)
  const list = mock.calls.findIndex((call) => call.args[1].includes("?per_page=100"))
  const removal = mock.calls.findIndex((call) => call.args.includes("DELETE"))
  const post = mock.calls.findIndex((call) => call.args.includes("POST"))
  assert.ok(list >= 0 && removal > list && post > removal)
  const collisionDir = await temporary(t),
    otherFixture = await snapshotFixture(collisionDir)
  const foreign = fakeGitHub(collisionDir, {
    initialRelease: { ...initialRelease, body: "foreign draft" },
  })
  await assert.rejects(foreign.store.publish(otherFixture.metadata, otherFixture.files), {
    code: "RELEASE",
  })
  assert.equal(
    foreign.calls.some((call) => call.args.includes("DELETE") || call.args.includes("POST")),
    false,
  )
})
test("snapshot completeness rejects missing content or handoff and malformed source identities", async (t) => {
  const dir = await temporary(t),
    fixture = await snapshotFixture(dir)
  validateBackupManifest(fixture.metadata, fixture.manifest, fixture.receipt)
  for (const name of ["content.hnbackup", "handoff.tar", "manifest.json"]) {
    assert.throws(
      () =>
        validateBackupManifest(fixture.metadata, fixture.manifest, {
          ...fixture.receipt,
          files: fixture.receipt.files.filter((file) => file.name !== name),
        }),
      { code: "RELEASE" },
    )
  }
  for (const mutate of [
    (manifest) => {
      delete manifest.snapshot
    },
    (manifest) => {
      manifest.content.snapshot = "2026-10-04T10-00-00-000Z-deadbeef"
    },
    (manifest) => {
      manifest.kind = "archive"
    },
    (manifest) => {
      manifest.archives[0].refsSha256 = sha("wrong refs")
    },
    (manifest) => {
      manifest.archives[0].repository = "attacker/backup"
    },
    (manifest) => {
      manifest.handoff.sha256 = sha("wrong handoff")
    },
    (manifest) => {
      manifest.archives = []
    },
  ]) {
    const manifest = structuredClone(fixture.manifest)
    mutate(manifest)
    assert.throws(() => validateBackupManifest(fixture.metadata, manifest, fixture.receipt), {
      code: "RELEASE",
    })
  }
  const body = { ...fixture.metadata, format: FORMAT, state: "verified" }
  const release = {
    id: 1,
    tag_name: body.tag,
    draft: false,
    body: JSON.stringify(body),
    assets: [
      { id: 1, name: "manifest.json", size: fixture.receipt.files.at(-1).bytes },
      { id: 2, name: "receipt.json", size: 10 },
    ],
  }
  const store = new GitHubBackupStore("owner/backup", dir, () => {
    throw new Error("network must not be reached")
  })
  store.jsonAsset = async (_release, name) =>
    name === "receipt.json"
      ? {
          ...fixture.receipt,
          files: fixture.receipt.files.filter((file) => file.name === "manifest.json"),
        }
      : { format: FORMAT, identity: body.identity }
  await assert.rejects(store.complete(release, body.identity), { code: "RELEASE" })
})
test("retention preserves malformed owned releases and all source archives", async (t) => {
  const dir = await temporary(t),
    fixture = await snapshotFixture(dir, "2020-01-01T10:00:00Z")
  const validBody = { ...fixture.metadata, format: FORMAT, state: "verified" }
  const valid = {
    id: 1,
    tag_name: validBody.tag,
    draft: false,
    body: JSON.stringify(validBody),
    assets: [
      ...fixture.receipt.files.map((file, index) => ({
        id: index + 10,
        name: file.name,
        size: file.bytes,
        digest: `sha256:${file.sha256}`,
      })),
      { id: 20, name: "receipt.json", size: 500 },
    ],
  }
  const identity = sha("corrupt old snapshot"),
    corruptBody = {
      ...validBody,
      identity,
      tag: `hn-offsite-snapshot-2020-01-02-${identity.slice(0, 24)}`,
    }
  const corrupt = { ...valid, id: 2, tag_name: corruptBody.tag, body: JSON.stringify(corruptBody) }
  const archive = {
    id: 3,
    tag_name: fixture.manifest.archives[0].tag,
    draft: false,
    body: JSON.stringify({
      format: FORMAT,
      kind: "archive",
      tag: fixture.manifest.archives[0].tag,
      identity: fixture.manifest.archives[0].refsSha256,
      state: "verified",
    }),
    assets: [],
  }
  const unknown = {
    id: 4,
    tag_name: "important-manual-backup",
    body: "manual",
    draft: false,
    assets: [],
  }
  const latestDir = await temporary(t),
    latestFixture = await snapshotFixture(latestDir, "2020-01-04T10:00:00Z")
  const latestValid = {
    ...valid,
    id: 5,
    tag_name: latestFixture.metadata.tag,
    body: JSON.stringify({ ...latestFixture.metadata, format: FORMAT, state: "verified" }),
    assets: [
      ...latestFixture.receipt.files.map((file, index) => ({
        id: index + 30,
        name: file.name,
        size: file.bytes,
        digest: `sha256:${file.sha256}`,
      })),
      { id: 40, name: "receipt.json", size: 500 },
    ],
  }
  const store = new GitHubBackupStore("owner/backup", dir),
    deletions = []
  store.assertLease = async () => true
  store.listReleases = async () => [valid, corrupt, archive, unknown, latestValid]
  store.jsonAsset = async (release, name) => {
    const data = release.id === 5 ? latestFixture : fixture
    return release.id === 2 ? {} : name === "receipt.json" ? data.receipt : data.manifest
  }
  store.api = async (endpoint, { method } = {}) => {
    if (method === "DELETE") deletions.push(endpoint)
    return null
  }
  const result = await store.prune(now)
  assert.equal(result.removed, 1)
  assert.equal(result.retained, 1)
  assert.equal(result.skippedUnverified, 1)
  assert.equal(
    deletions.some((endpoint) => /\/releases\/(?:2|3|4|5)$/.test(endpoint)),
    false,
  )
  assert.equal(deletions.includes("repos/owner/backup/releases/1"), true)
})
test("wrong GitHub SHA leaves draft unpublished, does not clean up previous releases", async (t) => {
  const dir = await temporary(t),
    fixture = await snapshotFixture(dir)
  const mock = fakeGitHub(dir, { corrupt: true })
  await assert.rejects(mock.store.publish(fixture.metadata, fixture.files), {
    code: "SHA",
  })
  assert.equal(mock.release().draft, true)
  assert.equal(
    mock.calls.some((c) => c.args.includes("PATCH") || c.args.includes("DELETE")),
    false,
  )
})
test("private destination rejection happens before any export fetch or upload", async (t) => {
  const dir = await temporary(t)
  let fetched = false
  await assert.rejects(
    runOffsiteBackup({
      config,
      repository: "owner/public",
      key: secret,
      tempRoot: dir,
      fetcher: async () => {
        fetched = true
        return Response.json(status())
      },
      storeFactory: () => ({
        assertPrivate: async () =>
          assertPrivateRepository({ private: false, full_name: "owner/public" }, "owner/public"),
      }),
    }),
    { code: "PRIVATE_REPOSITORY" },
  )
  assert.equal(fetched, false)
  assert.deepEqual(await fs.readdir(dir), [])
})
test("local file SHA mismatch is detected without modifying either input", async (t) => {
  const dir = await temporary(t),
    file = path.join(dir, "file")
  await fs.writeFile(file, "a")
  const before = await fileInfo(file)
  await fs.writeFile(file, "b")
  await assert.rejects(verifyFile(file, before), { code: "SHA" })
  assert.equal(await fs.readFile(file, "utf8"), "b")
})
test("release ownership parser will not claim unknown tags or incomplete formats", () => {
  const identity = sha("owned"),
    tag = `hn-offsite-snapshot-2026-10-04-${identity.slice(0, 24)}`,
    body = { format: FORMAT, kind: "snapshot", tag, identity, state: "verified" }
  assert.equal(parseOwnedRelease({ tag_name: tag, body: JSON.stringify(body) }).identity, identity)
  for (const patch of [
    { tag_name: "manual-backup" },
    { body: "not json" },
    { body: JSON.stringify({ ...body, format: "foreign" }) },
    { body: JSON.stringify({ ...body, tag: "manual-backup" }) },
  ])
    assert.equal(parseOwnedRelease({ tag_name: tag, body: JSON.stringify(body), ...patch }), null)
})
test("archive completeness requires bundle and normalized full-source metadata", () => {
  const source = sourceIdentity(
    config.sourceRepositories[0],
    [{ name: "refs/heads/main", sha: "a".repeat(40) }],
    { symbolicRef: "refs/heads/main", sha: "a".repeat(40) },
  )
  const tag = `hn-offsite-archive-howard-notes-${source.refsSha256.slice(0, 32)}`
  const asset = { name: "archive.gitbundle", bytes: 123, sha256: sha("archive") }
  const body = { kind: "archive", identity: source.refsSha256, tag }
  const manifest = {
    format: FORMAT,
    kind: "archive",
    identity: source.refsSha256,
    source,
    bundle: asset,
    gitBundleVerified: true,
  }
  const receipt = {
    format: FORMAT,
    kind: "archive",
    identity: source.refsSha256,
    verifiedAt: new Date(now).toISOString(),
    verification: "github-roundtrip-sha256",
    files: [asset, { name: "manifest.json", bytes: 123, sha256: sha("manifest") }],
  }
  validateBackupManifest(body, manifest, receipt)
  assert.throws(
    () => validateBackupManifest(body, manifest, { ...receipt, files: receipt.files.slice(1) }),
    { code: "RELEASE" },
  )
  for (const mutate of [
    (value) => {
      value.source.repository = config.sourceRepositories[1]
    },
    (value) => {
      value.source.refsSha256 = sha("poison")
    },
    (value) => {
      value.bundle.name = "other.gitbundle"
    },
    (value) => {
      value.gitBundleVerified = false
    },
  ]) {
    const value = structuredClone(manifest)
    mutate(value)
    assert.throws(() => validateBackupManifest(body, value, receipt), { code: "RELEASE" })
  }
})
test("reused archive returns canonical metadata and rejects cached repository/hash pollution", async (t) => {
  const dir = await temporary(t),
    repository = config.sourceRepositories[0],
    commit = "a".repeat(40)
  const source = sourceIdentity(repository, [{ name: "refs/heads/main", sha: commit }], {
    symbolicRef: "refs/heads/main",
    sha: commit,
  })
  const tag = `hn-offsite-archive-howard-notes-${source.refsSha256.slice(0, 32)}`
  const asset = { name: "archive.gitbundle", bytes: 123, sha256: sha("archive") }
  let cachedSource = { ...source, untrustedExtra: "must not be copied" }
  const store = {
    api: async () => ({ private: false, full_name: repository }),
    release: async () => ({ tag_name: tag, draft: false }),
    complete: async () => ({
      manifest: { kind: "archive", source: cachedSource, bundle: asset },
      receipt: { files: [asset] },
    }),
  }
  const runner = async (program, args) => {
    assert.equal(program, "git")
    assert.equal(args.includes("ls-remote"), true)
    return `ref: refs/heads/main\tHEAD\n${commit}\tHEAD\n${commit}\trefs/heads/main\n`
  }
  const canonical = await sourceArchive(repository, dir, store, runner)
  assert.equal(canonical.repository, repository)
  assert.equal(canonical.untrustedExtra, undefined)
  for (const patch of [
    { repository: config.sourceRepositories[1] },
    { refsSha256: sha("poison") },
  ]) {
    cachedSource = { ...source, ...patch }
    await assert.rejects(sourceArchive(repository, dir, store, runner), { code: "RELEASE" })
  }
})
test("full mirror bundle retains non-default branch history and verifies with Git", async (t) => {
  const dir = await temporary(t),
    repo = path.join(dir, "source"),
    staging = path.join(dir, "staging")
  await fs.mkdir(staging)
  await command("git", ["init", "--initial-branch=main", repo])
  await command("git", ["-C", repo, "config", "user.name", "Fixture"])
  await command("git", ["-C", repo, "config", "user.email", "fixture@example.invalid"])
  await fs.writeFile(path.join(repo, "README.md"), "main")
  await command("git", ["-C", repo, "add", "README.md"])
  await command("git", ["-C", repo, "commit", "-m", "Main"])
  await command("git", ["-C", repo, "checkout", "-b", "dev"])
  await fs.writeFile(path.join(repo, "dev.txt"), "Non-default history")
  await command("git", ["-C", repo, "add", "dev.txt"])
  await command("git", ["-C", repo, "commit", "-m", "Dev"])
  await command("git", ["-C", repo, "tag", "dev-v1"])
  await command("git", ["-C", repo, "checkout", "main"])
  let published
  const store = {
    api: async () => ({ private: false, full_name: config.sourceRepositories[0] }),
    release: async () => null,
    publish: async (meta, files) => {
      published = { meta, files }
      return {}
    },
  }
  const runner = (program, args, options) =>
    command(
      program,
      args.map((arg) =>
        arg === `https://github.com/${config.sourceRepositories[0]}.git` ? repo : arg,
      ),
      options,
    )
  const archive = await sourceArchive(config.sourceRepositories[0], staging, store, runner)
  assert.ok(archive.refs.some((ref) => ref.name === "refs/heads/dev"))
  assert.ok(archive.refs.some((ref) => ref.name === "refs/tags/dev-v1"))
  assert.equal(archive.asset.name, "archive.gitbundle")
  const restored = path.join(dir, "restored.git")
  await command("git", ["clone", "--mirror", published.files[0], restored])
  const refs = await command("git", ["-C", restored, "for-each-ref", "--format=%(refname)"])
  assert.equal(refs.includes("refs/heads/dev"), true)
  assert.equal(
    await command("git", ["-C", restored, "show", "refs/heads/dev:dev.txt"]),
    "Non-default history",
  )
})

function collectionFixture(directory, { blocked = false, concurrent = false } = {}) {
  const store = new GitHubBackupStore("owner/backup", directory)
  store.assertLease = async () => true
  const tag = (kind, value) =>
    kind === "archive"
      ? `hn-offsite-archive-howard-notes-${sha(value).slice(0, 32)}`
      : `hn-offsite-snapshot-2026-10-04-${sha(value).slice(0, 24)}`
  const make = (kind, value, id, days = 60) => ({
    id,
    tag_name: tag(kind, value),
    draft: false,
    published_at: new Date(now - days * 86400000).toISOString(),
    assets: [{ size: 100 }],
    body: JSON.stringify({
      format: FORMAT,
      kind,
      tag: tag(kind, value),
      identity: sha(value),
      state: "verified",
      completedAt: new Date(now).toISOString(),
      unreferencedSince:
        kind === "archive" ? new Date(now - days * 86400000).toISOString() : undefined,
    }),
  })
  const snapshot = make("snapshot", "current", 1),
    required = make("archive", "required", 2),
    old = make("archive", "old", 3),
    young = make("archive", "young", 4, 2)
  const unknown = { ...make("snapshot", "broken", 5), body: "incomplete" }
  let releases = [snapshot, required, old, young, ...(blocked ? [unknown] : [])],
    lists = 0
  const deleted = []
  store.listReleases = async () => {
    lists++
    return releases
  }
  store.complete = async (release) => ({
    manifest: {
      archives: [
        { tag: required.tag_name },
        ...(concurrent && lists > 1 ? [{ tag: old.tag_name }] : []),
      ],
    },
  })
  store.api = async (endpoint, options) => {
    if (options?.method === "DELETE") {
      deleted.push(endpoint)
      releases = releases.filter((item) => !endpoint.endsWith(`/releases/${item.id}`))
    }
  }
  return { store, old, required, young, deleted }
}
test("archive retention previews only unreferenced, verified archives beyond grace", async (t) => {
  const f = collectionFixture(await temporary(t))
  const result = await f.store.prune(now, { dryRun: true, archiveCleanup: "apply" })
  assert.deepEqual(result.archiveCandidates, [{ tag: f.old.tag_name, bytes: 100 }])
  assert.equal(result.archiveCandidateBytes, 100)
  assert.equal(result.removedArchives, 0)
  assert.deepEqual(f.deleted, [])
})
test("archive apply preserves dependencies, young archives and newly referenced archives", async (t) => {
  for (const concurrent of [false, true]) {
    const f = collectionFixture(await temporary(t), { concurrent })
    const result = await f.store.prune(now, { archiveCleanup: "apply" })
    assert.equal(result.removedArchives, concurrent ? 0 : 1)
    assert.equal(
      f.deleted.some(
        (endpoint) => endpoint.endsWith("/releases/2") || endpoint.endsWith("/releases/4"),
      ),
      false,
    )
  }
})
test("incomplete owned snapshots block all archive garbage collection", async (t) => {
  const f = collectionFixture(await temporary(t), { blocked: true })
  const result = await f.store.prune(now, { archiveCleanup: "apply" })
  assert.equal(result.archiveBlocked, true)
  assert.deepEqual(result.archiveCandidates, [])
  assert.deepEqual(f.deleted, [])
})
test("maintenance handoff contains actual configuration and restorable private commit history without release tags or git credentials", async (t) => {
  const dir = await temporary(t),
    repo = path.join(dir, "private"),
    staging = path.join(dir, "stage")
  await fs.mkdir(staging)
  await command("git", ["init", "--initial-branch=main", repo])
  await command("git", ["-C", repo, "config", "user.name", "Fixture"])
  await command("git", ["-C", repo, "config", "user.email", "fixture@example.invalid"])
  await command("git", [
    "-C",
    repo,
    "config",
    "http.extraHeader",
    "synthetic-secret-not-for-bundle",
  ])
  await fs.mkdir(path.join(repo, "handoff"))
  await fs.mkdir(path.join(repo, ".github/workflows"), { recursive: true })
  await fs.writeFile(path.join(repo, "handoff/README.md"), "current handoff")
  await fs.writeFile(path.join(repo, "backup.config.json"), JSON.stringify(config))
  await fs.writeFile(path.join(repo, ".github/workflows/backup.yml"), "name: actual backup")
  await command("git", ["-C", repo, "add", "."])
  await command("git", ["-C", repo, "commit", "-m", "Maintenance history fixture"])
  await command("git", ["-C", repo, "tag", "hn-offsite-snapshot-test"])
  await command("git", ["-C", repo, "branch", "hn-offsite-lock"])
  await fs.writeFile(path.join(repo, "handoff/local-only.txt"), "synthetic untracked text")
  const staged = await stageHandoffMaterials(path.join(repo, "handoff"), repo, staging)
  assert.equal(
    await fs.readFile(path.join(staged, "maintenance/backup.yml"), "utf8"),
    "name: actual backup",
  )
  const bundle = path.join(staged, "maintenance/maintenance.gitbundle")
  const refs = await command("git", ["bundle", "list-heads", bundle])
  assert.equal(refs.includes("refs/heads/main"), true)
  assert.equal(refs.includes("hn-offsite"), false)
  await assert.rejects(fs.access(path.join(staged, "local-only.txt")), { code: "ENOENT" })
  const restored = path.join(dir, "restored")
  await command("git", ["clone", bundle, restored])
  assert.equal(
    (await command("git", ["-C", restored, "log", "-1", "--format=%s"])).trim(),
    "Maintenance history fixture",
  )
  assert.equal(
    (await fs.readFile(path.join(restored, ".git/config"), "utf8")).includes("synthetic-secret"),
    false,
  )
  await fs.writeFile(path.join(repo, "handoff/README.md"), "uncommitted")
  await assert.rejects(stageHandoffMaterials(path.join(repo, "handoff"), repo, staging), {
    code: "CHANGED",
  })
})

test("an old archive starts a fresh quarantine when its last retained reference disappears", async (t) => {
  const f = collectionFixture(await temporary(t))
  const listing = await f.store.listReleases()
  const old = listing.find((entry) => entry.tag_name === f.old.tag_name)
  const metadata = JSON.parse(old.body)
  delete metadata.unreferencedSince
  old.body = JSON.stringify(metadata)
  const result = await f.store.prune(now, { archiveCleanup: "apply" })
  assert.equal(result.removedArchives, 0)
  assert.deepEqual(result.archiveQuarantineCandidates, [{ tag: f.old.tag_name, bytes: 100 }])
  assert.deepEqual(f.deleted, [])
})

test("reusing a quarantined archive clears its old timer before a snapshot can be interrupted", async (t) => {
  const f = collectionFixture(await temporary(t))
  let metadata
  f.store.api = async (_endpoint, options) => {
    if (options.method === "PATCH") metadata = JSON.parse(options.body.body)
  }
  await f.store.pinArchive(f.old)
  assert.equal(metadata.unreferencedSince, undefined)
  assert.equal(metadata.identity, JSON.parse(f.old.body).identity)
})
