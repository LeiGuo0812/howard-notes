import { GitHubLibrary } from "../admin/github.mjs"
import { imageHostSettings, encodePath, attachmentLink } from "../scripts/lib/image-host.mjs"

const sha256Pattern = /^[a-f0-9]{64}$/
function publicUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/\/api\/content\/personal\//.test(url.pathname)
      ? url.href
      : null
  } catch {
    return null
  }
}
const failure = (message) => {
  const error = new Error(message)
  error.status = 409
  return error
}
export function publicAttachmentMapping(attachment) {
  const url = publicUrl(attachment.publicUrl)
  if (
    !url ||
    typeof attachment.source !== "string" ||
    !attachment.source ||
    attachment.source.length > 2000
  )
    throw failure("私密附件的公开映射不完整，未发布文章。")
  return {
    source: attachment.source,
    publicUrl: url,
    ...(Array.isArray(attachment.aliases)
      ? {
          aliases: attachment.aliases
            .filter((v) => typeof v === "string" && v.length <= 2000)
            .slice(0, 20),
        }
      : {}),
  }
}
// A separate explicit consent precedes any public image-repository write. The
// public catalogue contains only source-to-URL mappings, never R2 identities.
export async function publishPrivateAttachments(
  env,
  db,
  client,
  article,
  settings,
  consent,
  previous = [],
) {
  const original = article.attachments || []
  if (!Array.isArray(original) || original.length > 1000) throw failure("附件列表格式不正确。")
  if (
    original.some((a) => !a || typeof a.source !== "string" || !a.source || a.source.length > 2000)
  )
    throw failure("请先保存完整附件引用，再发布文章。")
  const attachments = original.map((attachment) => {
    const mapping = previous.find((item) => item.source === attachment.source)
    return mapping ? { ...attachment, publicUrl: mapping.publicUrl } : attachment
  })
  if (!attachments.length) return { mappings: [], complete: true }
  const privateAttachments = attachments.filter((a) => !publicUrl(a.publicUrl))
  if (privateAttachments.length && consent !== true)
    throw failure("请明确确认将私密附件上传公开图床，再发布文章。")
  if (!privateAttachments.length)
    return { mappings: attachments.map(publicAttachmentMapping), complete: true }
  if (!env.PERSONAL_FILES_BUCKET) throw failure("私密附件存储暂不可用，未发布文章。")
  const host = imageHostSettings(settings)
  const images = new GitHubLibrary(client.token, client.fetcher, {
    repository: host.repository,
    branch: host.branch,
  })
  const repository = await images.request(`/repos/${host.repository}`)
  if (repository.private || !repository.permissions?.push)
    throw failure("请确认图床是公开仓库且登录账号有写入权限。")
  const ref = await images.repo(`git/ref/heads/${encodePath(host.branch)}`)
  const head = await images.repo(`git/commits/${ref.object.sha}`)
  const tree = await images.repo(`git/trees/${head.tree.sha}?recursive=1`)
  if (tree.truncated) throw failure("图床目录过大，无法安全验证附件路径。")
  const entries = new Map(tree.tree.map((entry) => [entry.path, entry]))
  const changes = [],
    targets = new Map(),
    uploadedPaths = new Set()
  // One immutable object per queue step bounds memory and network work. The
  // job stores each acknowledged mapping before proceeding to the next file.
  for (const attachment of privateAttachments.slice(0, 1)) {
    const row = await db
      .prepare("SELECT * FROM personal_files WHERE id=? AND complete=1")
      .bind(attachment.fileId || "")
      .first()
    if (
      !row ||
      !sha256Pattern.test(row.sha256) ||
      row.object_key !== `personal-files/${row.sha256}`
    )
      throw failure("找不到完整私密附件，原文已保留。")
    const object = await env.PERSONAL_FILES_BUCKET.get(row.object_key)
    if (!object || object.size !== row.size) throw failure("私密附件缺失或大小已改变，未发布文章。")
    const bytes = new Uint8Array(await object.arrayBuffer())
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
    if (hash !== row.sha256) throw failure("附件原文字节校验失败，未发布文章。")
    const extension = /\.([a-zA-Z0-9]{1,12})$/.exec(row.name)?.[1].toLowerCase() || "bin"
    const name = `${row.sha256}.${extension}`
    const path = [host.directory, name].filter(Boolean).join("/")
    const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`)
    let gitDigest
    if (typeof crypto.DigestStream === "function") {
      const stream = new crypto.DigestStream("SHA-1"),
        writer = stream.getWriter()
      await writer.write(prefix)
      await writer.write(bytes)
      await writer.close()
      gitDigest = await stream.digest
    } else {
      const body = new Uint8Array(prefix.length + bytes.length)
      body.set(prefix)
      body.set(bytes, prefix.length)
      gitDigest = await crypto.subtle.digest("SHA-1", body)
    }
    const gitSha = [...new Uint8Array(gitDigest)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
    const previous = entries.get(path)
    if (previous && (previous.type !== "blob" || previous.sha !== gitSha))
      throw failure("图床同一路径已有其他文件，本次未覆盖。")
    if (!previous && !uploadedPaths.has(path)) {
      let base64
      if (typeof bytes.toBase64 === "function") base64 = bytes.toBase64()
      else {
        let binary = ""
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
        base64 = btoa(binary)
      }
      const blob = await images.repo("git/blobs", "POST", { content: base64, encoding: "base64" })
      if (blob.sha !== gitSha) throw failure("图床原文字节校验失败。")
      changes.push({ path, mode: "100644", type: "blob", sha: blob.sha })
      uploadedPaths.add(path)
    }
    targets.set(attachment.fileId, { name, path })
  }
  let commit = ref.object.sha
  if (changes.length) {
    const nextTree = await images.repo("git/trees", "POST", {
      base_tree: head.tree.sha,
      tree: changes,
    })
    const nextCommit = await images.repo("git/commits", "POST", {
      message: `Publish ${changes.length} explicitly approved note attachments`,
      tree: nextTree.sha,
      parents: [ref.object.sha],
    })
    await images.repo(`git/refs/heads/${encodePath(host.branch)}`, "PATCH", {
      sha: nextCommit.sha,
      force: false,
    })
    commit = nextCommit.sha
  }
  const mapped = attachments.map((attachment) => ({
    ...attachment,
    publicUrl: targets.has(attachment.fileId)
      ? attachmentLink(host, commit, targets.get(attachment.fileId).name)
      : attachment.publicUrl,
  }))
  return {
    mappings: mapped.filter((a) => publicUrl(a.publicUrl)).map(publicAttachmentMapping),
    complete: mapped.every((a) => publicUrl(a.publicUrl)),
  }
}
