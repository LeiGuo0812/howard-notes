export const DEFAULT_IMAGE_HOST = Object.freeze({
  repository: "LeiGuo0812/pic_cloud_gl",
  directory: "img",
  branch: "main",
})

export function validateImageHost(host) {
  if (
    !host ||
    typeof host.repository !== "string" ||
    host.repository.length > 200 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host.repository)
  )
    throw new Error("图片仓库请填写“账号/仓库名”。")
  if (
    typeof host.directory !== "string" ||
    host.directory.length > 300 ||
    (host.directory &&
      host.directory.split("/").some((part) => !part || part === "." || part.startsWith("."))) ||
    /[\\\u0000-\u001f\u007f%?#]/.test(host.directory)
  )
    throw new Error("图片目录请填写相对路径，例如 img 或 img/notes；留空表示仓库根目录。")
  if (
    typeof host.branch !== "string" ||
    !host.branch ||
    host.branch.length > 200 ||
    /[\s~^:?*\[\\\u0000-\u001f\u007f]/.test(host.branch) ||
    host.branch.includes("..") ||
    host.branch.includes("@{") ||
    host.branch.endsWith(".") ||
    host.branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  )
    throw new Error("图片分支名称不正确。")
  return host
}

export function imageHostSettings(settings) {
  return validateImageHost(settings.imageHost || { ...DEFAULT_IMAGE_HOST })
}

export const encodePath = (path) =>
  path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/")

export function imageLink(host, commit, file) {
  validateImageHost(host)
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/.test(file))
    throw new Error("图片链接信息不完整。")
  return attachmentLink(host, commit, file)
}

export function attachmentLink(host, commit, file) {
  validateImageHost(host)
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(file))
    throw new Error("附件链接信息不完整。")
  const path = [host.directory, file].filter(Boolean).join("/")
  return `https://raw.githubusercontent.com/${host.repository}/${commit}/${encodePath(path)}`
}
