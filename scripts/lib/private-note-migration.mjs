import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { splitNote, extractNoteTags } from "./library-render.mjs"
import { sourceDates } from "./note-dates.mjs"
import { safeRelative, validateCatalog } from "./catalog.mjs"

export const byteHash = (value) => createHash("sha256").update(value).digest("hex")
const day = (value) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(value)
export async function privateMigrationNotes(vault, inventory) {
  const root = await fs.realpath(vault),
    entries = []
  const paths = new Set()
  for (const row of inventory.notes) {
    if (row.state !== "未上传") continue
    const normalizedPath = row.path.normalize("NFC")
    if (paths.has(normalizedPath)) throw new Error("原文路径归一化后重复，未迁移任何内容。")
    paths.add(normalizedPath)
    if (
      !safeRelative(row.path) ||
      row.path.split("/").some((part) => part === "博客发布") ||
      !row.path.endsWith(".md")
    )
      throw new Error("迁移清单包含不支持的源路径。")
    const file = path.join(root, row.path),
      real = await fs.realpath(file)
    if (!real.startsWith(root + path.sep) || (await fs.lstat(file)).isSymbolicLink())
      throw new Error("原文路径越出笔记库或是符号链接。")
    const bytes = await fs.readFile(file),
      sourceHash = byteHash(bytes)
    if (sourceHash !== row.sha256)
      throw new Error("本地原文在盘点后已有变化；请先重新盘点，不会覆盖任何网页版本。")
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    if (!Buffer.from(raw, "utf8").equals(bytes))
      throw new Error("原文件不是可逐字节恢复的 UTF-8 Markdown。")
    const stat = await fs.stat(file),
      { data } = splitNote(raw),
      dates = sourceDates(data)
    const modified = dates.modified || day(stat.mtime)
    const created = dates.created || day(stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime)
    const id = `private-note-${byteHash(Buffer.from(row.path)).slice(0, 16)}`
    const article = {
      id,
      file: `notes/${row.path}`,
      title: path.basename(row.path, ".md"),
      category: row.category || "未分类",
      published: false,
      featured: false,
      date: created,
      created,
      modified,
      tags: extractNoteTags(raw),
    }
    validateCatalog({ version: 2, articles: [article] })
    entries.push({
      article,
      raw,
      sourceHash,
      metadata: {
        originalPath: row.path,
        dateEvidence: {
          created: dates.created ? "frontmatter" : "filesystem",
          modified: dates.modified ? "frontmatter" : "filesystem",
        },
      },
    })
  }
  validateCatalog({ version: 2, articles: entries.map((entry) => entry.article) })
  return entries
}
