import {
  CATALOG_PATH,
  REPOSITORY,
  BRANCH,
  validateCatalog,
  mergeArticle,
  safeRelative,
  equal,
} from "../scripts/lib/catalog.mjs"
import { SITE_PATH, validateSite } from "../scripts/lib/site-settings.mjs"
import {
  TRASH_PREFIX,
  TRASH_RETENTION_MS,
  trashRecordPath,
  trashRecordContent,
  validateTrashRecord,
  trashExpired,
  trashPaths,
} from "./trash.mjs"

export function decodeBase64(base64) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    Uint8Array.from(atob(base64.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)),
  )
}

export async function gitBlobSha(text) {
  const bytes = new TextEncoder().encode(text)
  const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const body = new Uint8Array(prefix.length + bytes.length)
  body.set(prefix)
  body.set(bytes, prefix.length)
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", body)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

// The accepted ref write is the acknowledgement. Derive its exact conflict baseline before
// writing, so a later repository read cannot turn a successful save into a reported failure.
export async function committedSnapshot(latest, changes) {
  const entries = new Map(latest.entries)
  const texts = new Map()
  let catalog = latest.catalog,
    settings = latest.settings,
    siteSha = latest.siteSha
  for (const change of changes) {
    if (change.sha === null) {
      entries.delete(change.path)
      continue
    }
    const sha = typeof change.content === "string" ? await gitBlobSha(change.content) : change.sha
    entries.set(change.path, { path: change.path, type: "blob", mode: change.mode, sha })
    if (typeof change.content === "string") texts.set(change.path, change.content)
    if (change.path === CATALOG_PATH) catalog = validateCatalog(JSON.parse(change.content))
    if (change.path === SITE_PATH) {
      settings = validateSite(JSON.parse(change.content))
      siteSha = sha
    }
  }
  return { ...latest, entries, texts, catalog, settings, siteSha }
}

export class GitHubLibrary {
  constructor(token, fetcher = (...args) => globalThis.fetch(...args), options = {}) {
    this.token = token
    this.fetcher = fetcher
    this.repository = options.repository || REPOSITORY
    this.branch = options.branch || BRANCH
    this.now = options.now || Date.now
    this.trashId = options.trashId || (() => crypto.randomUUID())
    this.trashCache = new Map()
    this.textCache = new Map()
  }
  async request(endpoint, method = "GET", body) {
    const response = await this.fetcher(`https://api.github.com${endpoint}`, {
      method,
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "登录凭据无效或已过期，请重新登录。"
          : response.status === 403
            ? "GitHub 拒绝了请求。请检查应用的仓库权限，或稍后重试。"
            : [409, 422].includes(response.status)
              ? "远端发生变化，本次未覆盖任何远端内容。请重新载入后再保存。"
              : `GitHub 请求失败（${response.status}），请稍后重试。`,
      )
      error.status = response.status
      throw error
    }
    return response.status === 204 ? null : response.json()
  }
  repo(endpoint, method, body) {
    return this.request(`/repos/${this.repository}/${endpoint}`, method, body)
  }
  async authenticate() {
    const [user, repository] = await Promise.all([
      this.request("/user"),
      this.request(`/repos/${this.repository}`),
    ])
    if (!repository.permissions?.push) throw new Error("当前账号没有此仓库的写入权限。")
    return user.login
  }
  async snapshot() {
    const ref = await this.repo(`git/ref/heads/${this.branch}`)
    const head = await this.repo(`git/commits/${ref.object.sha}`)
    const tree = await this.repo(`git/trees/${head.tree.sha}?recursive=1`)
    if (tree.truncated) throw new Error("仓库目录过大，未能取得完整文件列表。")
    const entries = new Map(
      tree.tree.filter((item) => item.type === "blob").map((item) => [item.path, item]),
    )
    const catalogEntry = entries.get(CATALOG_PATH)
    if (!catalogEntry) throw new Error("尚未找到发布目录，请等待网站升级部署完成。")
    const siteEntry = entries.get(SITE_PATH)
    if (!siteEntry) throw new Error("页面设置尚未部署，请稍后刷新。")
    const [catalogText, siteText] = await Promise.all([
      this.blobText(catalogEntry.sha),
      this.blobText(siteEntry.sha),
    ])
    const catalog = validateCatalog(JSON.parse(catalogText))
    const settings = validateSite(JSON.parse(siteText))
    return {
      commit: ref.object.sha,
      tree: head.tree.sha,
      entries,
      catalog,
      settings,
      siteSha: siteEntry.sha,
    }
  }
  async read(article, snapshot) {
    const entry = snapshot.entries.get(`library/${article.file}`)
    if (!entry) throw new Error("原文文件不存在，请重新载入目录。")
    if (snapshot.texts?.has(`library/${article.file}`))
      return { text: snapshot.texts.get(`library/${article.file}`), sha: entry.sha }
    return { text: await this.blobText(entry.sha), sha: entry.sha }
  }
  async blobText(sha) {
    // Blob IDs are immutable. Cache/coalesce only those reads; branch/ref/tree reads always
    // remain fresh so save, delete and restore retain their existing conflict detection.
    let pending = this.textCache.get(sha)
    if (pending) {
      this.textCache.delete(sha)
      this.textCache.set(sha, pending)
    } else {
      pending = this.repo(`git/blobs/${sha}`).then((blob) => decodeBase64(blob.content))
      this.textCache.set(sha, pending)
      if (this.textCache.size > 64) this.textCache.delete(this.textCache.keys().next().value)
    }
    try {
      return await pending
    } catch (error) {
      if (this.textCache.get(sha) === pending) this.textCache.delete(sha)
      throw error
    }
  }
  async save({ opened, openedSha, edited, text, images = [] }) {
    const latest = await this.snapshot()
    if (edited.draftOf && !opened) {
      const original = latest.catalog.articles.find((article) => article.id === edited.draftOf)
      if (
        !equal(original, edited.draftBaseline?.article) ||
        latest.entries.get(`library/${original?.file}`)?.sha !== edited.draftBaseline?.sha
      )
        throw new Error("已发布文章已在另一端更改，请重新载入后再存草稿。")
      if (latest.catalog.articles.some((article) => article.draftOf === edited.draftOf))
        throw new Error("这篇文章已有编辑草稿，请从草稿箱继续编辑。")
    }
    const currentSha = latest.entries.get(`library/${edited.file}`)?.sha ?? null
    if (currentSha !== (openedSha ?? null))
      throw new Error("这篇原文已在另一端更改。请先下载你的编辑，再重新载入；本次没有覆盖远端。")
    const catalog = mergeArticle(latest.catalog, opened, edited)
    const changes = [
      {
        path: CATALOG_PATH,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(catalog, null, 2) + "\n",
      },
      { path: `library/${edited.file}`, mode: "100644", type: "blob", content: text },
    ]
    await this.appendImages(changes, images)
    return this.commit(
      latest,
      changes,
      `${edited.published ? "Publish" : "Save draft"}: ${edited.title}`,
    )
  }
  async appendImages(changes, images) {
    for (const image of images) {
      if (
        !safeRelative(image.file) ||
        !/^assets\/[a-f0-9]{32,64}\.(png|jpg|jpeg|gif|webp)$/.test(image.file)
      )
        throw new Error("图片路径不合法。")
      const blob = await this.repo("git/blobs", "POST", {
        content: image.base64,
        encoding: "base64",
      })
      changes.push({ path: "library/" + image.file, mode: "100644", type: "blob", sha: blob.sha })
    }
  }
  async publishDraft({ opened, openedSha, edited, text, images = [] }) {
    if (!opened?.draftOf || opened.published !== false) throw new Error("找不到文章修改草稿。")
    const latest = await this.snapshot()
    const draft = latest.catalog.articles.find((article) => article.id === opened.id)
    const original = latest.catalog.articles.find((article) => article.id === opened.draftOf)
    if (!equal(draft, opened) || latest.entries.get(`library/${opened.file}`)?.sha !== openedSha)
      throw new Error("草稿已在另一端更改，请重新载入后再发布。")
    if (
      !equal(original, opened.draftBaseline?.article) ||
      latest.entries.get(`library/${original?.file}`)?.sha !== opened.draftBaseline?.sha
    )
      throw new Error("已发布文章已在另一端更改；原文章和草稿均已保留，请先核对最新文章。")
    const published = {
      ...edited,
      id: original.id,
      file: original.file,
      date: original.date,
      published: true,
    }
    delete published.draftOf
    delete published.draftBaseline
    const catalog = mergeArticle(latest.catalog, original, published)
    catalog.articles = catalog.articles.filter((article) => article.id !== opened.id)
    const changes = [
      {
        path: CATALOG_PATH,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(catalog, null, 2) + "\n",
      },
      { path: `library/${original.file}`, mode: "100644", type: "blob", content: text },
      { path: `library/${opened.file}`, mode: "100644", type: "blob", sha: null },
    ]
    await this.appendImages(changes, images)
    const result = await this.commit(latest, changes, `Publish changes: ${published.title}`)
    return { ...result, articleId: published.id }
  }
  async saveSettings({ openedSha, settings }) {
    validateSite(settings)
    const latest = await this.snapshot()
    if (latest.siteSha !== openedSha)
      throw new Error("页面设置已在另一端更改。请先导出当前设置，再重新载入。")
    // Existing topic keys preserve their categories even when their display titles change.
    for (const previous of latest.settings.topics) {
      const next = settings.topics.find((topic) => topic.id === previous.id)
      if (next && next.category !== previous.category)
        throw new Error("已有专题的文章归属不能改写。")
      if (
        !next &&
        latest.catalog.articles.some((article) => article.category === previous.category)
      )
        throw new Error(`“${previous.title}”仍有文章，请先调整文章专题。`)
    }
    return this.commit(
      latest,
      [
        {
          path: SITE_PATH,
          mode: "100644",
          type: "blob",
          content: JSON.stringify(settings, null, 2) + "\n",
        },
      ],
      "Update site layout and topics",
    )
  }
  async previousSettings() {
    const commits = await this.repo(`commits?path=${encodeURIComponent(SITE_PATH)}&per_page=2`)
    if (commits.length < 2) throw new Error("尚无上一版页面设置。")
    const blob = await this.repo(`contents/${SITE_PATH}?ref=${encodeURIComponent(commits[1].sha)}`)
    return validateSite(JSON.parse(decodeBase64(blob.content)))
  }
  async removePublishedArticle({ opened, openedSha, openedDrafts = [] }) {
    if (!opened || opened.published !== true) throw new Error("只能通过此操作删除已发布文章。")
    if (
      typeof openedSha !== "string" ||
      !openedSha ||
      !Array.isArray(openedDrafts) ||
      openedDrafts.some(
        (draft) =>
          draft?.article?.draftOf !== opened.id ||
          draft.article.published !== false ||
          typeof draft.sha !== "string" ||
          !draft.sha,
      )
    )
      throw new Error("文章删除版本信息不完整，请重新载入。")
    // Validate every deletion path before requesting a tree change, including draft paths.
    validateCatalog({
      version: 2,
      articles: [opened, ...openedDrafts.map((draft) => draft.article)],
    })
    const latest = await this.snapshot()
    validateCatalog(latest.catalog)
    const current = latest.catalog.articles.find((article) => article.id === opened.id)
    if (!equal(current, opened) || latest.entries.get(`library/${opened.file}`)?.sha !== openedSha)
      throw new Error("已发布文章已在另一端更改，请重新载入；本次没有删除远端内容。")
    const drafts = latest.catalog.articles.filter((article) => article.draftOf === opened.id)
    if (
      drafts.length !== openedDrafts.length ||
      drafts.some((draft) => {
        const baseline = openedDrafts.find((item) => item.article.id === draft.id)
        return (
          !baseline ||
          !equal(draft, baseline.article) ||
          latest.entries.get(`library/${draft.file}`)?.sha !== baseline.sha
        )
      })
    )
      throw new Error("这篇文章的修改草稿已在另一端更改，请重新载入；文章和草稿均未删除。")
    const removed = [opened, ...openedDrafts.map((draft) => draft.article)]
    return this.archiveArticles(latest, removed, `Delete article: ${opened.title}`)
  }
  async removeDraft({ opened, openedSha, openedDrafts = [] }) {
    if (!opened || opened.published !== false) throw new Error("只能删除未发布的草稿。")
    if (
      typeof openedSha !== "string" ||
      !openedSha ||
      !Array.isArray(openedDrafts) ||
      openedDrafts.some(
        (draft) =>
          draft?.article?.draftOf !== opened.id ||
          draft.article.published !== false ||
          typeof draft.sha !== "string" ||
          !draft.sha,
      )
    )
      throw new Error("草稿删除版本信息不完整，请重新载入。")
    validateCatalog({
      version: 2,
      articles: [opened, ...openedDrafts.map((draft) => draft.article)],
    })
    const latest = await this.snapshot()
    validateCatalog(latest.catalog)
    const current = latest.catalog.articles.find((article) => article.id === opened.id)
    if (!equal(current, opened) || latest.entries.get(`library/${opened.file}`)?.sha !== openedSha)
      throw new Error("草稿已在另一端更改，请重新载入；本次没有删除远端内容。")
    const drafts = latest.catalog.articles.filter((article) => article.draftOf === opened.id)
    if (
      drafts.length !== openedDrafts.length ||
      drafts.some((draft) => {
        const baseline = openedDrafts.find((item) => item.article.id === draft.id)
        return (
          !baseline ||
          !equal(draft, baseline.article) ||
          latest.entries.get(`library/${draft.file}`)?.sha !== baseline.sha
        )
      })
    )
      throw new Error("这篇文章的修改草稿已在另一端更改，请重新载入；文章和草稿均未删除。")
    return this.archiveArticles(
      latest,
      [opened, ...openedDrafts.map((draft) => draft.article)],
      `Delete draft: ${opened.title}`,
    )
  }
  async archiveArticles(latest, removed, message) {
    const deleted = this.now()
    const id = this.trashId()
    const path = trashRecordPath(id)
    if ([...latest.entries.keys()].some((entry) => entry.startsWith(`${TRASH_PREFIX}${id}/`)))
      throw new Error("回收站记录已存在，请重试。")
    const record = validateTrashRecord({
      version: 1,
      id,
      articleId: removed[0].id,
      title: removed[0].title,
      published: removed.some((article) => article.published),
      deletedAt: new Date(deleted).toISOString(),
      expiresAt: new Date(deleted + TRASH_RETENTION_MS).toISOString(),
      articles: removed.map((article, position) => {
        const entry = latest.entries.get(`library/${article.file}`)
        return {
          article: structuredClone(article),
          sourcePath: `${TRASH_PREFIX}${id}/sources/${position}.md`,
          sha: entry.sha,
          mode: entry.mode || "100644",
          index: latest.catalog.articles.findIndex((item) => item.id === article.id),
        }
      }),
    })
    const removedIds = removed.map((article) => article.id)
    const catalog = structuredClone(latest.catalog)
    catalog.articles = catalog.articles.filter((article) => !removedIds.includes(article.id))
    const changes = [
      {
        path: CATALOG_PATH,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(catalog, null, 2) + "\n",
      },
      ...removed.map((article) => ({
        path: `library/${article.file}`,
        mode: latest.entries.get(`library/${article.file}`).mode || "100644",
        type: "blob",
        sha: null,
      })),
      { path, mode: "100644", type: "blob", content: trashRecordContent(record) },
      ...record.articles.map(({ sourcePath, sha, mode }) => ({
        path: sourcePath,
        mode,
        type: "blob",
        sha,
      })),
    ]
    const result = await this.commit(latest, changes, message)
    return {
      ...result,
      articleId: record.articleId,
      removedIds,
      published: record.published,
      scope: record.published ? "published" : "draft",
      trashId: id,
      record: { ...record, path, sha: result.snapshot.entries.get(path).sha },
    }
  }
  async readTrashRecord(path, snapshot) {
    const entry = snapshot.entries.get(path)
    if (!entry) throw new Error("回收站记录已在另一端移除，请刷新列表。")
    let stored = this.trashCache.get(entry.sha)
    if (!stored) {
      const text = snapshot.texts?.has(path)
        ? snapshot.texts.get(path)
        : decodeBase64((await this.repo(`git/blobs/${entry.sha}`)).content)
      stored = validateTrashRecord(JSON.parse(text))
      this.trashCache.set(entry.sha, stored)
    }
    if (trashRecordPath(stored.id) !== path) throw new Error("回收站记录路径不正确。")
    return { ...structuredClone(stored), path, sha: entry.sha }
  }
  async listTrash(snapshot) {
    snapshot ||= await this.snapshot()
    const paths = [...snapshot.entries.keys()].filter((path) =>
      /^library\/trash\/[a-f0-9-]{36}\/record\.json$/.test(path),
    )
    const records = []
    // Limit parallel GitHub reads. Cached manifests need no further repository requests.
    for (let start = 0; start < paths.length; start += 6)
      records.push(
        ...(await Promise.all(
          paths.slice(start, start + 6).map((path) => this.readTrashRecord(path, snapshot)),
        )),
      )
    return records
      .filter((record) => !trashExpired(record, this.now()))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }
  async checkedTrash(record, latest) {
    const path = trashRecordPath(validateTrashRecord(record).id)
    if ((record.path && record.path !== path) || typeof record.sha !== "string" || !record.sha)
      throw new Error("回收站版本信息不完整，请重新载入。")
    if (latest.entries.get(path)?.sha !== record.sha)
      throw new Error("回收站记录已在另一端更改，请重新载入；本次未覆盖任何内容。")
    const current = await this.readTrashRecord(path, latest)
    if (current.sha !== record.sha || trashRecordContent(current) !== trashRecordContent(record))
      throw new Error("回收站记录已在另一端更改，请重新载入；本次未覆盖任何内容。")
    for (const item of current.articles) {
      const entry = latest.entries.get(item.sourcePath)
      if (entry?.sha !== item.sha || (entry.mode && entry.mode !== item.mode))
        throw new Error("回收站原文已在另一端更改，请重新载入。")
    }
    return current
  }
  async restoreTrash(record, _snapshot) {
    validateTrashRecord(record)
    const latest = await this.snapshot()
    const current = await this.checkedTrash(record, latest)
    if (trashExpired(current, this.now())) throw new Error("这篇文章已超过 30 天保留期，不能恢复。")
    validateCatalog(latest.catalog)
    const catalog = structuredClone(latest.catalog)
    for (const { article } of current.articles) {
      if (
        catalog.articles.some((other) => other.id === article.id || other.file === article.file) ||
        latest.entries.has(`library/${article.file}`)
      )
        throw new Error("同网址或原路径已有新文章，不能覆盖；请先处理冲突后再恢复。")
      if (
        article.draftOf &&
        !current.articles.some((other) => other.article.id === article.draftOf) &&
        !catalog.articles.some((other) => other.id === article.draftOf)
      )
        throw new Error("修改草稿的原文章尚未恢复，请先恢复原文章。")
      if (article.draftOf && catalog.articles.some((other) => other.draftOf === article.draftOf))
        throw new Error("这篇文章已有修改草稿，请先处理现有草稿后再恢复。")
    }
    for (const { article, index } of [...current.articles].sort((a, b) => a.index - b.index))
      catalog.articles.splice(Math.min(index, catalog.articles.length), 0, article)
    validateCatalog(catalog)
    const result = await this.commit(
      latest,
      [
        {
          path: CATALOG_PATH,
          mode: "100644",
          type: "blob",
          content: JSON.stringify(catalog, null, 2) + "\n",
        },
        ...current.articles.map(({ article, sha, mode }) => ({
          path: `library/${article.file}`,
          mode,
          type: "blob",
          sha,
        })),
        ...trashPaths(current).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      ],
      `Restore article: ${current.title}`,
    )
    return {
      ...result,
      articleId: current.articleId,
      restoredIds: current.articles.map((item) => item.article.id),
      published: current.published,
      scope: current.published ? "published" : "draft",
      trashId: current.id,
    }
  }
  async purgeTrash(record, _snapshot) {
    validateTrashRecord(record)
    const latest = await this.snapshot()
    const current = await this.checkedTrash(record, latest)
    const result = await this.commit(
      latest,
      trashPaths(current).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      `Permanently remove recycled article: ${current.title}`,
    )
    return { ...result, trashId: current.id }
  }
  async pruneExpiredTrash(_snapshot) {
    const latest = await this.snapshot()
    const paths = [...latest.entries.keys()].filter((path) =>
      /^library\/trash\/[a-f0-9-]{36}\/record\.json$/.test(path),
    )
    const expired = []
    for (const path of paths) {
      const record = await this.readTrashRecord(path, latest)
      if (trashExpired(record, this.now())) expired.push(await this.checkedTrash(record, latest))
    }
    if (!expired.length) return null
    return this.commit(
      latest,
      expired.flatMap((record) =>
        trashPaths(record).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      ),
      `Expire ${expired.length} recycled article groups after 30 days`,
    )
  }
  async readAsset(file, snapshot) {
    if (!safeRelative(file) || !/^assets\/.+\.(png|jpg|jpeg|gif|webp|avif)$/i.test(file))
      throw new Error("不支持的图片路径。")
    const entry = snapshot.entries.get("library/" + file)
    if (!entry) throw new Error("图片尚未上传。")
    const blob = await this.repo(`git/blobs/${entry.sha}`)
    const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), (ch) => ch.charCodeAt(0))
    const type = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
    }[file.split(".").pop().toLowerCase()]
    return new Blob([bytes], { type })
  }
  async commit(latest, changes, message) {
    const saved = await committedSnapshot(latest, changes)
    const tree = await this.repo("git/trees", "POST", { base_tree: latest.tree, tree: changes })
    const commit = await this.repo("git/commits", "POST", {
      message,
      tree: tree.sha,
      parents: [latest.commit],
    })
    // Never force-update: a commit arriving after our snapshot prevents this write.
    await this.repo(`git/refs/heads/${this.branch}`, "PATCH", { sha: commit.sha, force: false })
    return {
      sha: commit.sha,
      url: `https://github.com/${this.repository}/commit/${commit.sha}`,
      snapshot: { ...saved, commit: commit.sha, tree: tree.sha },
    }
  }
}
