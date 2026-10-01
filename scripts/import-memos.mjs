import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import YAML from "yaml"

// API contract: https://github.com/usememos/memos/tree/v0.22.5/proto/api/v1
// Source responses and Markdown stay under ignored .local, never in the public vault.
export const MEMOS_VERSION = "0.22.5"
export const FILE_CHUNK_BYTES = 600 * 1024
class ImportError extends Error {}
const MAX_BODY_BYTES = 1_850_000
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const jsonBytes = (value) => Buffer.from(JSON.stringify(value))
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value
const valueHash = (value) => digest(jsonBytes(canonical(value)))
const originOf = (value) => {
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new ImportError("来源地址必须是无凭据的 HTTP 或 HTTPS 地址。")
  return url.origin
}
const sourceName = (value, prefix) => {
  if (typeof value !== "string" || !new RegExp(`^${prefix}/[a-zA-Z0-9_-]+$`).test(value))
    throw new ImportError("来源标识格式不正确。")
  return value
}
const localFile = (directory, relative) => {
  const root = path.resolve(directory)
  const result = path.resolve(root, relative)
  if (!result.startsWith(root + path.sep)) throw new ImportError("本地导出文件路径不正确。")
  return result
}
const writePrivate = async (file, bytes) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, bytes, { mode: 0o600 })
  await fs.chmod(file, 0o600)
}
const writeJson = (file, value) => writePrivate(file, JSON.stringify(value, null, 2) + "\n")
const writePrivateAtomic = async (file, bytes) => {
  const pending = `${file}.${process.pid}.pending`
  await writePrivate(pending, bytes)
  await fs.rename(pending, file)
}
const writeJsonAtomic = (file, value) =>
  writePrivateAtomic(file, JSON.stringify(value, null, 2) + "\n")
const list = (value, field) => {
  if (!value || !Array.isArray(value[field])) {
    // protobuf omits empty repeated fields by default.
    if (value && typeof value === "object" && value[field] == null) return []
    throw new ImportError("来源列表格式不正确。")
  }
  return value[field]
}
const validDate = (value) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new ImportError("来源时间缺失或不正确，导出不能被导入。")
  return value
}
async function verifyCachedMemo(directory, entry, accountName) {
  sourceName(entry.sourceId, "memos")
  const exported = JSON.parse(await fs.readFile(localFile(directory, entry.file), "utf8"))
  const content = await fs.readFile(localFile(directory, entry.contentFile))
  const { memo } = exported
  if (
    memo.name !== entry.sourceId ||
    memo.creator !== accountName ||
    digest(content) !== entry.contentSha256 ||
    valueHash(memo) !== entry.sourceSha256 ||
    valueHash(exported) !== entry.metadataSha256 ||
    typeof memo.content !== "string" ||
    !content.equals(Buffer.from(memo.content, "utf8"))
  )
    throw new ImportError("Memos 缓存原文或元信息校验失败。")
  return exported
}
async function verifyCachedResource(directory, entry) {
  sourceName(entry.sourceId, "resources")
  const resource = JSON.parse(await fs.readFile(localFile(directory, entry.metadataFile), "utf8"))
  const bytes = await fs.readFile(localFile(directory, entry.file))
  if (
    digest(bytes) !== entry.sha256 ||
    bytes.length !== entry.size ||
    resource.name !== entry.sourceId ||
    valueHash(resource) !== entry.metadataSha256
  )
    throw new ImportError("Memos 缓存附件校验失败。")
  return { ...entry, resource }
}
const retryStatuses = new Set([429, 502, 503, 504])
const safeNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_ABORTED",
])
const safeNetworkError = (error) => {
  const name = ["Error", "TypeError", "AbortError", "TimeoutError"].includes(error?.name)
    ? error.name
    : "Error"
  const code = [error?.code, error?.cause?.code].find((value) => safeNetworkCodes.has(value))
  return code ? `${name}/${code}` : name
}
const sourcePhase = (route) => {
  if (route === "/api/v1/auth/signin") return "signin"
  if (route === "/api/v1/auth/status") return "auth-status"
  if (route.startsWith("/api/v1/memos?")) return "memo-pages"
  if (/^\/api\/v1\/memos\/[^/]+\/(resources|relations|comments|reactions)$/.test(route))
    return "memo-metadata"
  if (route === "/api/v1/resources") return "resource-list"
  return "source-metadata"
}
/** Retry only caller-approved idempotent requests, never logging URLs, bodies or errors' messages. */
async function fetchWithRetry({
  fetchImpl,
  url,
  options,
  retry,
  phase,
  service,
  allow500 = false,
}) {
  for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(90000),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        if (
          retry &&
          attempt < 2 &&
          (retryStatuses.has(response.status) || (allow500 && response.status === 500))
        ) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
          continue
        }
        return { response }
      }
      // Read the complete body inside the retry boundary to also handle interrupted downloads.
      const bytes = Buffer.from(await response.arrayBuffer())
      return { response, bytes }
    } catch (error) {
      if (!retry || attempt === 2)
        throw new ImportError(`${service}请求失败或超时（${phase}; ${safeNetworkError(error)}）。`)
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
  }
}

