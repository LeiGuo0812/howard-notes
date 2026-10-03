import fs from "node:fs/promises"
import { createReadStream, createWriteStream, constants } from "node:fs"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { Transform, Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { GitHubBackupLease } from "./offsite-lease.mjs"

export const FORMAT = "howard-notes-offsite-v1"
export const TRUSTED_SITE_BASE = "https://howard-notes.howard-notes-login.workers.dev/howard-notes/"
export const MAX_ASSET_BYTES = 2 * 1024 ** 3 - 1
export const SOURCE_REPOSITORIES = Object.freeze([
  "LeiGuo0812/howard-notes",
  "LeiGuo0812/pic_cloud_gl",
])
export const SNAPSHOT_TAG = /^hn-offsite-snapshot-\d{4}-\d{2}-\d{2}-[a-f0-9]{24}$/
export const ARCHIVE_TAG = /^hn-offsite-archive-(?:howard-notes|pic-cloud-gl)-[a-f0-9]{32}$/
export const SAFE_SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/
const hash = (value) => createHash("sha256").update(value).digest("hex")
const validSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const fail = (code) => {
  throw new OffsiteBackupError(code)
}
const messages = {
  CONFIG: "Backup configuration is invalid.",
  LEASE_BUSY: "Another backup or cleanup owns the private-repository lease; retry later.",
  LEASE_LOST: "Private backup lease is lost or expired; publication and cleanup have stopped.",
  PRIVATE_REPOSITORY: "Backup destination must be a private GitHub repository.",
  STATUS: "Completed backup status is unavailable or invalid.",
  STALE: "The latest completed backup is older than 48 hours.",
  HTTP: "Encrypted backup download failed; existing backups are preserved.",
  REDIRECT: "Backup endpoint redirects are not allowed.",
  SIZE: "Backup asset exceeds the safe GitHub upload size.",
  FRAMING: "Encrypted backup bundle is malformed or incomplete.",
  PATH: "Handoff materials contain an unsafe path, link or unsupported file.",
  CHANGED: "Backup source changed while being captured; retry the run.",
  COMMAND: "A GitHub or Git operation failed; existing backups are preserved.",
  SHA: "Downloaded GitHub asset failed its SHA-256 verification.",
  RELEASE: "A conflicting or incomplete backup release cannot be used.",
  RETENTION: "New backup is complete, but old-backup cleanup needs a retry.",
}
export class OffsiteBackupError extends Error {
  constructor(code) {
    super(messages[code] || "Backup failed; existing backups are preserved.")
    this.name = "OffsiteBackupError"
    this.code = code
  }
}
export function repositoryName(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) ||
    value.length > 200
  )
    fail("CONFIG")
  return value
}
export function validateConfiguration(config) {
  if (
    !config ||
    config.version !== 1 ||
    !Array.isArray(config.sourceRepositories) ||
    !config.sourceRepositories.length
  )
    fail("CONFIG")
  let site
  try {
    site = new URL(config.siteBase)
  } catch {
    fail("CONFIG")
  }
  if (
    site.protocol !== "https:" ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    site.port ||
    !site.pathname.endsWith("/") ||
    site.href !== TRUSTED_SITE_BASE
  )
    fail("CONFIG")
  const sources = config.sourceRepositories.map(
    (repository) =>
      SOURCE_REPOSITORIES.find(
        (allowed) => allowed.toLowerCase() === repositoryName(repository).toLowerCase(),
      ) || fail("CONFIG"),
  )
  if (new Set(sources).size !== sources.length) fail("CONFIG")
  const handoffDirectory = config.handoffDirectory || "handoff"
  assertRelativePath(handoffDirectory)
  const retention = {
    dailyDays: config.retention?.dailyDays ?? 30,
    monthlyMonths: config.retention?.monthlyMonths ?? 12,
    archiveGraceDays: config.retention?.archiveGraceDays ?? 30,
    archiveCleanup: config.retention?.archiveCleanup ?? "dry-run",
  }
  if (
    retention.dailyDays !== 30 ||
    retention.monthlyMonths !== 12 ||
    !Number.isInteger(retention.archiveGraceDays) ||
    retention.archiveGraceDays < 30 ||
    retention.archiveGraceDays > 365 ||
    !["dry-run", "apply"].includes(retention.archiveCleanup)
  )
    fail("CONFIG")
  return {
    version: 1,
    siteBase: site.href,
    sourceRepositories: sources,
    handoffDirectory,
    retention,
  }
}
export function assertPrivateRepository(metadata, expected) {
  repositoryName(expected)
  if (
    !metadata ||
    metadata.private !== true ||
    String(metadata.full_name || "").toLowerCase() !== expected.toLowerCase() ||
    metadata.archived ||
    metadata.disabled
  )
    fail("PRIVATE_REPOSITORY")
  return metadata
}
export function latestSnapshot(status, now = Date.now()) {
  const latest = status?.latest
  const completed = Date.parse(latest?.completedAt)
  if (
    status?.configured !== true ||
    !SAFE_SNAPSHOT.test(latest?.id || "") ||
    !Number.isFinite(completed) ||
    completed > now + 5 * 60_000
  )
    fail("STATUS")
  if (now - completed > 48 * 60 * 60_000) fail("STALE")
  return { ...latest, completedAt: new Date(completed).toISOString() }
}
export function assertRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("PATH")
  return value
}
export function sourceIdentity(repository, refs, head) {
  repositoryName(repository)
  if (
    !Array.isArray(refs) ||
    !refs.length ||
    !head ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head.sha || "")
  )
    fail("CHANGED")
  const sorted = refs
    .map((ref) => {
      if (
        !ref ||
        !/^refs\//.test(ref.name || "") ||
        /[\u0000-\u0020\u007f]/.test(ref.name) ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref.sha || "")
      )
        fail("CHANGED")
      return { name: ref.name, sha: ref.sha }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (
    new Set(sorted.map((ref) => ref.name)).size !== sorted.length ||
    !sorted.some((ref) => ref.name === head.symbolicRef && ref.sha === head.sha)
  )
    fail("CHANGED")
  return {
    repository,
    refs: sorted,
    head: { symbolicRef: head.symbolicRef, sha: head.sha },
    refsSha256: hash(
      JSON.stringify({
        repository,
        refs: sorted,
        head: { symbolicRef: head.symbolicRef, sha: head.sha },
      }),
    ),
  }
}
export function parseRemoteRefs(text, repository) {
  let symbolicRef, headSha
  const refs = []
  for (const line of String(text).trim().split("\n")) {
    const symbolic = /^ref: (refs\/[^\s]+)\s+HEAD$/.exec(line)
    if (symbolic) {
      symbolicRef = symbolic[1]
      continue
    }
    const match = /^([a-f0-9]{40,64})\s+([^\s]+)$/.exec(line)
    if (!match) fail("CHANGED")
    if (match[2] === "HEAD") headSha = match[1]
    else if (!match[2].endsWith("^{}")) refs.push({ name: match[2], sha: match[1] })
  }
  return sourceIdentity(repository, refs, { symbolicRef, sha: headSha })
}
export function retentionPlan(releases, now = Date.now()) {
  const owned = releases.filter(
    (release) =>
      SNAPSHOT_TAG.test(release.tag || "") &&
      release.complete === true &&
      validSha(release.identity) &&
      Number.isFinite(Date.parse(release.completedAt)),
  )
  const keep = new Set()
  const monthly = new Map()
  const currentMonth = new Date(now).getUTCFullYear() * 12 + new Date(now).getUTCMonth()
  for (const release of owned) {
    const time = Date.parse(release.completedAt),
      date = new Date(time)
    if (time >= now - 30 * 86_400_000) keep.add(release.tag)
    const month = date.getUTCFullYear() * 12 + date.getUTCMonth()
    if (
      time <= now &&
      month <= currentMonth &&
      (!monthly.has(month) || time > Date.parse(monthly.get(month).completedAt))
    )
      monthly.set(month, release)
  }
  for (const [, release] of [...monthly.entries()].sort(([a], [b]) => b - a).slice(0, 12))
    keep.add(release.tag)
  return {
    keep: owned.filter((release) => keep.has(release.tag)),
    remove: owned.filter((release) => !keep.has(release.tag)),
  }
}
export async function fileInfo(file, name = path.basename(file)) {
  assertRelativePath(name)
  const digest = createHash("sha256")
  let bytes = 0
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length
    if (bytes > MAX_ASSET_BYTES) fail("SIZE")
    digest.update(chunk)
  }
  return { name, bytes, sha256: digest.digest("hex") }
}
export async function verifyFile(file, expected) {
  const actual = await fileInfo(file, expected.name)
  if (
    !validSha(expected.sha256) ||
    actual.bytes !== expected.bytes ||
    actual.sha256 !== expected.sha256
  )
    fail("SHA")
  return actual
}

