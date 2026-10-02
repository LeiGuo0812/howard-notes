import { createPublicationWorker } from "./publication-worker-client.mjs"
import { publicLibrarySnapshot } from "./public-library.mjs"
const PENDING_KEY = "howard-notes:pending-publication:v1"
const SHA = /^[a-f0-9]{40}$/i
const KINDS = new Set(["article", "settings", "unpublish", "delete"])
const encoder = new TextEncoder()

export function publicChange(value) {
  return KINDS.has(value?.kind) && !(value.kind === "delete" && value.scope === "draft")
}

export function publicationRecord(value) {
  if (!publicChange(value) || !SHA.test(value.commit)) return null
  return {
    version: 1,
    kind: value.kind,
    commit: value.commit,
    ...(typeof value.articleId === "string" ? { articleId: value.articleId } : {}),
    ...(value.scope === "published" ? { scope: "published" } : {}),
    ...(Array.isArray(value.removedIds)
      ? { removedIds: value.removedIds.filter((id) => typeof id === "string").slice(0, 100) }
      : {}),
  }
}

export function runtimeApiBase(value, siteBase) {
  const base = new URL(siteBase)
  const api = new URL(value, base)
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)
  if (
    (api.protocol !== "https:" && !(local && api.origin === base.origin)) ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    !api.pathname.replace(/\/$/, "").endsWith("/api/content")
  )
    throw new Error("线上内容服务地址不正确。")
  return api.href.replace(/\/$/, "")
}

export function publicationChunks(documents, pages, maxBytes = 730000, maxRows = 20) {
  const result = []
  // Smaller multi-row requests leave CPU room on Workers Free. A large single
  // page still fits the documented hard limit without changing its content.
  const targetBytes = Math.min(250000, maxBytes)
  let chunk = { documents: [], pages: [] }
  const size = (value) => encoder.encode(JSON.stringify(value)).length
  for (const [field, rows] of [
    ["documents", documents],
    ["pages", pages],
  ]) {
    for (const row of rows) {
      const next = { documents: [...chunk.documents], pages: [...chunk.pages] }
      next[field].push(row)
      if (next.documents.length + next.pages.length > maxRows || size(next) > targetBytes) {
        if (chunk.documents.length || chunk.pages.length) result.push(chunk)
        chunk = { documents: [], pages: [] }
        chunk[field].push(row)
        if (size(chunk) > maxBytes)
          throw new Error("单篇内容超出线上同步大小限制，请先下载并调整内容。")
      } else chunk = next
    }
  }
  if (chunk.documents.length || chunk.pages.length) result.push(chunk)
  return result
}

export async function renderedPageHash(html) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(html))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

