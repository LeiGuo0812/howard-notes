import { encodePath, imageLink, validateImageHost } from "../scripts/lib/image-host.mjs"

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("")
function extension(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes.length >= 24 && hex(bytes.subarray(0, 8)) === "89504e470d0a1a0a") return "png"
  if (bytes.length >= 4 && hex(bytes.subarray(0, 3)) === "ffd8ff") return "jpg"
  if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "gif"
  if (bytes.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp"
  if (bytes.length >= 16 && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12)))
    return "avif"
  throw new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。")
}

export async function prepareImage(file, { binaryOnly = false } = {}) {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error("图片需非空且不超过 10 MiB。")
  const bytes = new Uint8Array(await file.arrayBuffer()),
    ext = extension(bytes)
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes))
  const alt = (file.name || "粘贴图片").replace(/[\\\[\]\r\n]/g, "").slice(0, 200)
  // Private uploads use the original binary. Avoid a second read, SHA-1
  // calculation and base64 expansion on the browser's interaction thread.
  if (binaryOnly) return { bytes, sha256: digest, alt, extension: ext }
  const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const object = new Uint8Array(prefix.length + bytes.length)
  object.set(prefix)
  object.set(bytes, prefix.length)
  const blobSha = hex(await crypto.subtle.digest("SHA-1", object))
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return {
    file: `${digest}.${ext}`,
    blobSha,
    base64: btoa(binary),
    alt,
  }
}

export class GitHubImageHost {
  constructor(client, settings) {
    this.client = client
    this.settings = structuredClone(validateImageHost(settings))
  }
  async request(endpoint, method, body) {
    try {
      return await this.client.request(
        `/repos/${this.settings.repository}${endpoint}`,
        method,
        body,
      )
    } catch (error) {
      if ([403, 404].includes(error.status)) {
        error.message = `无法访问图片仓库 ${this.settings.repository}，请检查仓库名称，并在“仓库授权”中添加此仓库后重新登录。`
        error.code = "IMAGE_PERMISSION"
      }
      throw error
    }
  }
  async checkAccess() {
    const repo = await this.request("")
    if (repo.private) throw new Error("图片仓库需要设为公开，网站读者才能打开图片链接。")
    if (!repo.permissions?.push) {
      const error = new Error(
        `没有图片仓库 ${this.settings.repository} 的写入权限，请在“仓库授权”中添加此仓库后重新登录。`,
      )
      error.code = "IMAGE_PERMISSION"
      throw error
    }
    let ref
    try {
      ref = await this.request(`/git/ref/heads/${encodePath(this.settings.branch)}`)
    } catch (error) {
      if (error.status === 404)
        error.message = `找不到图片分支 ${this.settings.branch}，请检查分支名称和仓库授权。`
      throw error
    }
    return ref.object.sha
  }
  async upload(images, progress = () => {}) {
    if (!images.length) return []
    const unique = new Map()
    for (const image of images) {
      if (
        !/^[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/.test(image.file) ||
        !/^[a-f0-9]{40}$/.test(image.blobSha)
      )
        throw new Error("图片文件信息不正确。")
      unique.set(image.file, image)
    }
    const headSha = await this.checkAccess()
    const head = await this.request(`/git/commits/${headSha}`)
    const tree = await this.request(`/git/trees/${head.tree.sha}?recursive=1`)
    if (tree.truncated) throw new Error("图片仓库目录过大，未能取得完整文件列表。")
    const entries = new Map(tree.tree.map((item) => [item.path, item]))
    const targets = [...unique.values()].map((image) => ({
      image,
      path: [this.settings.directory, image.file].filter(Boolean).join("/"),
    }))
    for (const { image, path } of targets) {
      const previous = entries.get(path)
      if (previous && (previous.type !== "blob" || previous.sha !== image.blobSha))
        throw new Error("图片路径已存在其他内容，本次未覆盖。请更改图片目录后重试。")
    }
    const changes = []
    for (const [index, { image, path }] of targets.entries()) {
      progress(index + 1, targets.length)
      if (entries.has(path)) continue
      const blob = await this.request("/git/blobs", "POST", {
        content: image.base64,
        encoding: "base64",
      })
      if (blob.sha !== image.blobSha) throw new Error("图片完整性校验失败，本次未更新仓库。")
      changes.push({ path, mode: "100644", type: "blob", sha: blob.sha })
    }
    let commitSha = headSha
    if (changes.length) {
      const nextTree = await this.request("/git/trees", "POST", {
        base_tree: head.tree.sha,
        tree: changes,
      })
      const commit = await this.request("/git/commits", "POST", {
        message: `Upload ${changes.length} blog image${changes.length === 1 ? "" : "s"}`,
        tree: nextTree.sha,
        parents: [headSha],
      })
      await this.request(`/git/refs/heads/${encodePath(this.settings.branch)}`, "PATCH", {
        sha: commit.sha,
        force: false,
      })
      commitSha = commit.sha
    }
    return images.map((image) => ({
      ...image,
      url: imageLink(this.settings, commitSha, image.file),
    }))
  }
}