/** Older gh versions print consecutive page arrays rather than supporting --slurp. */
export function parseGitHubPages(value) {
  const pages = []
  let start = -1,
    depth = 0,
    inString = false,
    escaped = false
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (start < 0) {
      if (/\s/.test(character)) continue
      if (character !== "[") fail("COMMAND")
      start = index
    }
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === "[" || character === "{") depth++
    else if (character === "]" || character === "}") {
      depth--
      if (!depth) {
        let page
        try {
          page = JSON.parse(value.slice(start, index + 1))
        } catch {
          fail("COMMAND")
        }
        if (!Array.isArray(page)) fail("COMMAND")
        pages.push(...page)
        start = -1
      }
    }
  }
  if (
    start !== -1 ||
    depth ||
    inString ||
    !pages.every((release) => release && typeof release === "object" && !Array.isArray(release))
  )
    fail("COMMAND")
  return pages
}

function normalizedSource(source) {
  const repository = SOURCE_REPOSITORIES.find((allowed) => allowed === source?.repository)
  if (!repository) fail("RELEASE")
  let identity
  try {
    identity = sourceIdentity(repository, source.refs, source.head)
  } catch {
    fail("RELEASE")
  }
  if (source.refsSha256 !== identity.refsSha256) fail("RELEASE")
  return identity
}
function sameAssetRecord(actual, expected) {
  return (
    actual?.name === expected.name &&
    actual.bytes === expected.bytes &&
    actual.sha256 === expected.sha256
  )
}
function archiveTag(source) {
  return `hn-offsite-archive-${source.repository.split("/")[1].replaceAll("_", "-")}-${source.refsSha256.slice(0, 32)}`
}
/** A receipt cannot make a release complete unless every primary asset is described. */
export function validateBackupManifest(body, manifest, receipt) {
  const required =
    body.kind === "snapshot"
      ? ["content.hnbackup", "handoff.tar", "manifest.json"]
      : body.kind === "archive"
        ? ["archive.gitbundle", "manifest.json"]
        : fail("RELEASE")
  if (
    receipt?.format !== FORMAT ||
    receipt.kind !== body.kind ||
    receipt.identity !== body.identity ||
    receipt.verification !== "github-roundtrip-sha256" ||
    !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
    !Array.isArray(receipt.files) ||
    receipt.files.length !== required.length ||
    new Set(receipt.files.map((file) => file?.name)).size !== required.length ||
    receipt.files.some(
      (file) =>
        !required.includes(file?.name) ||
        !validSha(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        file.bytes > MAX_ASSET_BYTES,
    ) ||
    manifest?.format !== FORMAT ||
    manifest.kind !== body.kind ||
    manifest.identity !== body.identity
  )
    fail("RELEASE")
  const info = (name) => receipt.files.find((file) => file.name === name)
  if (body.kind === "archive") {
    const source = normalizedSource(manifest.source)
    if (
      source.refsSha256 !== body.identity ||
      body.tag !== archiveTag(source) ||
      manifest.gitBundleVerified !== true ||
      !sameAssetRecord(manifest.bundle, info("archive.gitbundle"))
    )
      fail("RELEASE")
  } else {
    if (
      !SAFE_SNAPSHOT.test(manifest.snapshot?.id || "") ||
      !Number.isFinite(Date.parse(manifest.snapshot.completedAt)) ||
      !Number.isFinite(Date.parse(body.completedAt)) ||
      Date.parse(manifest.snapshot.completedAt) !== Date.parse(body.completedAt) ||
      body.tag !==
        `hn-offsite-snapshot-${new Date(body.completedAt).toISOString().slice(0, 10)}-${body.identity.slice(0, 24)}` ||
      !sameAssetRecord(manifest.content, info("content.hnbackup")) ||
      !sameAssetRecord(manifest.handoff, info("handoff.tar")) ||
      manifest.content.snapshot !== manifest.snapshot.id ||
      manifest.content.framingVerified !== true ||
      manifest.content.ciphertextAuthenticated !== false ||
      !Array.isArray(manifest.archives) ||
      !manifest.archives.length ||
      new Set(manifest.archives.map((archive) => archive?.repository)).size !==
        manifest.archives.length
    )
      fail("RELEASE")
    const archives = manifest.archives.map((archive) => {
      const source = normalizedSource(archive)
      if (
        archive.tag !== archiveTag(source) ||
        archive.asset?.name !== "archive.gitbundle" ||
        !validSha(archive.asset.sha256) ||
        !Number.isSafeInteger(archive.asset.bytes) ||
        archive.asset.bytes < 1 ||
        archive.asset.bytes > MAX_ASSET_BYTES
      )
        fail("RELEASE")
      return source
    })
    const identity = hash(
      JSON.stringify({
        snapshot: manifest.snapshot.id,
        contentSha256: manifest.content.sha256,
        handoffSha256: manifest.handoff.sha256,
        archives: archives.map((archive) => ({
          repository: archive.repository,
          refsSha256: archive.refsSha256,
        })),
      }),
    )
    if (identity !== body.identity) fail("RELEASE")
  }
  return manifest
}

/** Validate framing without decrypting private bytes or requiring the restore key. */
export class BackupBundleValidator extends Transform {
  constructor(snapshot) {
    super()
    if (!SAFE_SNAPSHOT.test(snapshot || "")) fail("FRAMING")
    this.snapshot = snapshot
    this.state = "heading"
    this.pending = Buffer.alloc(0)
    this.remaining = 0
    this.seen = new Set()
    this.bytes = 0
  }
  _transform(chunk, _encoding, callback) {
    try {
      this.bytes += chunk.length
      if (this.bytes > MAX_ASSET_BYTES) fail("SIZE")
      let cursor = 0
      while (cursor < chunk.length) {
        if (this.state === "payload") {
          const count = Math.min(this.remaining, chunk.length - cursor)
          this.remaining -= count
          cursor += count
          if (!this.remaining) this.state = "length"
          continue
        }
        if (this.state === "heading") {
          const end = chunk.indexOf(10, cursor),
            stop = end < 0 ? chunk.length : end
          this.pending = Buffer.concat([this.pending, chunk.subarray(cursor, stop)])
          if (this.pending.length > 1024) fail("FRAMING")
          cursor = stop
          if (end >= 0) {
            const header = JSON.parse(this.pending.toString("utf8"))
            if (
              header.format !== "howard-notes-backup-bundle-v2" ||
              header.snapshot !== this.snapshot
            )
              fail("FRAMING")
            this.pending = Buffer.alloc(0)
            this.state = "length"
            cursor++
          }
          continue
        }
        const need = (this.state === "length" ? 4 : this.remaining) - this.pending.length,
          count = Math.min(need, chunk.length - cursor)
        this.pending = Buffer.concat([this.pending, chunk.subarray(cursor, cursor + count)])
        cursor += count
        if (this.pending.length < (this.state === "length" ? 4 : this.remaining)) continue
        if (this.state === "length") {
          const length = this.pending.readUInt32BE()
          if (!length || length > 1024) fail("FRAMING")
          this.remaining = length
          this.pending = Buffer.alloc(0)
          this.state = "record"
        } else {
          const record = JSON.parse(this.pending.toString("utf8"))
          const key = record.key
          const snapshotPrefix = `snapshots/${this.snapshot}/`
          if (
            typeof key !== "string" ||
            !(
              (key.startsWith(snapshotPrefix) &&
                /^snapshots\/[^/]+\/(?:manifest|\d{6})\.hnbackup$/.test(key)) ||
              /^objects\/[a-f0-9]{64}\/(?:manifest|\d{6})\.hnbackup$/.test(key)
            ) ||
            this.seen.has(key) ||
            !Number.isSafeInteger(record.size) ||
            record.size < 32 ||
            record.size > 64 * 1024 * 1024
          )
            fail("FRAMING")
          this.seen.add(key)
          this.remaining = record.size
          this.pending = Buffer.alloc(0)
          this.state = "payload"
        }
      }
      callback(null, chunk)
    } catch (error) {
      callback(error instanceof OffsiteBackupError ? error : new OffsiteBackupError("FRAMING"))
    }
  }
  _flush(callback) {
    callback(
      this.state === "length" &&
        !this.pending.length &&
        this.seen.has(`snapshots/${this.snapshot}/manifest.hnbackup`)
        ? null
        : new OffsiteBackupError("FRAMING"),
    )
  }
}
export async function fetchBackupStatus(siteBase, key, { fetcher = fetch, now = Date.now() } = {}) {
  const response = await trustedFetch(
    new URL("api/content/backups/export/status", siteBase),
    key,
    fetcher,
    AbortSignal.timeout(30_000),
  )
  const bytes = await smallResponse(response, 64 * 1024)
  try {
    return latestSnapshot(JSON.parse(bytes.toString("utf8")), now)
  } catch (error) {
    if (error instanceof OffsiteBackupError) throw error
    fail("STATUS")
  }
}
async function trustedFetch(url, key, fetcher, signal) {
  const trusted = new URL(TRUSTED_SITE_BASE)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    typeof key !== "string" ||
    key.length < 32 ||
    key.length > 512 ||
    /[\u0000-\u0020\u007f]/.test(key) ||
    url.origin !== trusted.origin ||
    !["status", "download"].some(
      (action) =>
        url.pathname === new URL(`api/content/backups/export/${action}`, trusted).pathname,
    )
  )
    fail("CONFIG")
  let response
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { "X-Howard-Backup-Key": key },
      credentials: "omit",
      redirect: "error",
      signal,
    })
  } catch {
    fail("HTTP")
  }
  if (response.redirected || (response.status >= 300 && response.status < 400)) fail("REDIRECT")
  if (!response.ok || !response.body) fail("HTTP")
  return response
}
async function smallResponse(response, max) {
  const reader = response.body.getReader(),
    chunks = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > max) fail("SIZE")
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export async function downloadContentBackup(
  siteBase,
  key,
  snapshot,
  file,
  { fetcher = fetch, timeoutMs = 20 * 60_000 } = {},
) {
  if (!SAFE_SNAPSHOT.test(snapshot)) fail("STATUS")
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs)
  let created = false,
    handle
  try {
    const url = new URL("api/content/backups/export/download", siteBase)
    url.searchParams.set("id", snapshot)
    const response = await trustedFetch(url, key, fetcher, controller.signal)
    const declared = response.headers.get("Content-Length")
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_ASSET_BYTES)) fail("SIZE")
    handle = await fs.open(file, "wx", 0o600)
    created = true
    await pipeline(
      Readable.fromWeb(response.body),
      new BackupBundleValidator(snapshot),
      handle.createWriteStream(),
      { signal: controller.signal },
    )
    const info = await fileInfo(file, "content.hnbackup")
    if (declared && info.bytes !== Number(declared)) fail("FRAMING")
    return { ...info, snapshot, framingVerified: true, ciphertextAuthenticated: false }
  } catch (error) {
    await handle?.close().catch(() => {})
    if (created) await fs.rm(file, { force: true }).catch(() => {})
    if (error instanceof OffsiteBackupError) throw error
    fail("HTTP")
  } finally {
    clearTimeout(timer)
  }
}

