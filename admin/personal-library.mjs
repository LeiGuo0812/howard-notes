import { GitHubLibrary } from "./github.mjs"
import { equal, validateCatalog } from "../scripts/lib/catalog.mjs"
import { TRASH_RETENTION_MS } from "./trash.mjs"
import { readPersonalPages } from "./personal-pages.mjs"

const versionOf = (sha) => /^pv:(\d+)$/.exec(sha || "")?.[1]
const conflict = () =>
  Object.assign(new Error("内容已在另一端更改，请保留当前编辑并重新载入。"), { status: 409 })

/** Public Git originals and private D1 originals share an editor, not a trust boundary. */
export class PersonalLibrary {
  constructor(token, fetcher = (...args) => globalThis.fetch(...args), options = {}) {
    this.git = options.git || new GitHubLibrary(token, fetcher, options)
    this.fetcher = fetcher
    this.token = token
    this.siteBase = new URL(
      options.siteBase || "../",
      globalThis.location?.href || "https://notes.invalid/",
    )
    this.apiBase = options.apiBase || null
    this.endpointPromise = null
    this.tokenExpiresAt = options.tokenExpiresAt
    this.privateCache = new Map()
    this.recoveries = []
    this.jobs = []
    this.personalReady = false
    this.snapshotPromise = null
  }
  get token() {
    return this.git.token
  }
  set token(value) {
    this.git.token = value
  }
  authenticate() {
    return this.git.authenticate()
  }
  request(...args) {
    return this.git.request(...args)
  }
  repo(...args) {
    return this.git.repo(...args)
  }
  blobText(...args) {
    return this.git.blobText(...args)
  }
  readAsset(...args) {
    return this.git.readAsset(...args)
  }
  previousSettings(...args) {
    return this.git.previousSettings(...args)
  }
  commit(...args) {
    return this.git.commit(...args)
  }
  async endpoint() {
    if (this.apiBase) return this.apiBase
    if (!this.endpointPromise) {
      // Concurrent list requests share only this client's endpoint discovery.
      // Failed discovery is released so a later action can retry deployment or network changes.
      this.endpointPromise = (async () => {
        const response = await this.fetcher(new URL("runtime-config.json", this.siteBase), {
          cache: "no-store",
          credentials: "omit",
        })
        const config = await response.json()
        if (!response.ok || !config.enabled)
          throw new Error("私密文库需要内容服务，请先完成网站部署。")
        const url = new URL(config.apiBase, this.siteBase)
        if (
          (url.protocol !== "https:" && url.origin !== this.siteBase.origin) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !/\/api\/content\/?$/.test(url.pathname)
        )
          throw new Error("私密文库服务地址不正确。")
        return (this.apiBase = url.href.replace(/\/$/, ""))
      })().finally(() => {
        this.endpointPromise = null
      })
    }
    return this.endpointPromise
  }
  async personalRequest(path, method = "GET", body, binary = false) {
    const base = await this.endpoint()
    const url = `${base}/personal/${path.replace(/^\//, "")}`
    const options = {
      method,
      cache: "no-store",
      credentials: new URL(url).origin === this.siteBase.origin ? "same-origin" : "omit",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined
          ? { "Content-Type": binary ? "application/octet-stream" : "application/json" }
          : {}),
      },
      ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}),
    }
    let response
    // A repeated mutation carries the same operation ID; server receipts make
    // an interrupted acknowledgement safe to retry without another version.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await this.fetcher(url, options)
        break
      } catch (error) {
        if (attempt || method === "GET") throw error
      }
    }
    const value = await response.json()
    if (!response.ok)
      throw Object.assign(new Error(value.error || "私密文库暂时不可用。"), {
        status: response.status,
      })
    return value
  }
  async publicSnapshot() {
    return this.git.snapshot()
  }
  assertReadToken(token) {
    if (!token || this.token !== token)
      throw new DOMException("登录状态已变化，已取消载入。", "AbortError")
  }
  async settingsSnapshot() {
    const token = this.token
    this.assertReadToken(token)
    const publicSnapshot = await this.git.settingsSnapshot()
    this.assertReadToken(token)
    this.personalReady = false
    return (this.currentSnapshot = this.mergeSnapshot(publicSnapshot, []))
  }
  ensureSnapshot() {
    if (this.personalReady) return Promise.resolve(this.currentSnapshot)
    if (!this.snapshotPromise) {
      const pending = this.loadSnapshot(true).finally(() => {
        if (this.snapshotPromise === pending) this.snapshotPromise = null
      })
      this.snapshotPromise = pending
    }
    return this.snapshotPromise
  }
  personalList(path, options) {
    return readPersonalPages((page) => this.personalRequest(page), path, options)
  }
  mergeSnapshot(publicSnapshot, privateRows) {
    const entries = new Map(publicSnapshot.entries)
    const privateArticles = new Map(
      privateRows.filter((row) => row.status === "ACTIVE").map((row) => [row.article.id, row]),
    )
    const storage = new Map()
    for (const row of privateArticles.values()) {
      const path = `library/${row.article.file}`
      entries.set(path, { path, type: "blob", mode: "100644", sha: row.sha, storage: "private" })
      storage.set(path, "private")
    }
    const articles = publicSnapshot.catalog.articles.filter(
      (article) => !privateArticles.has(article.id),
    )
    articles.push(...[...privateArticles.values()].map((row) => row.article))
    validateCatalog({ version: 2, articles })
    return {
      ...publicSnapshot,
      entries,
      catalog: { ...publicSnapshot.catalog, articles },
      privateArticles,
      storage,
      publicSnapshot,
      cloudRecoveries: this.recoveries,
      jobs: this.jobs,
    }
  }
  async loadSnapshot(preservePublicChanges = false) {
    const token = this.token
    this.assertReadToken(token)
    const openedPublic = this.currentSnapshot?.publicSnapshot
    const [publicSnapshot, privateList, recoveries, jobs] = await Promise.all([
      this.git.snapshot(),
      this.personalList("articles"),
      this.personalList("drafts"),
      this.personalRequest("jobs"),
    ])
    this.assertReadToken(token)
    const currentPublic = this.currentSnapshot?.publicSnapshot
    // A settings save can finish while private metadata is still loading. Its
    // accepted full Git snapshot must not regress to the initialization read.
    const publicBaseline =
      preservePublicChanges &&
      currentPublic &&
      !currentPublic.settingsOnly &&
      currentPublic.commit !== openedPublic?.commit
        ? currentPublic
        : publicSnapshot
    this.recoveries = recoveries.drafts || []
    this.jobs = jobs.jobs || []
    for (const row of privateList.articles) {
      const cached = this.privateCache.get(row.article.id)
      if (cached?.version !== row.version) this.privateCache.delete(row.article.id)
    }
    this.currentSnapshot = this.mergeSnapshot(publicBaseline, privateList.articles)
    this.personalReady = true
    return this.currentSnapshot
  }
  async snapshot() {
    // Ordinary refreshes remain authoritative; only first-use initialization
    // shares its request or preserves a concurrently accepted settings save.
    return this.loadSnapshot()
  }
  async read(article, snapshot) {
    const row = snapshot.privateArticles?.get(article.id)
    if (!row) return this.git.read(article, snapshot.publicSnapshot || snapshot)
    let note = this.privateCache.get(article.id)
    if (note?.version !== row.version) note = await this.personalRequest(`articles/${article.id}`)
    if (note.status !== "ACTIVE" || note.version !== row.version || !equal(note.article, article))
      throw conflict()
    this.privateCache.set(article.id, note)
    return { text: note.raw, sha: note.sha, attachments: note.article.attachments || [] }
  }
  async privateSave({ opened, openedSha, edited, text, publicLink }) {
    const version = Number(versionOf(openedSha) || 0)
    if (opened && !opened.published && !versionOf(openedSha)) {
      // Old public-repository drafts are migrated without rewriting their
      // original. The Git entry remains until an explicit legacy cleanup.
      const latest = await this.git.snapshot()
      const old = latest.catalog.articles.find((row) => row.id === opened.id)
      if (!equal(old, opened) || latest.entries.get(`library/${old.file}`)?.sha !== openedSha)
        throw conflict()
    }
    const value = await this.personalRequest("articles", "POST", {
      article: { ...edited, published: false },
      raw: text,
      version,
      requestId: crypto.randomUUID(),
      ...(publicLink !== undefined ? { publicLink } : {}),
    })
    this.privateCache.set(value.article.id, value)
    if (this.currentSnapshot) {
      const rows = [...this.currentSnapshot.privateArticles.values()].filter(
        (row) => row.article.id !== value.article.id,
      )
      rows.push(value)
      this.currentSnapshot = this.mergeSnapshot(this.currentSnapshot.publicSnapshot, rows)
    }
    return value
  }
  async queue(kind, note, publicBaseline, publishAttachments = false) {
    if (
      kind === "publish-private" &&
      note.article.attachments?.some((file) => file.fileId && !file.publicUrl) &&
      !publishAttachments
    )
      throw new Error("原文已存入私密文库；公开文章前需要明确同意公开私密附件。")
    const job = await this.personalRequest("jobs", "POST", {
      kind,
      articleId: note.article.id,
      privateVersion: note.version,
      requestId: crypto.randomUUID(),
      tokenExpiresAt: this.tokenExpiresAt,
      ...(publicBaseline ? { publicBaseline } : {}),
      ...(publishAttachments ? { publishAttachments: true } : {}),
    })
    this.jobs.unshift(job)
    return {
      job,
      articleId: publicBaseline?.article.id || note.article.id,
      privateId: note.article.id,
      scope: "published",
      pending: true,
      snapshot: this.currentSnapshot || (await this.snapshot()),
    }
  }
  async save(input) {
    const { opened, openedSha, edited, text } = input
    if ((opened?.published || opened?.draftOf) && !edited.published && !edited.draft) {
      const latest = await this.git.snapshot()
      const baseline = opened.published ? { article: opened, sha: openedSha } : opened.draftBaseline
      if (!opened.published) {
        const current = await this.personalRequest(`articles/${opened.id}`)
        if (current.version !== Number(versionOf(openedSha)) || !equal(current.article, opened))
          throw conflict()
      }
      if (
        !equal(
          latest.catalog.articles.find((a) => a.id === baseline.article.id),
          baseline.article,
        ) ||
        latest.entries.get(`library/${baseline.article.file}`)?.sha !== baseline.sha
      )
        throw conflict()
      const prior = await this.personalRequest(`articles/${baseline.article.id}`).catch((error) => {
        if (error.status === 404) return null
        throw error
      })
      if (prior && prior.status !== "PUBLISHED") throw conflict()
      const privateArticle = {
        ...edited,
        id: baseline.article.id,
        file: baseline.article.file,
        draft: false,
        published: false,
      }
      delete privateArticle.draftOf
      delete privateArticle.draftBaseline
      const note = await this.privateSave({
        ...input,
        opened: baseline.article,
        edited: privateArticle,
        openedSha: prior?.sha || null,
        publicLink: baseline,
      })
      return this.queue("privatize-public", note, baseline)
    }
    if (edited.published) {
      let baseline = opened?.draftBaseline || null
      let privateInput = { ...input, edited: { ...edited, published: false } }
      if (opened?.published) {
        baseline = { article: opened, sha: openedSha }
        const id = `draft-${crypto.randomUUID()}`
        privateInput = {
          opened: null,
          openedSha: null,
          edited: {
            ...edited,
            id,
            file: `notes/网页草稿/${id}.md`,
            published: false,
            draftOf: opened.id,
            draftBaseline: baseline,
            draft: true,
          },
          text,
        }
      }
      if (baseline && !privateInput.edited.draftOf)
        privateInput.edited = {
          ...privateInput.edited,
          draftOf: baseline.article.id,
          draftBaseline: baseline,
        }
      const note = await this.privateSave(privateInput)
      return this.queue("publish-private", note, baseline, input.publishAttachments)
    }
    const note = await this.privateSave(input)
    return {
      articleId: note.article.id,
      private: true,
      snapshot: this.currentSnapshot || (await this.snapshot()),
    }
  }
  async publishDraft(input) {
    return this.save(input)
  }
  async articleHistory(id, version) {
    return this.personalRequest(
      `articles/${id}/versions${version === undefined ? "" : `/${version}`}`,
    )
  }
  async restoreArticleVersion({ opened, openedSha, version }) {
    if (!versionOf(openedSha) || !Number.isSafeInteger(version) || version < 1)
      throw new Error("请先载入当前私密文章。")
    const note = await this.personalRequest(
      `articles/${opened.id}/versions/${version}/restore`,
      "POST",
      { version: Number(versionOf(openedSha)), requestId: crypto.randomUUID() },
    )
    this.privateCache.set(note.article.id, note)
    const rows = [...this.currentSnapshot.privateArticles.values()].filter(
      (row) => row.article.id !== note.article.id,
    )
    rows.push(note)
    this.currentSnapshot = this.mergeSnapshot(this.currentSnapshot.publicSnapshot, rows)
    return { articleId: note.article.id, note, private: true, snapshot: this.currentSnapshot }
  }
  async saveSettings(input) {
    const result = await this.git.saveSettings(input)
    const background = await this.queuePublicSync(result.sha)
    this.currentSnapshot = this.mergeSnapshot(result.snapshot, [
      ...(this.currentSnapshot?.privateArticles.values() || []),
    ])
    return {
      ...result,
      ...background,
      publicSnapshot: result.snapshot,
      snapshot: this.currentSnapshot,
    }
  }
  async queuePublicSync(commit) {
    try {
      const backgroundJob = await this.personalRequest("jobs", "POST", {
        kind: "sync-public",
        commit,
        requestId: crypto.randomUUID(),
        tokenExpiresAt: this.tokenExpiresAt,
      })
      return { backgroundJob }
    } catch (error) {
      // Git has already acknowledged its atomic commit. A missing extra speed-up
      // cannot turn that successful save into an apparent failure; the push
      // workflow and browser publisher still reconcile the public snapshot.
      return { backgroundWarning: error.message }
    }
  }
  trashRecord(row) {
    return {
      id: `private:${row.article.id}`,
      private: true,
      articleId: row.article.id,
      title: row.article.title,
      published: false,
      deletedAt: row.deletedAt,
      expiresAt: new Date(Date.parse(row.deletedAt) + TRASH_RETENTION_MS).toISOString(),
      version: row.version,
      articles: [{ article: row.article }],
    }
  }
  async listTrash(snapshot) {
    const [old, rows, recoveries] = await Promise.all([
      this.git.listTrash(snapshot?.publicSnapshot || snapshot),
      this.personalList("articles?status=TRASH"),
      this.personalList("drafts?status=TRASH"),
    ])
    return [
      ...old,
      ...rows.articles.map((row) => this.trashRecord(row)),
      ...recoveries.drafts
        .filter((row) => row.kind === "article")
        .map((row) => ({
          id: `recovery:${row.editorId}`,
          cloudDraft: true,
          editorId: row.editorId,
          articleId: row.id,
          title: row.title,
          version: row.version,
          deletedAt: row.deletedAt,
          expiresAt: new Date(Date.parse(row.deletedAt) + TRASH_RETENTION_MS).toISOString(),
        })),
    ]
  }
  async removeDraft(input) {
    if (!versionOf(input.openedSha)) return this.git.removeDraft(input)
    const note = await this.personalRequest(`articles/${input.opened.id}/delete`, "POST", {
      version: Number(versionOf(input.openedSha)),
      requestId: crypto.randomUUID(),
    })
    return {
      articleId: input.opened.id,
      removedIds: [input.opened.id],
      private: true,
      record: this.trashRecord(note),
      snapshot: await this.snapshot(),
    }
  }
  async removePublishedArticle(input) {
    const gitDrafts = input.openedDrafts.filter((item) => !versionOf(item.sha))
    // Private drafts retain their own version guards and recoverable originals.
    const result = await this.git.removePublishedArticle({ ...input, openedDrafts: gitDrafts })
    const background = await this.queuePublicSync(result.sha)
    const remaining = [...(this.currentSnapshot?.privateArticles.values() || [])]
    for (const draft of input.openedDrafts.filter((item) => versionOf(item.sha)))
      try {
        await this.removeDraft({ opened: draft.article, openedSha: draft.sha })
        const index = remaining.findIndex((row) => row.article.id === draft.article.id)
        if (index >= 0) remaining.splice(index, 1)
      } catch (error) {
        background.backgroundWarning = `公开文章已删除；私密修改稿仍保留：${error.message}`
      }
    this.currentSnapshot = this.mergeSnapshot(result.snapshot, remaining)
    return {
      ...result,
      ...background,
      publicSnapshot: result.snapshot,
      snapshot: this.currentSnapshot,
    }
  }
  async restoreTrash(record, snapshot) {
    if (record.cloudDraft) {
      await this.personalRequest(`drafts/${encodeURIComponent(record.editorId)}/restore`, "POST", {
        version: record.version,
        requestId: crypto.randomUUID(),
      })
      return {
        private: true,
        articleId: record.articleId,
        restoredIds: [],
        snapshot: await this.snapshot(),
      }
    }
    if (!record.private) {
      const result = await this.git.restoreTrash(record, snapshot?.publicSnapshot || snapshot)
      const background = result.published ? await this.queuePublicSync(result.sha) : {}
      return {
        ...result,
        ...background,
        publicSnapshot: result.snapshot,
        snapshot: await this.snapshot(),
      }
    }
    const note = await this.personalRequest(`articles/${record.articleId}/restore`, "POST", {
      version: record.version,
      requestId: crypto.randomUUID(),
    })
    return {
      articleId: note.article.id,
      restoredIds: [note.article.id],
      published: false,
      private: true,
      snapshot: await this.snapshot(),
    }
  }
  async purgeTrash(record, snapshot) {
    const token = this.token
    this.assertReadToken(token)
    if (record.cloudDraft) {
      await this.personalRequest(`drafts/${encodeURIComponent(record.editorId)}/purge`, "POST", {
        version: record.version,
        requestId: crypto.randomUUID(),
      })
      this.assertReadToken(token)
      this.recoveries = this.recoveries.filter((row) => row.editorId !== record.editorId)
      const current = this.currentSnapshot || snapshot
      if (current) this.currentSnapshot = { ...current, cloudRecoveries: this.recoveries }
      return { private: true, snapshot: this.currentSnapshot || snapshot }
    }
    if (!record.private) {
      const result = await this.git.purgeTrash(record, snapshot?.publicSnapshot || snapshot)
      this.assertReadToken(token)
      const current = this.currentSnapshot || snapshot
      this.currentSnapshot = this.mergeSnapshot(result.snapshot, [
        ...(current?.privateArticles?.values() || []),
      ])
      return { ...result, publicSnapshot: result.snapshot, snapshot: this.currentSnapshot }
    }
    await this.personalRequest(`articles/${record.articleId}/purge`, "POST", {
      version: record.version,
      requestId: crypto.randomUUID(),
    })
    this.assertReadToken(token)
    this.privateCache.delete(record.articleId)
    // Purge only removes an already trashed original. Its accepted response
    // cannot require another whole-library read, or a read outage would turn
    // successful deletion into a reported failure. Preserve current readiness.
    return { private: true, snapshot: this.currentSnapshot || snapshot }
  }
  async pruneExpiredTrash(snapshot) {
    return this.git.pruneExpiredTrash(snapshot?.publicSnapshot || snapshot)
  }
  async readPrivateFile(source) {
    const base = await this.endpoint()
    const url = new URL(source, this.siteBase)
    if (
      url.origin !== new URL(base).origin ||
      !url.pathname.startsWith(new URL(base).pathname + "/personal/files/")
    )
      throw new Error("私密附件地址不正确。")
    const response = await this.fetcher(url, {
      credentials: url.origin === this.siteBase.origin ? "same-origin" : "omit",
      cache: "no-store",
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!response.ok)
      throw Object.assign(new Error("无法读取私密附件。"), { status: response.status })
    return response.blob()
  }
  async privateFileUrl(id) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("私密附件编号不正确。")
    return `${await this.endpoint()}/personal/files/${id}`
  }
  async uploadPrivateImages(files, progress = () => {}, prepared = []) {
    const output = []
    for (const [index, file] of files.entries()) {
      const bytes = prepared[index]?.bytes || new Uint8Array(await file.arrayBuffer())
      const sha256 =
        prepared[index]?.sha256 ||
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
      const id = `image-${crypto.randomUUID()}`
      const registered = await this.personalRequest("files", "POST", {
        file: {
          id,
          name: file.name || "图片.png",
          mimeType: file.type || "application/octet-stream",
          size: bytes.byteLength,
          sha256,
        },
      })
      if (!registered.file.complete) await this.personalRequest(`files/${id}`, "PUT", bytes, true)
      const url = new URL(registered.file.url, await this.endpoint()).href
      output.push({
        url,
        alt:
          prepared[index]?.alt || (file.name || "图片").replace(/[\\\[\]\r\n]/g, "").slice(0, 200),
        attachment: {
          fileId: id,
          source: url,
          name: file.name || "图片",
          mimeType: file.type,
          sha256,
        },
      })
      progress(index + 1, files.length)
    }
    return output
  }
}