// Only the latest pending Git revision is retained. No token, Markdown, or generated HTML
// enters this record. A retry projects the current Git head and never writes another commit.
export function createRuntimePublisher({
  siteBase,
  getClient,
  storage,
  fetcher = (...args) => globalThis.fetch(...args),
  loadProjection,
  onState = () => {},
  onSynchronized = () => {},
}) {
  const background = loadProjection ? null : createPublicationWorker(siteBase)
  let pending = null,
    running = null,
    configuration = null,
    confirmed = null,
    disposed = false
  try {
    const stored = storage?.getItem(PENDING_KEY)
    if (stored && stored.length < 20000) pending = publicationRecord(JSON.parse(stored))
  } catch {}
  const emit = (state) => {
    if (!disposed) onState(state)
  }
  const remember = (value) => {
    pending = value
    try {
      if (value) storage?.setItem(PENDING_KEY, JSON.stringify(value))
      else storage?.removeItem(PENDING_KEY)
    } catch {}
  }
  async function request(url, { body, token, timeout = 60000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetcher(url, {
        method: body ? "POST" : "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (response.status === 404 && url.endsWith("runtime-config.json"))
        return { version: 1, enabled: false }
      let data
      try {
        data = await response.json()
      } catch {
        throw new Error("线上同步返回信息不正确，请重试同步。")
      }
      if (!response.ok) {
        const error = new Error(
          response.status === 401
            ? "登录已过期，请重新登录后重试同步。"
            : response.status === 409
              ? "线上版本或 GitHub 有更新，请重试同步最新内容。"
              : typeof data.error === "string"
                ? data.error.slice(0, 250)
                : `线上同步失败（${response.status}），请重试同步。`,
        )
        error.status = response.status
        throw error
      }
      return data
    } catch (error) {
      if (error.name === "AbortError") throw new Error("线上同步超时，请重试同步。")
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  async function config() {
    if (!configuration) {
      configuration = request(new URL("runtime-config.json", siteBase).href)
        .then(async (value) => {
          if (value.version !== 1 || typeof value.enabled !== "boolean")
            throw new Error("线上内容服务设置不正确。")
          if (!value.enabled) return value
          const apiBase = runtimeApiBase(value.apiBase, siteBase)
          const live = await request(`${apiBase}/config`)
          if (live.version !== 1 || live.enabled !== true)
            throw new Error("线上内容服务暂不可用，请重试同步。")
          return { ...live, apiBase }
        })
        .catch((error) => {
          configuration = null
          throw error
        })
    }
    return configuration
  }
  async function sourcesFor(snapshot, previous) {
    const sources = new Map()
    const cached = new Map((previous.documents || []).map((doc) => [doc.id, doc]))
    const articles = snapshot.catalog.articles.filter((article) => article.published)
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(6, articles.length) }, async () => {
        while (cursor < articles.length) {
          const article = articles[cursor++]
          const old = cached.get(article.id)
          const sha = snapshot.entries.get(`library/${article.file}`)?.sha
          const source =
            old?.file === article.file && old.sourceSha === sha && typeof old.source === "string"
              ? old.source
              : (await getClient().read(article, snapshot)).text
          sources.set(article.file, encoder.encode(source))
        }
      }),
    )
    return sources
  }
  async function synchronize(record, snapshot) {
    emit({ status: "syncing", ...record })
    const settings = await config()
    if (!settings.enabled) {
      remember(null)
      emit({ status: "static", ...record })
      return { status: "static", ...record }
    }
    const client = getClient()
    if (!client?.token) throw new Error("请重新登录后重试同步。")
    snapshot ||= await (client.publicSnapshot ? client.publicSnapshot() : client.snapshot())
    // Maintenance may hold a merged owner library. Publication always follows
    // acknowledged Git originals; a private shadow cannot withdraw public
    // content before its durable job has actually updated the Git ref.
    snapshot = publicLibrarySnapshot(snapshot)
    if (!SHA.test(snapshot.commit)) throw new Error("GitHub 版本信息不正确，请重试同步。")
    const api = settings.apiBase
    background?.warm()
    const begun = await request(`${api}/sync/begin`, {
      body: { commit: snapshot.commit },
      token: client.token,
    })
    const accept = (result) => {
      if (
        result.status !== "synchronized" ||
        result.commit !== snapshot.commit ||
        !(typeof result.revision === "string" || Number.isSafeInteger(result.revision))
      )
        throw new Error("尚未确认线上内容已更新，请重试同步。")
      remember(null)
      const state = {
        ...record,
        ...result,
        publishedIds: snapshot.catalog.articles
          .filter((article) => article.published)
          .map((article) => article.id),
      }
      emit(state)
      if (!disposed) onSynchronized(state)
      return state
    }
    if (begun.status === "synchronized") return accept(begun)
    if (typeof begun.syncId !== "string" || !begun.syncId)
      throw new Error("线上同步会话不正确，请重试同步。")
    const cached =
      confirmed?.previous.revision === begun.revision - 1 &&
      confirmed.previous.commit === begun.currentCommit
        ? confirmed
        : null
    const [{ previous, shell }, modules] = await Promise.all([
      cached ||
        Promise.all([request(`${api}/snapshot`), request(`${api}/shell`)]).then(
          ([previous, shell]) => ({ previous, shell }),
        ),
      loadProjection ? loadProjection() : background,
    ])
    // A concurrent deployment may finish between begin and the public read. Its
    // page hashes cannot be compared against begin's older staged pages.
    if (previous.revision !== begun.revision - 1 || previous.commit !== begun.currentCommit) {
      const error = new Error("线上内容已有更新，请重试同步最新内容。")
      error.status = 409
      throw error
    }
    const sources = await sourcesFor(snapshot, previous)
    const input = {
      catalog: snapshot.catalog,
      settings: snapshot.settings,
      sources,
      commit: snapshot.commit,
      entries: snapshot.entries,
      previous,
      shell,
      reusableDocuments: begun.reusableDocuments,
      maxChunkBytes: settings.maxChunkBytes,
    }
    let projection, chunks
    if (modules.preparePublication) {
      projection = await modules.preparePublication(input)
      chunks = projection.chunks
    } else {
      projection = await modules.prepareProjection({
        catalog: snapshot.catalog,
        settings: snapshot.settings,
        sources,
        commit: snapshot.commit,
        entries: snapshot.entries,
        previous,
      })
      const pages = await modules.renderPages(projection, shell)
      const reusable = new Set(begun.reusableDocuments || [])
      const previousDocs = new Map((previous.documents || []).map((doc) => [doc.id, doc]))
      const changedDocuments = projection.documents.filter(
        (doc) =>
          !reusable.has(doc.id) || JSON.stringify(previousDocs.get(doc.id)) !== JSON.stringify(doc),
      )
      const pageHashes = await Promise.all(pages.map((page) => renderedPageHash(page.html)))
      projection.pageHashes = Object.fromEntries(
        pages.map((page, index) => [page.path, pageHashes[index]]),
      )
      const changedPages = pages.filter(
        (page, index) => previous.pageHashes?.[page.path] !== pageHashes[index],
      )
      chunks = publicationChunks(
        changedDocuments,
        changedPages,
        Math.min(730000, settings.maxChunkBytes || 730000),
      )
    }
    let completed = 0,
      cursor = 0,
      failed
    // Keep at most three requests in flight, but refill a free slot immediately
    // instead of waiting for the slowest request in each fixed batch.
    await Promise.allSettled(
      Array.from({ length: Math.min(3, chunks.length) }, async () => {
        while (cursor < chunks.length && !failed) {
          const chunk = chunks[cursor++]
          try {
            await request(`${api}/sync/chunk`, {
              body: { syncId: begun.syncId, ...chunk },
              token: client.token,
            })
            emit({ status: "syncing", ...record, progress: `${++completed}/${chunks.length}` })
          } catch (error) {
            failed ||= error
          }
        }
      }),
    )
    if (failed) throw failed
    for (const metadata of [
      { contentIndex: projection.contentIndex },
      { blogData: projection.blogData },
    ])
      await request(`${api}/sync/chunk`, {
        body: { syncId: begun.syncId, ...metadata },
        token: client.token,
      })
    const result = await request(`${api}/sync/finish`, {
      body: { syncId: begun.syncId },
      token: client.token,
    })
    const accepted = accept(result)
    // Retain only the confirmed public version in memory. The next canonical
    // begin must identify this exact base before any source/AST/page is reused.
    // Never promote a failed or partially uploaded projection into the cache.
    if (projection.pageHashes) {
      const documents = new Map((previous.documents || []).map((doc) => [doc.id, doc]))
      for (const chunk of chunks) for (const doc of chunk.documents) documents.set(doc.id, doc)
      const published = snapshot.catalog.articles.filter((article) => article.published)
      const rows = published.map((article) => documents.get(article.id))
      if (rows.every(Boolean))
        confirmed = {
          shell,
          previous: {
            revision: result.revision,
            commit: snapshot.commit,
            documents: rows,
            pageHashes: projection.pageHashes,
          },
        }
    }
    return accepted
  }
  function run(record, snapshot) {
    if (running) return running
    remember(record)
    running = synchronize(record, snapshot)
      .catch((error) => {
        const state = { status: "pending", ...record, error: error.message, code: error.status }
        emit(state)
        return state
      })
      .finally(() => (running = null))
    return running
  }
  return {
    publish(value, snapshot) {
      const record = publicationRecord(value)
      return record ? run(record, snapshot) : Promise.resolve({ status: "draft" })
    },
    retry() {
      return pending ? run(pending) : Promise.resolve(null)
    },
    restore() {
      if (pending) emit({ ...pending, status: "pending" })
    },
    isRunning: () => !!running,
    pending: () => pending && { ...pending },
    dispose() {
      disposed = true
      confirmed = null
      background?.dispose()
    },
  }
}
