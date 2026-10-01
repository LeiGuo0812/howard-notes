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
  constructor(token, fetcher = (...args) => globalThis.fetch(...args)) {
    this.token = token
    this.fetcher = fetcher
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
    return this.request(`/repos/${REPOSITORY}/${endpoint}`, method, body)
  }
  async authenticate() {
    const user = await this.request("/user")
    const repository = await this.request(`/repos/${REPOSITORY}`)
    if (!repository.permissions?.push) throw new Error("当前账号没有此仓库的写入权限。")
    return user.login
  }
  async snapshot() {
    const ref = await this.repo(`git/ref/heads/${BRANCH}`)
    const head = await this.repo(`git/commits/${ref.object.sha}`)
    const tree = await this.repo(`git/trees/${head.tree.sha}?recursive=1`)
    if (tree.truncated) throw new Error("仓库目录过大，未能取得完整文件列表。")
    const entries = new Map(
      tree.tree.filter((item) => item.type === "blob").map((item) => [item.path, item]),
    )
    const catalogEntry = entries.get(CATALOG_PATH)
    if (!catalogEntry) throw new Error("尚未找到发布目录，请等待网站升级部署完成。")
    const blob = await this.repo(`git/blobs/${catalogEntry.sha}`)
    const catalog = validateCatalog(JSON.parse(decodeBase64(blob.content)))
    const siteEntry = entries.get(SITE_PATH)
    if (!siteEntry) throw new Error("页面设置尚未部署，请稍后刷新。")
    const siteBlob = await this.repo(`git/blobs/${siteEntry.sha}`)
    const settings = validateSite(JSON.parse(decodeBase64(siteBlob.content)))
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
    const blob = await this.repo(`git/blobs/${entry.sha}`)
    return { text: decodeBase64(blob.content), sha: entry.sha }
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
    const removedIds = removed.map((article) => article.id)
    const catalog = structuredClone(latest.catalog)
    catalog.articles = catalog.articles.filter((article) => !removedIds.includes(article.id))
    const result = await this.commit(
      latest,
      [
        {
          path: CATALOG_PATH,
          mode: "100644",
          type: "blob",
          content: JSON.stringify(catalog, null, 2) + "\n",
        },
        ...removed.map((article) => ({
          path: `library/${article.file}`,
          mode: "100644",
          type: "blob",
          sha: null,
        })),
      ],
      `Delete article: ${opened.title}`,
    )
    return { ...result, removedIds }
  }
  async removeDraft({ opened, openedSha }) {
    if (!opened || opened.published !== false) throw new Error("只能删除未发布的草稿。")
    if (typeof openedSha !== "string" || !openedSha)
      throw new Error("草稿删除版本信息不完整，请重新载入。")
    validateCatalog({ version: 2, articles: [opened] })
    const latest = await this.snapshot()
    validateCatalog(latest.catalog)
    const current = latest.catalog.articles.find((article) => article.id === opened.id)
    if (!equal(current, opened) || latest.entries.get(`library/${opened.file}`)?.sha !== openedSha)
      throw new Error("草稿已在另一端更改，请重新载入；本次没有删除远端内容。")
    const catalog = structuredClone(latest.catalog)
    catalog.articles = catalog.articles.filter((article) => article.id !== opened.id)
    return this.commit(
      latest,
      [
        {
          path: CATALOG_PATH,
          mode: "100644",
          type: "blob",
          content: JSON.stringify(catalog, null, 2) + "\n",
        },
        { path: `library/${opened.file}`, mode: "100644", type: "blob", sha: null },
      ],
      `Delete draft: ${opened.title}`,
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
    await this.repo(`git/refs/heads/${BRANCH}`, "PATCH", { sha: commit.sha, force: false })
    return {
      sha: commit.sha,
      url: `https://github.com/${REPOSITORY}/commit/${commit.sha}`,
      snapshot: { ...saved, commit: commit.sha, tree: tree.sha },
    }
  }
}