function tarHeader(name, size, type = "0") {
  assertRelativePath(name)
  const bytes = Buffer.from(name)
  let base = name,
    prefix = ""
  if (bytes.length > 100) {
    let split = name.lastIndexOf("/")
    while (split > 0) {
      const a = name.slice(0, split),
        b = name.slice(split + 1)
      if (Buffer.byteLength(a) <= 155 && Buffer.byteLength(b) <= 100) {
        prefix = a
        base = b
        break
      }
      split = name.lastIndexOf("/", split - 1)
    }
    if (!prefix) fail("PATH")
  }
  const header = Buffer.alloc(512),
    put = (text, offset, length) => {
      const value = Buffer.from(text)
      if (value.length > length) fail("PATH")
      value.copy(header, offset)
    }
  put(base, 0, 100)
  put(type === "5" ? "0000700\0" : "0000600\0", 100, 8)
  put("0000000\0", 108, 8)
  put("0000000\0", 116, 8)
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12)
  put("00000000000\0", 136, 12)
  header.fill(32, 148, 156)
  put(type, 156, 1)
  put("ustar\0", 257, 6)
  put("00", 263, 2)
  put(prefix, 345, 155)
  const sum = header.reduce((a, b) => a + b, 0)
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8)
  return header
}
/** Deterministic owner-only tar; never follows symbolic links or stores absolute paths. */
export async function createHandoffTar(directory, file) {
  const root = path.resolve(directory)
  if ((await fs.realpath(root)) !== root) fail("PATH")
  const entries = []
  async function walk(relative = "") {
    const target = path.join(root, relative),
      stat = await fs.lstat(target)
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && !stat.isFile()) ||
      (stat.isFile() && stat.nlink !== 1)
    )
      fail("PATH")
    if (relative) assertRelativePath(relative)
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(target)).sort())
        await walk(relative ? [relative, name].join("/") : name)
    } else entries.push({ relative, target, stat })
  }
  await walk()
  if (!entries.length) fail("PATH")
  const handle = await fs.open(file, "wx", 0o600)
  let total = 0
  const write = async (bytes) => {
    total += bytes.length
    if (total > MAX_ASSET_BYTES) fail("SIZE")
    await handle.writeFile(bytes)
  }
  try {
    for (const entry of entries) {
      await write(tarHeader(`handoff/${entry.relative}`, entry.stat.size))
      const source = await fs.open(entry.target, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const before = await source.stat()
        if (
          before.ino !== entry.stat.ino ||
          before.size !== entry.stat.size ||
          before.mtimeMs !== entry.stat.mtimeMs
        )
          fail("CHANGED")
        for await (const chunk of source.createReadStream({ autoClose: false })) await write(chunk)
        const after = await source.stat()
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs
        )
          fail("CHANGED")
      } finally {
        await source.close()
      }
      const remainder = entry.stat.size % 512
      if (remainder) await write(Buffer.alloc(512 - remainder))
    }
    await write(Buffer.alloc(1024))
    await handle.close()
    return await fileInfo(file, "handoff.tar")
  } catch (error) {
    await handle.close().catch(() => {})
    await fs.rm(file, { force: true })
    throw error
  }
}