/** No source credentials or response bodies are included in errors or progress. */
function sourceClient({ sourceOrigin, username, password, fetchImpl, saveResponse }) {
  const origin = originOf(sourceOrigin)
  const cookies = new Map()
  const request = async (route, body, archive = true) => {
    const url = new URL(route, origin)
    if (url.origin !== origin) throw new ImportError("来源 API 请求必须同源。")
    const form = body instanceof URLSearchParams
    const phase = sourcePhase(route)
    const { response, bytes } = await fetchWithRetry({
      fetchImpl,
      url,
      retry: body == null,
      phase,
      service: "Memos 来源",
      options: {
        method: body == null ? "GET" : "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...(body == null
            ? {}
            : {
                "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
              }),
        },
        body: body == null ? undefined : form ? body.toString() : JSON.stringify(body),
      },
    })
    if (!response.ok)
      throw new ImportError(`Memos 来源接口返回 HTTP ${response.status}（${phase}）。`)
    // The v0.22.5 default gateway forwards gRPC Set-Cookie metadata under this header.
    // Keep only cookie pairs in memory; attributes and responses are never persisted.
    const cookieHeaders = [
      ...(response.headers.getSetCookie?.() ?? []),
      ...(response.headers.get("Set-Cookie") && !response.headers.getSetCookie
        ? [response.headers.get("Set-Cookie")]
        : []),
      ...(response.headers.get("Grpc-Metadata-Set-Cookie")
        ? [response.headers.get("Grpc-Metadata-Set-Cookie")]
        : []),
    ]
    for (const cookie of cookieHeaders.flatMap((value) => value.split(/,\s*(?=[^\s;,=]+=[^;]*)/))) {
      const pair = cookie.split(";", 1)[0].trim()
      const index = pair.indexOf("=")
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    let result
    try {
      result = JSON.parse(bytes.toString("utf8"))
    } catch {
      throw new ImportError("Memos 来源响应不是有效 JSON。")
    }
    if (archive) await saveResponse(route, bytes)
    return result
  }
  return {
    origin,
    request,
    async login() {
      if (!password) throw new ImportError("请通过 MEMOS_PASSWORD 提供密码。")
      // Exactly one login attempt. A rejected password is never retried.
      const user = await request(
        "/api/v1/auth/signin",
        // This pinned gateway uses req.ParseForm, so JSON bodies are ignored.
        new URLSearchParams({ username, password, neverExpire: "false" }),
        false,
      )
      const verified = await request("/api/v1/auth/status", {}, false)
      if (!cookies.size || user.name !== verified.name || verified.username !== username)
        throw new ImportError("Memos 登录身份验证不一致。")
      sourceName(verified.name, "users")
      return verified
    },
    async binary(value) {
      let url = new URL(value, origin)
      if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        throw new ImportError("来源附件地址不正确。")
      // Follow redirects manually: the Memos cookie is never forwarded to S3 or another host.
      for (let redirects = 0; redirects < 6; redirects++) {
        const { response, bytes } = await fetchWithRetry({
          fetchImpl,
          url,
          retry: true,
          phase: "resource-file",
          service: "Memos 附件",
          options: {
            redirect: "manual",
            headers:
              url.origin === origin && cookies.size
                ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
                : {},
          },
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = response.headers.get("Location")
          if (!next) throw new ImportError("来源附件重定向不正确。")
          url = new URL(next, url)
          if (!/^https?:$/.test(url.protocol) || url.username || url.password)
            throw new ImportError("来源附件重定向地址不正确。")
          continue
        }
        if (!response.ok) throw new ImportError(`Memos 附件接口返回 HTTP ${response.status}。`)
        return bytes
      }
      throw new ImportError("来源附件重定向过多。")
    },
  }
}

