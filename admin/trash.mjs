import { validateCatalog } from "../scripts/lib/catalog.mjs"

export const TRASH_PREFIX = "library/trash/"
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export function trashRecordPath(id) {
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("回收站记录路径不合法。")
  return `${TRASH_PREFIX}${id}/record.json`
}

// Archives contain references to reachable Git blobs, never rewritten Markdown strings.
// Restrict every reachable source path before restore or expiry can create tree changes.
export function validateTrashRecord(record) {
  if (record?.version !== 1 || !Array.isArray(record.articles) || !record.articles.length)
    throw new Error("回收站记录格式不正确。")
  const root = trashRecordPath(record.id).replace(/record\.json$/, "")
  const deleted = Date.parse(record.deletedAt)
  const expires = Date.parse(record.expiresAt)
  if (
    !Number.isFinite(deleted) ||
    !Number.isFinite(expires) ||
    new Date(deleted).toISOString() !== record.deletedAt ||
    new Date(expires).toISOString() !== record.expiresAt ||
    expires - deleted !== TRASH_RETENTION_MS ||
    record.articleId !== record.articles[0]?.article?.id ||
    record.title !== record.articles[0]?.article?.title ||
    record.published !== record.articles.some((item) => item.article?.published === true)
  )
    throw new Error("回收站记录的日期或文章信息不正确。")
  validateCatalog({ version: 2, articles: record.articles.map((item) => item.article) })
  for (const [position, item] of record.articles.entries()) {
    if (
      item.sourcePath !== `${root}sources/${position}.md` ||
      typeof item.sha !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(item.sha) ||
      !["100644", "100755"].includes(item.mode) ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      (position > 0 && item.article.draftOf !== record.articleId)
    )
      throw new Error("回收站原文存档信息不正确。")
  }
  return record
}

export function trashExpired(record, now = Date.now()) {
  validateTrashRecord(record)
  return Date.parse(record.expiresAt) <= now
}

export function trashRecordContent(record) {
  const { path: _path, sha: _sha, ...stored } = record
  return JSON.stringify(validateTrashRecord(stored), null, 2) + "\n"
}

export function trashPaths(record) {
  validateTrashRecord(record)
  return [trashRecordPath(record.id), ...record.articles.map((item) => item.sourcePath)]
}
