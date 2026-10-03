import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

const code = /\.(?:js|mjs|css|wasm|woff2?|ttf|otf)$|(?:^|\/)workspace-[a-f0-9]{8,64}\.txt$/i
export const retentionPolicy = Object.freeze({
  minimumGenerations: 3,
  maximumGenerations: 8,
  windowHours: 24,
})
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const normalize = (value) => value.replaceAll("\\", "/")
export const manifestName = "deployment-manifest.json"

export function assetReferences(text, parent, site) {
  const base = new URL(site)
  const found = new Set()
  for (const match of text.matchAll(
    /["'(=]\s*([^\s"'<>`(){};,]+\.(?:m?js|css|wasm|woff2?|ttf|otf|txt)(?![\w.-])(?:\?[^\s"'<>`(){};,]*)?)/gi,
  )) {
    let value = match[1].replaceAll("&amp;", "&")
    if (!/^[A-Za-z0-9_./:@?=&%+-]+$/.test(value)) continue
    if (
      /\.txt(?:\?|$)/i.test(value) &&
      !/(?:^|\/)workspace-[a-f0-9]{8,64}\.txt(?:\?|$)/i.test(value)
    )
      continue
    // Bundled libraries also contain filenames for optional, unused adapters.
    // Actual bundled imports are relative/absolute URLs or hashed asset names.
    if (
      /\.m?js$/.test(new URL(parent).pathname) &&
      !/^(?:\.{0,2}\/|https?:|admin\/|maintenance-assets\/|memory-assets\/|static\/)/.test(value) &&
      !/-(?:[a-f0-9]{8,}|[A-Z0-9]{3,})\.(?:m?js|css|wasm|txt)(?:\?|$)/.test(value)
    )
      continue
    // esbuild retains package-module labels as strings; they are not network imports.
    if (/(?:^|\/)node_modules\//.test(value)) continue
    if (/^(?:admin|maintenance-assets|memory-assets|static)\//.test(value))
      value = new URL(value, base).href
    let url
    try {
      url = new URL(value, parent)
    } catch {
      continue
    }
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      /(?:^|\/)\.\.(?:\/|$)/.test(decodeURIComponent(url.pathname))
    )
      continue
    url.search = ""
    url.hash = ""
    found.add(url.href)
  }
  return [...found]
}

export async function localAssetManifest(directory, commit = "unknown", now = Date.now()) {
  const files = []
  async function walk(relative = "") {
    for (const item of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = normalize(path.join(relative, item.name))
      if (item.isDirectory()) await walk(name)
      else if (code.test(name)) {
        const bytes = await fs.readFile(path.join(directory, name))
        files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) })
      }
    }
  }
  await walk()
  return {
    version: 1,
    commit,
    createdAt: new Date(now).toISOString(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }
}

function safeEntry(entry) {
  return (
    entry &&
    typeof entry.path === "string" &&
    /^[A-Za-z0-9_./-]+$/.test(entry.path) &&
    code.test(entry.path) &&
    !entry.path.startsWith("/") &&
    !entry.path.split("/").some((part) => ["", ".", ".."].includes(part)) &&
    /^[a-f0-9]{64}$/.test(entry.sha256) &&
    Number.isSafeInteger(entry.bytes) &&
    entry.bytes >= 0 &&
    entry.bytes <= 25 * 1024 * 1024
  )
}

export function generationIdentity(generation) {
  return digest(
    Buffer.from(JSON.stringify({ commit: generation.commit || "legacy", files: generation.files })),
  )
}
function generationOf(value, now) {
  if (
    !value ||
    !Array.isArray(value.files) ||
    value.files.length > 5000 ||
    !value.files.every(safeEntry) ||
    new Set(value.files.map((entry) => entry.path)).size !== value.files.length ||
    (value.createdAt !== undefined &&
      (!Number.isFinite(Date.parse(value.createdAt)) ||
        Date.parse(value.createdAt) > now + 5 * 60_000))
  )
    throw new Error("线上历史资源清单不正确，已停止部署。")
  return {
    commit: typeof value.commit === "string" ? value.commit : "legacy",
    createdAt: value.createdAt || new Date(now).toISOString(),
    files: value.files,
  }
}
/** At least two prior online generations, plus recent history up to a fixed cap. */
export function retainedGenerations(manifest, now = Date.now(), nextGeneration = null) {
  if (
    !Array.isArray(manifest.previousGenerations || []) ||
    (manifest.previousGenerations?.length || 0) > 7
  )
    throw new Error("线上历史版本数量不正确，已停止部署。")
  const seen = new Set(),
    candidates = []
  for (const value of [manifest, ...(manifest.previousGenerations || [])]) {
    const generation = generationOf(value, now),
      id = generationIdentity(generation)
    if (!seen.has(id) && (!nextGeneration || id !== generationIdentity(nextGeneration))) {
      seen.add(id)
      candidates.push(generation)
    }
  }
  const selected = candidates.filter(
    (generation, index) =>
      index < retentionPolicy.minimumGenerations - 1 ||
      Date.parse(generation.createdAt) >= now - retentionPolicy.windowHours * 3600000,
  )
  return {
    generations: selected.slice(0, retentionPolicy.maximumGenerations - 1),
    historyLimited: selected.length > retentionPolicy.maximumGenerations - 1,
  }
}

export function initialResumeMode(prepared, online, state) {
  if (JSON.stringify(online) !== JSON.stringify(prepared))
    throw new Error("首次部署期间线上资源已有变化，不能复用旧准备状态。")
  if (state?.revision === 0 && !state.commit) return "empty"
  if (
    Number.isSafeInteger(state?.revision) &&
    state.revision > 0 &&
    typeof state.commit === "string" &&
    state.commit
  )
    return "published"
  throw new Error("无法核实首次部署的内容状态，已停止恢复。")
}

/** Initial publication must never be a shortcut around retaining a live site. */
export async function assertInitialSiteEmpty({ site, api, fetcher = fetch }) {
  const urls = [
    new URL(site),
    new URL(manifestName, site),
    new URL(`${api.replace(/\/$/, "")}/status`),
  ]
  const responses = await Promise.allSettled(
    urls.map((url) =>
      fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) }),
    ),
  )
  if (responses.some((result) => result.status !== "fulfilled"))
    throw new Error("无法确认初始站点为空；网络错误不能用于跳过线上资源保留。")
  const [page, manifest, status] = responses.map((result) => result.value)
  if (page.status !== 404 || manifest.status !== 404)
    throw new Error("站点已有页面或部署资源，禁止使用 --initial；请保留现有线上版本后部署。")
  if (status.status === 404) return true
  if (status.ok) {
    const state = await status.json()
    if (state.revision === 0 && !state.commit) return true
  }
  throw new Error("无法确认初始内容库为空，已停止部署。")
}

// Online state is authoritative. Local staging directories are only byte caches,
// never a reason to discard the scripts still named by the live D1 shell.
export async function captureDeployedAssets({
  site,
  api,
  destination,
  caches = [],
  fetcher = fetch,
  now = Date.now(),
  nextGeneration = null,
}) {
  const base = new URL(site)
  const fetched = new Map(),
    pending = [],
    checks = new Map()
  const inventory = []
  let totalBytes = 0
  let history = { generations: [], historyLimited: false }
  const read = async (url, optional = false) => {
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    })
    if (optional && response.status === 404) return null
    if (!response.ok)
      throw new Error(`无法保留线上资源 (${response.status}): ${new URL(url).pathname}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 25 * 1024 * 1024) throw new Error("单个线上资源超过保留大小限制。")
    return bytes
  }
  const add = (url) => {
    if (!fetched.has(url) && !pending.includes(url)) pending.push(url)
  }
  const manifestBytes = await read(new URL(manifestName, base), true)
  if (manifestBytes) {
    let manifest
    try {
      manifest = JSON.parse(manifestBytes.toString())
    } catch {
      throw new Error("线上部署清单无法解析，已停止部署。")
    }
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > 5000 ||
      !manifest.files.every(safeEntry)
    )
      throw new Error("线上部署清单格式不正确，已停止部署。")
    history = retainedGenerations(manifest, now, nextGeneration)
    // Mutable compatibility aliases have one online value. The most recent
    // inventory wins; immutable hashed paths preserve every selected generation.
    for (const generation of [generationOf(manifest, now), ...history.generations])
      for (const entry of generation.files) {
        const url = new URL(entry.path, base).href
        if (!checks.has(url)) {
          checks.set(url, entry)
          add(url)
        }
      }
  }
  // The manifest covers lazily imported chunks. The live shell also pins an older
  // reading generation when a previous deploy has not finished switching D1.
  const roots = [
    [new URL(`${api.replace(/\/$/, "")}/shell`), base],
    [new URL("admin/", base), new URL("admin/", base)],
    [new URL("maintenance-assets/manifest.json", base), new URL("maintenance-assets/", base)],
    [new URL("memory-assets/manifest.json", base), new URL("memory-assets/", base)],
  ]
  for (const [url, parent] of roots) {
    const bytes = await read(url)
    let text = bytes.toString()
    if (url.pathname.endsWith("/shell")) {
      const shell = JSON.parse(text)
      text = [shell.head, shell.postscript, shell.headerWidgets, shell.graphControls].join("\n")
    }
    for (const ref of assetReferences(text, parent, base)) add(ref)
  }
  while (pending.length) {
    if (fetched.size + pending.length > 5000) throw new Error("线上资源数量超过保留限制。")
    const batch = pending.splice(0, 6)
    for (const url of batch) fetched.set(url, true)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const name = decodeURIComponent(new URL(url).pathname.slice(base.pathname.length))
        if (!name || name.split("/").some((part) => ["", ".", ".."].includes(part)))
          throw new Error("线上资源路径不正确。")
        const expected = checks.get(url)
        let bytes
        if (expected)
          for (const cache of caches) {
            try {
              const candidate = await fs.readFile(path.join(cache, name))
              if (candidate.length === expected.bytes && digest(candidate) === expected.sha256) {
                bytes = candidate
                break
              }
            } catch (error) {
              if (error.code !== "ENOENT") throw error
            }
          }
        bytes ||= await read(url)
        if (expected && (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256))
          throw new Error(`线上资源完整性不匹配: ${name}`)
        totalBytes += bytes.length
        if (totalBytes > 200 * 1024 * 1024) throw new Error("线上资源总量超过保留限制。")
        await fs.mkdir(path.dirname(path.join(destination, name)), { recursive: true })
        await fs.writeFile(path.join(destination, name), bytes)
        inventory.push({ path: name, bytes: bytes.length, sha256: digest(bytes), url })
        if (/\.(?:js|mjs|css)$/i.test(name))
          for (const ref of assetReferences(bytes.toString(), url, base)) add(ref)
      }),
    )
    const failed = results.find((result) => result.status === "rejected")
    if (failed) throw failed.reason
  }
  const additional = inventory
    .filter((entry) => code.test(entry.path) && !checks.has(entry.url))
    .map(({ url: _url, ...entry }) => entry)
  if (!history.generations.length && additional.length) {
    history.generations.push({
      commit: "legacy-online",
      createdAt: new Date(now).toISOString(),
      files: additional.sort((a, b) => a.path.localeCompare(b.path)),
    })
  } else if (additional.length) {
    // A failed previous deployment may leave a D1 shell older than its asset
    // manifest. Carry the dependencies discovered from that live shell forward.
    history.generations[0] = {
      ...history.generations[0],
      files: [...history.generations[0].files, ...additional].sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
    }
  }
  return { files: fetched.size, bytes: totalBytes, ...history }
}
