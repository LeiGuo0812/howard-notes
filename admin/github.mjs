import {
  CATALOG_PATH,
  REPOSITORY,
  BRANCH,
  validateCatalog,
  mergeArticle,
  safeRelative,
} from "../scripts/lib/catalog.mjs"
import { SITE_PATH, validateSite } from "../scripts/lib/site-settings.mjs"

export function decodeBase64(base64) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    Uint8Array.from(atob(base64.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)),
  )
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
            ? "GitHub 拒绝了请求。请检查令牌的仓库权限或 API 额度。"
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
    if (!repository.permissions?.push) throw new Error("当前账号或令牌没有此仓库的写入权限。")
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
    const blob = await this.repo(`git/blobs/${entry.sha}`)
    return { text: decodeBase64(blob.content), sha: entry.sha }
  }
  async save({ opened, openedSha, edited, text, images = [] }) {
    const latest = await this.snapshot()
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
    return this.commit(
      latest,
      changes,
      `${edited.published ? "Publish" : "Save draft"}: ${edited.title}`,
    )
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
    const tree = await this.repo("git/trees", "POST", { base_tree: latest.tree, tree: changes })
    const commit = await this.repo("git/commits", "POST", {
      message,
      tree: tree.sha,
      parents: [latest.commit],
    })
    // Never force-update: a commit arriving after our snapshot prevents this write.
    await this.repo(`git/refs/heads/${BRANCH}`, "PATCH", { sha: commit.sha, force: false })
    return { sha: commit.sha, url: `https://github.com/${REPOSITORY}/commit/${commit.sha}` }
  }
}