export async function command(
  program,
  args,
  { cwd, outputFile, env = process.env, maxBytes = 32 * 1024 * 1024, timeoutMs = 0 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }),
      chunks = []
    let size = 0,
      stderr = "",
      destination
    const timer = timeoutMs ? setTimeout(() => child.kill("SIGKILL"), timeoutMs) : null
    if (outputFile) destination = createWriteStream(outputFile, { flags: "wx", mode: 0o600 })
    child.stdout.on("data", (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        child.kill()
        return
      }
      if (destination) {
        if (!destination.write(chunk)) child.stdout.pause()
      } else chunks.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 65536) stderr += chunk.toString("utf8")
    })
    child.on("error", () => {
      clearTimeout(timer)
      destination?.destroy()
      reject(new OffsiteBackupError("COMMAND"))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const finish = () => {
        if (code !== 0 || size > maxBytes) {
          const error = new OffsiteBackupError(size > maxBytes ? "SIZE" : "COMMAND")
          error.status = Number(/HTTP\s+(\d{3})/.exec(stderr)?.[1]) || null
          reject(error)
        } else resolve(destination ? { bytes: size } : Buffer.concat(chunks).toString("utf8"))
      }
      if (destination) destination.end(finish)
      else finish()
    })
    destination?.on("error", () => {
      clearTimeout(timer)
      child.kill()
      reject(new OffsiteBackupError("COMMAND"))
    })
    destination?.on("drain", () => child.stdout.resume())
  })
}
export class GitHubBackupStore {
  constructor(repository, directory, runner = command) {
    this.repository = repositoryName(repository)
    this.directory = directory
    this.runner = runner
    this.sequence = 0
    this.lease = new GitHubBackupLease(this.repository, (...args) => this.api(...args))
  }
  async acquireLease() {
    try {
      return await this.lease.acquire()
    } catch (error) {
      fail(error.code === "LEASE_BUSY" ? "LEASE_BUSY" : "LEASE_LOST")
    }
  }
  async assertLease() {
    try {
      return await this.lease.assert()
    } catch {
      fail("LEASE_LOST")
    }
  }
  async releaseLease() {
    try {
      return await this.lease.release()
    } catch {
      fail("LEASE_LOST")
    }
  }
  async gh(args, options = {}) {
    return this.runner("gh", args, { ...options, env: { ...process.env, GH_HOST: "github.com" } })
  }
  async api(endpoint, { method, body } = {}) {
    if (
      method &&
      method !== "GET" &&
      (/\/releases(?:\/|$)/.test(endpoint) || /\/git\/refs\/tags\//.test(endpoint))
    )
      await this.assertLease()
    const args = ["api", endpoint, "--hostname", "github.com"]
    if (method) args.push("--method", method)
    if (body !== undefined) {
      const file = path.join(this.directory, `request-${this.sequence++}.json`)
      await fs.writeFile(file, JSON.stringify(body), { mode: 0o600, flag: "wx" })
      args.push("--input", file)
    }
    const text = await this.gh(args, { timeoutMs: 60_000 })
    try {
      return text ? JSON.parse(text) : null
    } catch {
      fail("COMMAND")
    }
  }
  async assertPrivate() {
    return assertPrivateRepository(await this.api(`repos/${this.repository}`), this.repository)
  }
  async release(tag) {
    try {
      return await this.api(`repos/${this.repository}/releases/tags/${encodeURIComponent(tag)}`)
    } catch (error) {
      if (error.status === 404) {
        const candidates = (await this.listReleases()).filter((release) => release.tag_name === tag)
        if (candidates.length > 1) fail("RELEASE")
        return candidates[0] || null
      }
      throw error
    }
  }
  async listReleases() {
    return parseGitHubPages(
      await this.gh([
        "api",
        `repos/${this.repository}/releases?per_page=100`,
        "--hostname",
        "github.com",
        "--paginate",
      ]),
    )
  }
  async readAsset(release, name, { maxBytes = 2 * 1024 * 1024 } = {}) {
    const assets = (release.assets || []).filter((asset) => asset.name === name)
    if (assets.length !== 1 || !Number.isSafeInteger(assets[0].id) || assets[0].size > maxBytes)
      fail("RELEASE")
    const file = path.join(this.directory, `remote-${this.sequence++}`)
    await this.gh(
      [
        "api",
        `repos/${this.repository}/releases/assets/${assets[0].id}`,
        "--hostname",
        "github.com",
        "--header",
        "Accept: application/octet-stream",
      ],
      { outputFile: file, maxBytes },
    )
    return file
  }
  async jsonAsset(release, name) {
    const file = await this.readAsset(release, name)
    try {
      return JSON.parse(await fs.readFile(file, "utf8"))
    } catch {
      fail("RELEASE")
    }
  }
  async upload(tag, file) {
    await this.assertLease()
    await this.gh(["release", "upload", tag, "--repo", this.repository, file], {
      timeoutMs: 120_000,
    })
  }
  async verifyAssets(release, files) {
    const current = await this.api(`repos/${this.repository}/releases/${release.id}`)
    for (const expected of files) {
      const metadata = current.assets?.find((asset) => asset.name === expected.name)
      if (
        !metadata ||
        metadata.size !== expected.bytes ||
        (metadata.digest && metadata.digest !== `sha256:${expected.sha256}`)
      )
        fail("SHA")
      const file = await this.readAsset(current, expected.name, { maxBytes: MAX_ASSET_BYTES })
      await verifyFile(file, expected)
      await fs.rm(file)
    }
    return current
  }
  async publish(metadata, files) {
    await this.assertLease()
    const tag = metadata.tag
    if (!(SNAPSHOT_TAG.test(tag) || ARCHIVE_TAG.test(tag))) fail("RELEASE")
    const infos = await Promise.all(files.map((file) => fileInfo(file)))
    const manifestPath = files.find((file) => path.basename(file) === "manifest.json")
    let manifest
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    } catch {
      fail("RELEASE")
    }
    validateBackupManifest(metadata, manifest, {
      format: FORMAT,
      kind: metadata.kind,
      identity: metadata.identity,
      verification: "github-roundtrip-sha256",
      verifiedAt: new Date().toISOString(),
      files: infos,
    })
    let existing = await this.release(tag)
    if (existing) {
      const body = parseOwnedRelease(existing)
      if (!body || body.identity !== metadata.identity || body.kind !== metadata.kind)
        fail("RELEASE")
      if (!existing.draft) return this.complete(existing, metadata.identity)
      await this.api(`repos/${this.repository}/releases/${existing.id}`, { method: "DELETE" })
    }
    const privateMeta = await this.assertPrivate()
    const release = await this.api(`repos/${this.repository}/releases`, {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: privateMeta.default_branch,
        name: metadata.kind === "archive" ? "Immutable source archive" : "Private notes backup",
        body: JSON.stringify({ ...metadata, format: FORMAT, state: "draft" }),
        draft: true,
        prerelease: false,
      },
    })
    if (!Number.isSafeInteger(release?.id) || release.draft !== true) fail("RELEASE")
    for (const file of files) {
      await this.upload(tag, file)
    }
    await this.verifyAssets(release, infos)
    const receipt = {
      format: FORMAT,
      kind: metadata.kind,
      identity: metadata.identity,
      verifiedAt: new Date().toISOString(),
      files: infos,
      verification: "github-roundtrip-sha256",
    }
    const receiptDir = await fs.mkdtemp(path.join(this.directory, "receipt-")),
      receiptFile = path.join(receiptDir, "receipt.json")
    await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    })
    await this.upload(tag, receiptFile)
    await this.verifyAssets(release, [await fileInfo(receiptFile)])
    const published = await this.api(`repos/${this.repository}/releases/${release.id}`, {
      method: "PATCH",
      body: {
        draft: false,
        body: JSON.stringify({
          ...metadata,
          format: FORMAT,
          state: "verified",
          verifiedAt: receipt.verifiedAt,
        }),
      },
    })
    if (published?.draft !== false) fail("RELEASE")
    return {
      release: published,
      receipt,
      manifest,
    }
  }
  async complete(release, identity) {
    const body = parseOwnedRelease(release)
    if (!body || release.draft || body.state !== "verified" || body.identity !== identity)
      fail("RELEASE")
    const receipt = await this.jsonAsset(release, "receipt.json"),
      manifest = await this.jsonAsset(release, "manifest.json")
    validateBackupManifest(body, manifest, receipt)
    const names = [...receipt.files.map((file) => file.name), "receipt.json"]
    if (
      !Array.isArray(release.assets) ||
      release.assets.length !== names.length ||
      new Set(release.assets.map((asset) => asset.name)).size !== names.length ||
      release.assets.some((asset) => !names.includes(asset.name))
    )
      fail("RELEASE")
    for (const file of receipt.files) {
      assertRelativePath(file.name)
      const asset = release.assets.find((asset) => asset.name === file.name)
      if (
        !validSha(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !asset ||
        asset.size !== file.bytes ||
        (asset.digest && asset.digest !== `sha256:${file.sha256}`)
      )
        fail("SHA")
      if (!asset.digest) {
        const local = await this.readAsset(release, file.name, { maxBytes: MAX_ASSET_BYTES })
        await verifyFile(local, file)
        await fs.rm(local)
      }
    }
    return { release, receipt, manifest }
  }
  async prune(now, { dryRun = false, archiveCleanup = "dry-run", archiveGraceDays = 30 } = {}) {
    if (!dryRun) await this.assertLease()
    const releases = await this.listReleases(),
      owned = [],
      archives = []
    let skippedUnverified = 0,
      archiveBlocked = false
    const snapshots = new Map()
    for (const release of releases) {
      const body = parseOwnedRelease(release)
      if (!body || body.state !== "verified" || release.draft) {
        // An interrupted or unknown owned snapshot may already reference an
        // archive. Collection stays closed until that release is reconciled.
        if (SNAPSHOT_TAG.test(release.tag_name || "")) archiveBlocked = true
        continue
      }
      if (body.kind === "snapshot") {
        try {
          const complete = await this.complete(release, body.identity)
          snapshots.set(release.tag_name, complete.manifest)
        } catch {
          skippedUnverified++
          archiveBlocked = true
          continue
        }
        owned.push({
          tag: release.tag_name,
          identity: body.identity,
          completedAt: body.completedAt,
          complete: true,
          id: release.id,
          bytes: release.assets.reduce((sum, asset) => sum + (asset.size || 0), 0),
        })
      } else if (body.kind === "archive") {
        try {
          await this.complete(release, body.identity)
          archives.push({
            tag: release.tag_name,
            id: release.id,
            createdAt: release.published_at || release.created_at || body.verifiedAt,
            metadata: body,
            unreferencedSince: body.unreferencedSince,
            bytes: release.assets.reduce((sum, asset) => sum + (asset.size || 0), 0),
          })
        } catch {
          /* Unverified archives are always retained. */
        }
      }
    }
    const plan = retentionPlan(owned, now)
    const references = new Set(
      plan.keep.flatMap((item) => snapshots.get(item.tag).archives.map((archive) => archive.tag)),
    )
    const unreferenced =
      !archiveBlocked && plan.keep.length
        ? archives.filter((archive) => !references.has(archive.tag))
        : []
    const quarantined = unreferenced.filter((archive) =>
      Number.isFinite(Date.parse(archive.unreferencedSince)),
    )
    const quarantineCandidates = unreferenced.filter(
      (archive) => !Number.isFinite(Date.parse(archive.unreferencedSince)),
    )
    const candidates = quarantined.filter(
      (archive) =>
        Number.isFinite(Date.parse(archive.createdAt)) &&
        Date.parse(archive.createdAt) < now - Math.max(30, archiveGraceDays) * 86400000 &&
        Date.parse(archive.unreferencedSince) < now - Math.max(30, archiveGraceDays) * 86400000,
    )
    if (!dryRun) for (const release of plan.remove) await this.removeOwnedRelease(release)
    let removedArchives = 0,
      removedArchiveBytes = 0
    if (!dryRun && archiveCleanup === "apply") {
      if (!archiveBlocked && plan.keep.length) {
        // Quarantine begins when an archive is first observed without any
        // retained reference, never merely when the archive was created.
        for (const archive of archives) {
          const referenced = references.has(archive.tag)
          if ((referenced && archive.unreferencedSince) || quarantineCandidates.includes(archive)) {
            const metadata = { ...archive.metadata }
            if (referenced) delete metadata.unreferencedSince
            else metadata.unreferencedSince = new Date(now).toISOString()
            await this.api(`repos/${this.repository}/releases/${archive.id}`, {
              method: "PATCH",
              body: { body: JSON.stringify(metadata) },
            })
          }
        }
      }
      for (const archive of candidates) {
        // Re-read every remaining managed snapshot immediately before deletion.
        // Concurrent/new or incomplete snapshots protect all of their archives.
        let safe = true,
          count = 0
        for (const release of await this.listReleases()) {
          if (!SNAPSHOT_TAG.test(release.tag_name || "")) continue
          const body = parseOwnedRelease(release)
          if (!body || body.state !== "verified" || release.draft) {
            safe = false
            break
          }
          try {
            const checked = await this.complete(release, body.identity)
            count++
            if (checked.manifest.archives.some((reference) => reference.tag === archive.tag)) {
              safe = false
              break
            }
          } catch {
            safe = false
            break
          }
        }
        if (safe && count) {
          await this.removeOwnedRelease(archive)
          removedArchives++
          removedArchiveBytes += archive.bytes
        }
      }
    }
    return {
      dryRun,
      retained: plan.keep.length,
      removed: dryRun ? 0 : plan.remove.length,
      snapshotCandidates: plan.remove.map(({ tag, bytes }) => ({ tag, bytes })),
      skippedUnverified,
      archiveCleanup,
      archiveGraceDays: Math.max(30, archiveGraceDays),
      archiveBlocked,
      archiveCandidates: candidates.map(({ tag, bytes }) => ({ tag, bytes })),
      archiveCandidateBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
      archiveQuarantineCandidates: quarantineCandidates.map(({ tag, bytes }) => ({ tag, bytes })),
      quarantinedArchives: quarantined.length,
      removedArchives,
      retainedBytes:
        plan.keep.reduce((sum, item) => sum + item.bytes, 0) +
        archives.reduce((sum, item) => sum + item.bytes, 0) -
        removedArchiveBytes,
      immutableArchivesAlwaysRetained: false,
      archiveRetention: "all-retained-snapshot-references-plus-grace-period",
    }
  }
  async pinArchive(release) {
    await this.assertLease()
    const body = parseOwnedRelease(release)
    if (!body || body.kind !== "archive" || body.state !== "verified" || release.draft)
      fail("RELEASE")
    // Reuse may be followed by an interrupted snapshot upload. Clear the old
    // quarantine before publishing so its grace period cannot survive a new use.
    if (body.unreferencedSince) {
      const metadata = { ...body }
      delete metadata.unreferencedSince
      await this.api(`repos/${this.repository}/releases/${release.id}`, {
        method: "PATCH",
        body: { body: JSON.stringify(metadata) },
      })
    }
  }
  async removeOwnedRelease(release) {
    await this.assertLease()
    await this.api(`repos/${this.repository}/releases/${release.id}`, { method: "DELETE" })
    try {
      await this.assertLease()
      await this.api(`repos/${this.repository}/git/refs/tags/${encodeURIComponent(release.tag)}`, {
        method: "DELETE",
      })
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }
}
export function parseOwnedRelease(release) {
  try {
    const body = JSON.parse(release.body)
    if (
      body.format !== FORMAT ||
      !validSha(body.identity) ||
      body.tag !== release.tag_name ||
      !(
        (body.kind === "snapshot" && SNAPSHOT_TAG.test(body.tag)) ||
        (body.kind === "archive" && ARCHIVE_TAG.test(body.tag))
      )
    )
      return null
    return body
  } catch {
    return null
  }
}
export async function sourceArchive(repository, directory, store, runner = command) {
  const remote = `https://github.com/${repository}.git`,
    gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  const gitArgs = ["-c", "credential.helper=", "-c", "core.askPass=", "-c", "http.extraHeader="]
  const sourceMeta = await store.api(`repos/${repository}`)
  if (
    sourceMeta?.private !== false ||
    String(sourceMeta.full_name).toLowerCase() !== repository.toLowerCase()
  )
    fail("CONFIG")
  const identity = parseRemoteRefs(
    await runner("git", [...gitArgs, "ls-remote", "--symref", remote], { env: gitEnv }),
    repository,
  )
  const short = repository.split("/")[1].replaceAll("_", "-"),
    tag = `hn-offsite-archive-${short}-${identity.refsSha256.slice(0, 32)}`
  const existing = await store.release(tag)
  if (existing && !existing.draft) {
    const complete = await store.complete(existing, identity.refsSha256)
    const previous = complete.manifest.source
    const normalized = normalizedSource(previous)
    if (
      complete.manifest.kind !== "archive" ||
      previous.repository !== repository ||
      normalized.refsSha256 !== identity.refsSha256
    )
      fail("SHA")
    const bundle = complete.receipt.files.find((file) => file.name === "archive.gitbundle")
    if (!bundle || !sameAssetRecord(complete.manifest.bundle, bundle)) fail("SHA")
    await store.pinArchive?.(existing)
    return { ...normalized, tag, asset: { ...bundle } }
  }
  const archiveDir = await fs.mkdtemp(path.join(directory, "archive-")),
    mirror = path.join(archiveDir, "mirror.git"),
    file = path.join(archiveDir, "archive.gitbundle")
  await runner("git", [...gitArgs, "clone", "--mirror", "--no-hardlinks", remote, mirror], {
    env: gitEnv,
    maxBytes: 1024 * 1024,
  })
  const listing = await runner("git", [
      "-C",
      mirror,
      "for-each-ref",
      "--format=%(objectname) %(refname)",
    ]),
    symbolicRef = (await runner("git", ["-C", mirror, "symbolic-ref", "HEAD"])).trim(),
    sha = (await runner("git", ["-C", mirror, "rev-parse", "HEAD"])).trim()
  const actual = sourceIdentity(
    repository,
    listing
      .trim()
      .split("\n")
      .map((line) => {
        const [value, name] = line.split(" ")
        return { name, sha: value }
      }),
    { symbolicRef, sha },
  )
  if (actual.refsSha256 !== identity.refsSha256) fail("CHANGED")
  await runner("git", ["-C", mirror, "bundle", "create", file, "--all"], { maxBytes: 1024 * 1024 })
  await runner("git", ["-C", mirror, "bundle", "verify", file], { maxBytes: 32 * 1024 * 1024 })
  const heads = (await runner("git", ["bundle", "list-heads", file]))
    .trim()
    .split("\n")
    .map((line) => {
      const [sha, name] = line.split(" ")
      return { name, sha }
    })
  if (
    actual.refs.some(
      (ref) => !heads.some((head) => head.name === ref.name && head.sha === ref.sha),
    ) ||
    !heads.some((head) => head.name === "HEAD" && head.sha === actual.head.sha)
  )
    fail("CHANGED")
  const bundle = await fileInfo(file),
    manifest = {
      format: FORMAT,
      kind: "archive",
      identity: identity.refsSha256,
      source: actual,
      bundle,
      gitBundleVerified: true,
    },
    manifestFile = path.join(archiveDir, "manifest.json")
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  })
  await store.publish({ kind: "archive", identity: identity.refsSha256, tag }, [file, manifestFile])
  return { ...actual, tag, asset: bundle }
}
/** Archive private maintenance history and executable configuration, never release assets or Git credentials. */
export async function stageHandoffMaterials(
  materials,
  maintenanceRepository,
  directory,
  runner = command,
) {
  if (!maintenanceRepository) return materials
  const root = path.resolve(maintenanceRepository)
  if ((await fs.realpath(root)) !== root || path.resolve(materials) !== path.join(root, "handoff"))
    fail("PATH")
  if (
    (await runner("git", ["-C", root, "rev-parse", "--is-shallow-repository"])).trim() !== "false"
  )
    fail("CHANGED")
  const dirty = await runner("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"])
  if (dirty.trim()) fail("CHANGED")
  const staged = path.join(directory, "handoff-materials")
  await fs.mkdir(staged, { mode: 0o700 })
  async function copy(source, destination) {
    const stat = await fs.lstat(source)
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && !stat.isFile()) ||
      (stat.isFile() && stat.nlink !== 1)
    )
      fail("PATH")
    if (stat.isDirectory()) {
      await fs.mkdir(destination, { recursive: true, mode: 0o700 })
      for (const name of (await fs.readdir(source)).sort())
        await copy(path.join(source, name), path.join(destination, name))
    } else await fs.copyFile(source, destination, constants.COPYFILE_EXCL)
  }
  const tracked = (
    await runner("git", [
      "-C",
      root,
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      "HEAD",
      "--",
      "handoff/",
    ])
  )
    .split("\0")
    .filter(Boolean)
  if (!tracked.length) fail("PATH")
  for (const file of tracked) {
    assertRelativePath(file)
    if (!file.startsWith("handoff/")) fail("PATH")
    const destination = path.join(staged, file.slice("handoff/".length))
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await copy(path.join(root, file), destination)
  }
  const extra = path.join(staged, "maintenance")
  await fs.mkdir(extra, { mode: 0o700 })
  await copy(path.join(root, "backup.config.json"), path.join(extra, "backup.config.json"))
  await copy(path.join(root, ".github/workflows/backup.yml"), path.join(extra, "backup.yml"))
  const head = (await runner("git", ["-C", root, "rev-parse", "HEAD"])).trim()
  const refs = (
    await runner("git", [
      "-C",
      root,
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes/origin",
      "refs/tags",
    ])
  )
    .trim()
    .split("\n")
    .filter(
      (ref) =>
        ref &&
        ref !== "refs/remotes/origin/HEAD" &&
        !/^refs\/tags\/hn-offsite-/.test(ref) &&
        !/^refs\/(?:heads|remotes\/origin)\/hn-offsite-lock$/.test(ref),
    )
  const bundle = path.join(extra, "maintenance.gitbundle")
  await runner("git", ["-C", root, "bundle", "create", bundle, "HEAD", ...refs])
  await runner("git", ["-C", root, "bundle", "verify", bundle], { maxBytes: 32 * 1024 * 1024 })
  if (
    (await runner("git", ["-C", root, "rev-parse", "HEAD"])).trim() !== head ||
    (await runner("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"])).trim()
  )
    fail("CHANGED")
  await fs.writeFile(
    path.join(extra, "manifest.json"),
    JSON.stringify(
      {
        format: "howard-notes-maintenance-v1",
        head,
        refs,
        bundle: await fileInfo(bundle),
        excludes: [
          "release-assets",
          "hn-offsite-release-tags",
          "hn-offsite-lock-ref",
          "git-config",
          "credentials",
          "untracked-files",
        ],
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  )
  return staged
}
export async function runOffsiteBackup({
  config,
  repository,
  key,
  materials,
  maintenanceRepository,
  dryRun = false,
  fetcher = fetch,
  runner = command,
  now = Date.now(),
  tempRoot = os.tmpdir(),
  storeFactory = (repo, dir) => new GitHubBackupStore(repo, dir, runner),
}) {
  config = validateConfiguration(config)
  repositoryName(repository)
  const directory = await fs.mkdtemp(path.join(tempRoot, "howard-offsite-"))
  await fs.chmod(directory, 0o700)
  let store,
    leased = false
  try {
    store = storeFactory(repository, directory)
    await store.assertPrivate()
    if (dryRun)
      return {
        complete: false,
        dryRun: true,
        retention: await store.prune(now, { ...config.retention, dryRun: true }),
      }
    await store.acquireLease()
    leased = true
    const latest = await fetchBackupStatus(config.siteBase, key, { fetcher, now })
    const contentFile = path.join(directory, "content.hnbackup"),
      content = await downloadContentBackup(config.siteBase, key, latest.id, contentFile, {
        fetcher,
      })
    const handoffFile = path.join(directory, "handoff.tar"),
      handoff = await createHandoffTar(
        await stageHandoffMaterials(
          materials || path.resolve(config.handoffDirectory),
          maintenanceRepository,
          directory,
          runner,
        ),
        handoffFile,
      )
    const archives = []
    for (const source of config.sourceRepositories)
      archives.push(await sourceArchive(source, directory, store, runner))
    const identity = hash(
      JSON.stringify({
        snapshot: latest.id,
        contentSha256: content.sha256,
        handoffSha256: handoff.sha256,
        archives: archives.map((archive) => ({
          repository: archive.repository,
          refsSha256: archive.refsSha256,
        })),
      }),
    )
    const tag = `hn-offsite-snapshot-${latest.completedAt.slice(0, 10)}-${identity.slice(0, 24)}`
    const existing = await store.release(tag)
    if (existing && !existing.draft) {
      await store.complete(existing, identity)
      const retention = await store.prune(now, config.retention)
      return {
        complete: true,
        noOp: true,
        snapshot: latest.id,
        tag,
        sourceArchives: archives.length,
        retention,
      }
    }
    const manifest = {
        format: FORMAT,
        kind: "snapshot",
        identity,
        snapshot: latest,
        createdAt: new Date(now).toISOString(),
        content,
        handoff,
        archives,
        verification: {
          framing: true,
          githubRoundtripSha256: true,
          ciphertextAuthenticated: false,
        },
        retention: {
          ...config.retention,
          archiveRetention: "all-retained-snapshot-references-plus-grace-period",
        },
      },
      manifestFile = path.join(directory, "manifest.json")
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    })
    await store.publish({ kind: "snapshot", identity, tag, completedAt: latest.completedAt }, [
      contentFile,
      handoffFile,
      manifestFile,
    ])
    let retention
    try {
      retention = await store.prune(now, config.retention)
    } catch {
      fail("RETENTION")
    }
    return {
      complete: true,
      noOp: false,
      snapshot: latest.id,
      tag,
      sourceArchives: archives.length,
      retention,
    }
  } finally {
    if (leased) await store.releaseLease().catch(() => {})
    await fs.rm(directory, { recursive: true, force: true })
  }
}