/** Export both row statuses, all comments and every account resource before importing. */
export async function exportMemos({
  sourceOrigin = "http://139.224.225.116:5230",
  username = "Howard",
  password,
  outputDirectory,
  fetchImpl = fetch,
  pageSize = 100,
  onProgress = () => {},
  resume = false,
}) {
  if (!outputDirectory) throw new ImportError("请指定本地导出目录。")
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new ImportError("来源分页数量不正确。")
  const directory = path.resolve(outputDirectory)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const manifestFile = path.join(directory, "manifest.json")
  let previous
  if (resume) {
    previous = JSON.parse(await fs.readFile(manifestFile, "utf8"))
    if (
      previous.version !== 1 ||
      previous.memosVersion !== MEMOS_VERSION ||
      previous.complete ||
      originOf(previous.sourceOrigin) !== originOf(sourceOrigin) ||
      previous.account?.username !== username ||
      !Array.isArray(previous.memos) ||
      !Array.isArray(previous.resources) ||
      !Array.isArray(previous.responses)
    )
      throw new ImportError("恢复导出的来源、账号或未完成清单不正确。")
    sourceName(previous.account.name, "users")
    const memoIds = new Set(),
      resourceIds = new Set()
    for (const entry of previous.memos) {
      if (memoIds.has(entry.sourceId)) throw new ImportError("恢复清单包含重复记录。")
      memoIds.add(entry.sourceId)
      await verifyCachedMemo(directory, entry, previous.account.name)
    }
    for (const entry of previous.resources) {
      if (resourceIds.has(entry.sourceId)) throw new ImportError("恢复清单包含重复附件。")
      resourceIds.add(entry.sourceId)
      await verifyCachedResource(directory, entry)
    }
    for (const entry of previous.responses) {
      const bytes = await fs.readFile(localFile(directory, entry.file))
      if (digest(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
        throw new ImportError("恢复清单的原始响应校验失败。")
    }
    onProgress({
      phase: "resume-cache-verified",
      memos: previous.memos.length,
      resources: previous.resources.length,
    })
  } else
    try {
      await fs.access(manifestFile)
      throw new ImportError("导出目录已有记录，请使用新的目录。")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  let responseCount = Math.max(
    0,
    ...(previous?.responses || []).map(
      (entry) => Number(/^responses\/(\d+)-/.exec(entry.file)?.[1]) || 0,
    ),
  )
  const responses = [...(previous?.responses || [])]
  const cachedMemos = new Map((previous?.memos || []).map((entry) => [entry.sourceId, entry]))
  const cachedResources = new Map(
    (previous?.resources || []).map((entry) => [entry.sourceId, entry]),
  )
  const client = sourceClient({
    sourceOrigin,
    username,
    password,
    fetchImpl,
    async saveResponse(route, bytes) {
      const file = `responses/${String(++responseCount).padStart(6, "0")}-${digest(route).slice(0, 12)}.json`
      await writePrivate(localFile(directory, file), bytes)
      responses.push({ file, sha256: digest(bytes), bytes: bytes.length })
    },
  })
  const account = await client.login()
  if (previous && previous.account.name !== account.name)
    throw new ImportError("恢复导出的账号身份不一致。")
  const profile = await client.request("/api/v1/workspace/profile")
  if (String(profile.version).replace(/^v/, "") !== MEMOS_VERSION)
    throw new ImportError("Memos 来源版本与已验证的 0.22.5 API 不一致。")
  const manifest = {
    version: 1,
    memosVersion: MEMOS_VERSION,
    sourceOrigin: client.origin,
    exportedAt: previous?.exportedAt || new Date().toISOString(),
    ...(resume ? { resumedAt: new Date().toISOString() } : {}),
    complete: false,
    account,
    memos: [...cachedMemos.values()],
    resources: [...cachedResources.values()],
    metadata: previous?.metadata || {},
    responses,
    counts: {
      normal: 0,
      archived: 0,
      comments: 0,
      relatedComments: 0,
      resources: 0,
      orphanResources: 0,
    },
  }
  const checkpoint = () => writeJsonAtomic(manifestFile, manifest)
  await checkpoint()
  const collect = async (status) => {
    const memos = new Map(),
      tokens = new Set()
    let token = "",
      pages = 0
    do {
      const query = new URLSearchParams({
        pageSize: String(pageSize),
        filter: `creator == "${account.name}" && row_status == "${status}" && include_comments == true`,
      })
      if (token) query.set("pageToken", token)
      const page = await client.request(`/api/v1/memos?${query}`)
      pages++
      for (const memo of list(page, "memos")) {
        sourceName(memo.name, "memos")
        // CEL filters use store NORMAL while the v0.22.5 protobuf enum returns ACTIVE.
        if (
          memo.creator !== account.name ||
          memo.rowStatus !== (status === "NORMAL" ? "ACTIVE" : status)
        )
          throw new ImportError("来源列表未遵守账号与归档筛选，不能确认完整性。")
        if (memos.has(memo.name)) throw new ImportError("来源分页返回重复记录，不能确认完整性。")
        memos.set(memo.name, memo)
      }
      token = page.nextPageToken || page.next_page_token || ""
      if (typeof token !== "string" || (token && tokens.has(token)))
        throw new ImportError("来源分页令牌不正确或重复，导出未完成。")
      if (token) tokens.add(token)
      onProgress({ phase: "memo-pages", status, pages, count: memos.size })
    } while (token)
    return memos
  }
  const first = new Map()
  for (const status of ["NORMAL", "ARCHIVED"])
    for (const [name, memo] of await collect(status)) {
      if (first.has(name)) throw new ImportError("来源记录在多个状态中重复。")
      first.set(name, memo)
    }
  const resources = new Map()
  // v0.22.5 ListResources has no page token or limit and returns this account's complete list.
  const accountResources = list(await client.request("/api/v1/resources"), "resources")
  for (const resource of accountResources) {
    sourceName(resource.name, "resources")
    if (resources.has(resource.name)) throw new ImportError("来源附件列表返回重复记录。")
    resources.set(resource.name, resource)
  }
  for (const name of cachedMemos.keys()) if (!first.has(name)) cachedMemos.delete(name)
  manifest.memos = [...cachedMemos.values()]
  let metadataCount = 0,
    reusedMemos = 0
  for (const memo of first.values()) {
    const resourcesResult = await client.request(`/api/v1/${memo.name}/resources`)
    const relationsResult = await client.request(`/api/v1/${memo.name}/relations`)
    const commentsResult = await client.request(`/api/v1/${memo.name}/comments`)
    const reactionsResult = await client.request(`/api/v1/${memo.name}/reactions`)
    const attached = list(resourcesResult, "resources")
    for (const resource of attached) resources.set(sourceName(resource.name, "resources"), resource)
    const comments = list(commentsResult, "memos")
    manifest.counts.relatedComments += comments.length
    for (const comment of comments) {
      if (comment.creator === account.name && !first.has(comment.name))
        throw new ImportError("评论接口发现未被分页导出的本人记录，完整性验证失败。")
    }
    const key = digest(memo.name).slice(0, 24)
    const originalBytes = Buffer.from(memo.content ?? "", "utf8")
    if (typeof memo.content !== "string") throw new ImportError("来源正文格式不正确。")
    const fullMemo = {
      memo,
      resources: attached,
      relations: list(relationsResult, "relations"),
      comments,
      reactions: list(reactionsResult, "reactions"),
    }
    const metadataSha256 = valueHash(fullMemo),
      contentSha256 = digest(originalBytes)
    const cached = cachedMemos.get(memo.name)
    const unchanged =
      cached?.metadataSha256 === metadataSha256 && cached?.contentSha256 === contentSha256
    const file = unchanged ? cached.file : `memos/${key}/${metadataSha256}.json`
    const contentFile = unchanged ? cached.contentFile : `memos/${key}/${contentSha256}.md`
    if (unchanged) reusedMemos++
    else {
      await writePrivateAtomic(localFile(directory, contentFile), originalBytes)
      await writeJsonAtomic(localFile(directory, file), fullMemo)
    }
    cachedMemos.set(memo.name, {
      sourceId: memo.name,
      file,
      contentFile,
      contentSha256,
      sourceSha256: valueHash(memo),
      metadataSha256,
    })
    manifest.memos = [...cachedMemos.values()]
    manifest.counts[memo.rowStatus === "ACTIVE" ? "normal" : "archived"]++
    if (
      memo.parent ||
      memo.parentId ||
      (memo.relations || []).some((r) => r.type === "COMMENT" && r.memo === memo.name)
    )
      manifest.counts.comments++
    metadataCount++
    if (metadataCount % 20 === 0 || metadataCount === first.size) {
      await checkpoint()
      onProgress({
        phase: "memo-metadata",
        count: metadataCount,
        total: first.size,
        reused: reusedMemos,
      })
    }
  }
  const ownedNames = new Set(first.keys())
  for (const name of cachedResources.keys()) if (!resources.has(name)) cachedResources.delete(name)
  manifest.resources = [...cachedResources.values()]
  let resourceCount = 0,
    reusedResources = 0
  for (const resource of resources.values()) {
    const metadataSha256 = valueHash(resource)
    const cached = cachedResources.get(resource.name)
    const unchanged = cached?.metadataSha256 === metadataSha256
    const metadataFile = unchanged
      ? cached.metadataFile
      : `resources/${digest(resource.name).slice(0, 24)}-${metadataSha256.slice(0, 24)}.json`
    const sourcePath = `/file/${resource.name}/${encodeURIComponent(resource.filename || "attachment")}`
    const sourceUrl = resource.externalLink || new URL(sourcePath, client.origin).href
    const bytes = unchanged
      ? await fs.readFile(localFile(directory, cached.file))
      : await client.binary(sourceUrl)
    if (unchanged) reusedResources++
    const expectedSize = Number(resource.size)
    if (Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize !== bytes.length)
      throw new ImportError("来源附件长度与元信息不一致，导出未完成。")
    const sha256 = digest(bytes)
    const file = `files/${sha256}.bin`
    if (!unchanged) {
      await writePrivateAtomic(localFile(directory, file), bytes)
      await writeJsonAtomic(localFile(directory, metadataFile), resource)
    }
    cachedResources.set(resource.name, {
      sourceId: resource.name,
      metadataFile,
      metadataSha256,
      file,
      sha256,
      size: bytes.length,
      fileId: `memos-file-${digest(`${client.origin}\0${resource.name}\0${sha256}`).slice(0, 48)}`,
      sourcePath,
      sourceUrl,
    })
    manifest.resources = [...cachedResources.values()]
    manifest.counts.resources = manifest.resources.length
    if (!resource.memo || !ownedNames.has(resource.memo)) manifest.counts.orphanResources++
    await checkpoint()
    resourceCount++
    onProgress({
      phase: "resource-files",
      count: resourceCount,
      total: resources.size,
      reused: reusedResources,
      bytes: bytes.length,
      sha256,
    })
  }
  manifest.counts.resources = manifest.resources.length
  for (const [name, route] of Object.entries({
    userSettings: `/api/v1/${account.name}/setting`,
    workspaceGeneral: "/api/v1/workspace/settings/GENERAL",
    workspaceMemo: "/api/v1/workspace/settings/MEMO_RELATED",
    properties: "/api/v1/memos/-/properties",
    tags: `/api/v1/memos/-/tags?${new URLSearchParams({ filter: `creator == "${account.name}"` })}`,
  }))
    manifest.metadata[name] = await client.request(route)
  await checkpoint()
  // Offset-based pagination can omit records if the instance changes while we export.
  // A second complete pass proves the source was stable, rather than silently accepting a partial dump.
  const verified = new Map()
  for (const status of ["NORMAL", "ARCHIVED"])
    for (const [name, memo] of await collect(status)) verified.set(name, memo)
  if (
    verified.size !== first.size ||
    [...first].some(([name, memo]) => valueHash(verified.get(name)) !== valueHash(memo))
  )
    throw new ImportError("导出期间来源记录发生变化，请重新导出以确保没有遗漏。")
  const verifiedResources = list(await client.request("/api/v1/resources"), "resources")
  if (
    valueHash([...verifiedResources].sort((a, b) => a.name.localeCompare(b.name))) !==
    valueHash([...accountResources].sort((a, b) => a.name.localeCompare(b.name)))
  )
    throw new ImportError("导出期间来源附件发生变化，请重新导出。")
  manifest.complete = true
  manifest.snapshotSha256 = valueHash({
    memos: manifest.memos.map((memo) => [memo.sourceId, memo.contentSha256, memo.sourceSha256]),
    resources: manifest.resources.map((resource) => [resource.sourceId, resource.sha256]),
  })
  await checkpoint()
  return { directory, counts: manifest.counts, snapshotSha256: manifest.snapshotSha256 }
}

/** Preserve source Markdown and complete metadata for owner-only API access. */
export async function readMemosExport(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"))
  if (manifest.version !== 1 || !manifest.complete || manifest.memosVersion !== MEMOS_VERSION)
    throw new ImportError("Memos 本地导出未完成或版本不正确。")
  const sourceOrigin = originOf(manifest.sourceOrigin)
  for (const response of manifest.responses) {
    const bytes = await fs.readFile(localFile(directory, response.file))
    if (digest(bytes) !== response.sha256 || bytes.length !== response.bytes)
      throw new ImportError("Memos 原始响应校验失败。")
  }
  const resources = new Map()
  for (const entry of manifest.resources) {
    const resource = JSON.parse(await fs.readFile(localFile(directory, entry.metadataFile), "utf8"))
    const bytes = await fs.readFile(localFile(directory, entry.file))
    if (
      digest(bytes) !== entry.sha256 ||
      bytes.length !== entry.size ||
      resource.name !== entry.sourceId ||
      valueHash(resource) !== entry.metadataSha256
    )
      throw new ImportError("Memos 本地附件校验失败。")
    resources.set(entry.sourceId, { ...entry, resource })
  }
  const cards = []
  for (const entry of manifest.memos) {
    const exported = JSON.parse(await fs.readFile(localFile(directory, entry.file), "utf8"))
    const { memo } = exported
    const content = await fs.readFile(localFile(directory, entry.contentFile))
    if (
      memo.name !== entry.sourceId ||
      memo.creator !== manifest.account.name ||
      digest(content) !== entry.contentSha256 ||
      valueHash(memo) !== entry.sourceSha256 ||
      valueHash(exported) !== entry.metadataSha256 ||
      !content.equals(Buffer.from(memo.content, "utf8"))
    )
      throw new ImportError("Memos 原文或元信息校验失败。")
    if (
      !["ACTIVE", "ARCHIVED"].includes(memo.rowStatus) ||
      !["PUBLIC", "PROTECTED", "PRIVATE"].includes(memo.visibility)
    )
      throw new ImportError("Memos 来源状态或可见性不正确。")
    const names = new Set(exported.resources.map((resource) => resource.name))
    for (const [name, resource] of resources) {
      if (
        resource.resource.memo === memo.name ||
        memo.content.includes(resource.sourcePath) ||
        (resource.resource.externalLink && memo.content.includes(resource.resource.externalLink))
      )
        names.add(name)
    }
    const attachments = [...names].map((name) => {
      const exported = resources.get(name)
      if (!exported) throw new ImportError("Memos 关联附件缺失。")
      const { resource } = exported
      return {
        id: name,
        fileId: exported.fileId,
        name: resource.filename || "attachment",
        filename: resource.filename || "attachment",
        mimeType: resource.type || "application/octet-stream",
        type: resource.type,
        size: exported.size,
        sourcePath: exported.sourcePath,
        sourceUrl: exported.sourceUrl,
        externalLink: resource.externalLink,
      }
    })
    cards.push({
      sourceId: memo.name,
      content: memo.content,
      created: validDate(memo.createTime),
      modified: validDate(memo.updateTime),
      status: memo.rowStatus === "ACTIVE" ? "NORMAL" : "ARCHIVED",
      visibility: memo.visibility,
      tags: memo.tags?.length ? memo.tags : memo.property?.tags || [],
      pinned: Boolean(memo.pinned),
      attachments,
      relations: exported.relations,
      raw: exported,
      source: {
        id: memo.name,
        origin: sourceOrigin,
        uid: memo.uid,
        creator: memo.creator,
        displayTime: memo.displayTime,
        parent: memo.parent,
        parentId: memo.parentId,
      },
    })
  }
  const unique = new Set(cards.map((card) => card.sourceId))
  if (unique.size !== cards.length) throw new ImportError("Memos 本地导出包含重复记录。")
  const linked = new Set(
    cards.flatMap((card) => card.attachments.map((attachment) => attachment.fileId)),
  )
  return {
    manifest,
    sourceOrigin,
    cards,
    resources: [...resources.values()].filter((entry) => linked.has(entry.fileId)),
  }
}

export async function importMemosExport({
  directory,
  apiBase,
  token,
  syncKey,
  fetchImpl = fetch,
  onProgress = () => {},
}) {
  const exported = await readMemosExport(directory)
  if (!token || !syncKey) throw new ImportError("导入需要已登录的 GitHub 账号和内容同步授权。")
  const api = new URL(apiBase.endsWith("/") ? apiBase : apiBase + "/")
  if (!/^https?:$/.test(api.protocol) || api.username || api.password)
    throw new ImportError("目标 API 地址不正确。")
  const request = async (route, body) => {
    const importing = ["memories/import", "memories/import/files"].includes(route)
    const phase = importing
      ? route.endsWith("/files")
        ? "upload-file"
        : "upload-cards"
      : route.includes("/files/")
        ? "verify-files"
        : "verify-cards"
    const { response, bytes } = await fetchWithRetry({
      fetchImpl,
      url: new URL(route, api),
      retry: body == null || importing,
      allow500: importing,
      phase,
      service: "记忆卡目标接口",
      options: {
        method: body == null ? "GET" : "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body == null
            ? {}
            : { "Content-Type": "application/json", "X-Howard-Sync-Key": syncKey }),
        },
        body: body == null ? undefined : JSON.stringify(body),
      },
    })
    if (!response.ok)
      throw new ImportError(`记忆卡目标接口返回 HTTP ${response.status}（${phase}）。`)
    return new Response(bytes, { status: response.status, headers: response.headers })
  }
  for (const card of exported.cards) {
    if (
      jsonBytes(card).length > 1_750_000 ||
      card.attachments.length > 1000 ||
      card.tags.length > 200
    )
      throw new ImportError("来源记忆卡超过目标接口大小上限，本地原文仍完整保留。")
  }
  for (const resource of exported.resources) {
    if (resource.size > 100 * 1024 * 1024 || (resource.resource.filename || "").length > 500)
      throw new ImportError("附件超过目标接口上限，本地原始文件仍完整保留。")
  }
  const stats = {
    imported: 0,
    unchanged: 0,
    files: 0,
    bytes: 0,
    verifiedCards: 0,
    verifiedFiles: 0,
  }
  for (const resource of exported.resources) {
    if (resource.size > 100 * 1024 * 1024)
      throw new ImportError("附件超过目标接口的 100 MiB 上限，本地原始文件仍完整保留。")
    const bytes = await fs.readFile(localFile(directory, resource.file))
    const file = {
      id: resource.fileId,
      name: resource.resource.filename || "attachment",
      mimeType: resource.resource.type || "application/octet-stream",
      size: resource.size,
      sha256: resource.sha256,
      source: {
        origin: exported.sourceOrigin,
        id: resource.sourceId,
        memo: resource.resource.memo,
      },
    }
    const total = Math.max(1, Math.ceil(bytes.length / FILE_CHUNK_BYTES))
    let complete = false
    for (let index = 0; index < total; index++) {
      const result = await (
        await request("memories/import/files", {
          file,
          chunk: {
            index,
            total,
            data: bytes
              .subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES)
              .toString("base64"),
          },
        })
      ).json()
      if (result.id !== file.id) throw new ImportError("目标附件返回标识不一致。")
      if (result.complete) {
        complete = true
        break
      }
      onProgress({ phase: "upload-file", index: index + 1, total, sha256: file.sha256 })
    }
    if (!complete) throw new ImportError("目标附件分块未完成。")
    stats.files++
    stats.bytes += bytes.length
  }
  let batch = []
  const importedIds = []
  const flush = async () => {
    if (!batch.length) return
    const result = await (
      await request("memories/import", { sourceOrigin: exported.sourceOrigin, memories: batch })
    ).json()
    const ids = new Map((result.ids || []).map((entry) => [entry.sourceId, entry.id]))
    if (
      ids.size !== batch.length ||
      batch.some((card) => !ids.has(card.sourceId)) ||
      result.imported + result.unchanged !== batch.length
    )
      throw new ImportError("目标记忆卡导入数量不一致。")
    for (const card of batch) importedIds.push({ card, id: ids.get(card.sourceId) })
    stats.imported += result.imported
    stats.unchanged += result.unchanged
    onProgress({ phase: "upload-cards", imported: stats.imported, unchanged: stats.unchanged })
    batch = []
  }
  for (const card of exported.cards) {
    const candidate = [...batch, card]
    if (
      candidate.length > 100 ||
      jsonBytes({ sourceOrigin: exported.sourceOrigin, memories: candidate }).length >
        MAX_BODY_BYTES
    )
      await flush()
    if (
      jsonBytes({ sourceOrigin: exported.sourceOrigin, memories: [card] }).length > MAX_BODY_BYTES
    )
      throw new ImportError("来源记忆卡超过目标接口大小上限，本地原文仍完整保留。")
    batch.push(card)
  }
  await flush()
  for (const { card, id } of importedIds) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ImportError("目标记忆卡标识不正确。")
    const response = await (await request(`memories/${id}`)).json()
    const actual = response.memory
    if (!actual || !response.owner) throw new ImportError("目标记忆卡身份验证不正确。")
    if (
      valueHash(actual.raw) !== valueHash(card.raw) ||
      valueHash(actual.source) !== valueHash(card.source)
    )
      throw new ImportError("目标记忆卡原始元信息校验失败。")
    for (const field of ["content", "created", "modified", "status", "visibility", "pinned"])
      if (actual[field] !== card[field]) throw new ImportError("目标记忆卡原文或可见性校验失败。")
    if (
      valueHash(actual.tags) !==
      valueHash([
        ...new Set(card.tags.map((tag) => String(tag).replace(/^#/, "").trim()).filter(Boolean)),
      ])
    )
      throw new ImportError("目标记忆卡标签校验失败。")
    if (
      valueHash(actual.attachments.map((attachment) => attachment.fileId)) !==
      valueHash(card.attachments.map((attachment) => attachment.fileId))
    )
      throw new ImportError("目标记忆卡附件关联校验失败。")
    stats.verifiedCards++
    if (stats.verifiedCards % 20 === 0 || stats.verifiedCards === importedIds.length)
      onProgress({ phase: "verify-cards", count: stats.verifiedCards, total: importedIds.length })
  }
  for (const resource of exported.resources) {
    const bytes = Buffer.from(
      await (await request(`memories/files/${resource.fileId}`)).arrayBuffer(),
    )
    if (bytes.length !== resource.size || digest(bytes) !== resource.sha256)
      throw new ImportError("目标附件下载哈希校验失败。")
    stats.verifiedFiles++
    if (stats.verifiedFiles % 10 === 0 || stats.verifiedFiles === exported.resources.length)
      onProgress({
        phase: "verify-files",
        count: stats.verifiedFiles,
        total: exported.resources.length,
      })
  }
  await writeJson(path.join(directory, "import-result.json"), {
    ...stats,
    verifiedAt: new Date().toISOString(),
    snapshotSha256: exported.manifest.snapshotSha256,
  })
  return { ...stats, snapshotSha256: exported.manifest.snapshotSha256 }
}

async function localGitHubToken() {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    const directory =
      process.env.GH_CONFIG_DIR ||
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "gh")
    const config = YAML.parse(await fs.readFile(path.join(directory, "hosts.yml"), "utf8"))
    const host = config?.["github.com"]
    const accounts = Array.isArray(host) ? host : [host, ...Object.values(host?.users || {})]
    const token = accounts.find((account) => typeof account?.oauth_token === "string")?.oauth_token
    if (!token) throw new ImportError("请先使用 gh auth login 登录。")
    return token
  }
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const index = args.indexOf(name)
    if (index < 0) return fallback
    if (!args[index + 1] || args[index + 1].startsWith("--"))
      throw new ImportError(`${name} 需要参数。`)
    return args[index + 1]
  }
  if (args.includes("--help")) {
    console.log(
      "node scripts/import-memos.mjs [--export-only] [--resume-export <dir>] [--import-from <dir>] [--output <ignored-dir>] [--source <origin>] [--username <name>] [--api <target>]\n登录密码仅从 MEMOS_PASSWORD 环境变量读取；GitHub 与同步授权从既有本地登录读取。",
    )
    return
  }
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  let directory = option("--import-from", null)
  const resumeDirectory = option("--resume-export", null)
  if (directory && resumeDirectory) throw new ImportError("恢复导出与从完成目录迁入不能同时指定。")
  if (!directory) {
    directory = path.resolve(
      resumeDirectory ||
        option(
          "--output",
          path.join(repo, ".local/memos-import", new Date().toISOString().replace(/[:.]/g, "-")),
        ),
    )
    if (!directory.startsWith(path.join(repo, ".local") + path.sep))
      throw new ImportError("原始导出必须保存在仓库忽略的 .local 目录中。")
    const prior = resumeDirectory
      ? JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"))
      : null
    const result = await exportMemos({
      sourceOrigin: option(
        "--source",
        process.env.MEMOS_ORIGIN || prior?.sourceOrigin || "http://139.224.225.116:5230",
      ),
      username: option(
        "--username",
        process.env.MEMOS_USERNAME || prior?.account?.username || "Howard",
      ),
      password: process.env.MEMOS_PASSWORD,
      outputDirectory: directory,
      resume: Boolean(resumeDirectory),
      onProgress: (progress) => console.log(JSON.stringify(progress)),
    })
    console.log(JSON.stringify({ phase: "export-complete", ...result }))
  }
  if (args.includes("--export-only")) {
    const exported = await readMemosExport(directory)
    console.log(
      JSON.stringify({
        phase: "export-verified",
        counts: exported.manifest.counts,
        snapshotSha256: exported.manifest.snapshotSha256,
      }),
    )
    return
  }
  const config = JSON.parse(await fs.readFile(path.join(repo, "runtime/config.json"), "utf8"))
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || (await localGitHubToken())
  const syncKey =
    process.env.CONTENT_SYNC_KEY ||
    (await fs.readFile(path.join(repo, ".local/content-sync-key"), "utf8")).trim()
  const result = await importMemosExport({
    directory,
    apiBase: option("--api", process.env.CONTENT_API || config.apiBase),
    token,
    syncKey,
    onProgress: (progress) => console.log(JSON.stringify(progress)),
  })
  console.log(JSON.stringify({ phase: "import-verified", ...result }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      error instanceof ImportError
        ? error.message
        : "导入程序遇到本地文件或响应格式错误，未完成验证。",
    )
    process.exitCode = 1
  })
