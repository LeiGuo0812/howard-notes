import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { validateCatalog } from "./catalog.mjs"
import { validateSite } from "./site-settings.mjs"

export const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
export async function walk(root, excluded = new Set()) {
  const files = []
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue
    const file = path.join(root, item.name)
    if (excluded.has(file)) continue
    if (item.isSymbolicLink()) throw new Error(`不支持符号链接：${file}`)
    if (item.isDirectory()) files.push(...(await walk(file, excluded)))
    else if (item.isFile()) files.push(file)
  }
  return files.sort()
}

export async function readLibrary(root) {
  const catalog = validateCatalog(
    JSON.parse(await fs.readFile(path.join(root, "catalog.json"), "utf8")),
  )
  const sources = new Map()
  // The complete archive namespace is private to maintenance. Do not even load archived
  // Markdown/manifests into static or runtime source maps, including malformed records.
  for (const file of await walk(root, new Set([path.join(root, "trash")])))
    sources.set(path.relative(root, file).split(path.sep).join("/"), await fs.readFile(file))
  if (sources.has("site.json")) validateSite(JSON.parse(sources.get("site.json").toString()))
  for (const article of catalog.articles)
    if (!sources.has(article.file)) throw new Error(`找不到原文：${article.file}`)
  const listed = new Set(catalog.articles.map((article) => article.file))
  for (const file of sources.keys()) {
    if (file.startsWith("notes/") && !listed.has(file)) throw new Error(`尚未登记发布设置：${file}`)
    if (
      !file.startsWith("notes/") &&
      !file.startsWith("assets/") &&
      !["catalog.json", "site.json"].includes(file)
    )
      throw new Error(`不支持的文库文件：${file}`)
  }
  return { catalog, sources }
}

export { escapeHTML, splitNote, extractNoteTags } from "./library-render.mjs"
import { renderLibrary as projectLibrary } from "./library-render.mjs"

export function renderLibrary(catalog, sources) {
  return projectLibrary(catalog, sources, {
    path,
    hash,
    encode: (text) => Buffer.from(text),
    decode: (bytes) => Buffer.from(bytes).toString("utf8"),
  })
}
