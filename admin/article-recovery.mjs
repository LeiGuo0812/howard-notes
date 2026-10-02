import { equal, validateCatalog } from "../scripts/lib/catalog.mjs"

const KEY = "howard-notes:article-recoveries:v1"
const LIMIT = 4000000
export const RECOVERY_FIELDS = [
  "title",
  "category",
  "description",
  "slug",
  "date",
  "published",
  "tags",
  "featured",
  "body",
]

function record(value) {
  if (!value || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) return null
  if (typeof value.raw !== "string" || typeof value.savedForm !== "string") return null
  if (value.openedSha !== null && typeof value.openedSha !== "string") return null
  if (value.article !== null) {
    validateCatalog({ version: 2, articles: [value.article] })
    if (value.article.id !== value.id || !value.openedSha) return null
  }
  if (!value.form || typeof value.form !== "object") return null
  const form = {}
  for (const field of RECOVERY_FIELDS) {
    const input = value.form[field]
    if (field === "featured" ? typeof input !== "boolean" : typeof input !== "string") return null
    form[field] = input
  }
  // Only content and its original conflict baseline are retained. Session credentials never enter storage.
  return {
    id: value.id,
    article: value.article === null ? null : structuredClone(value.article),
    openedSha: value.openedSha,
    raw: value.raw,
    savedForm: value.savedForm,
    form,
    attachments: Array.isArray(value.attachments)
      ? structuredClone(value.attachments)
          .filter(
            (item) => item && typeof item.fileId === "string" && typeof item.source === "string",
          )
          .map(({ fileId, source, name, mimeType, sha256, publicUrl }) => ({
            fileId,
            source,
            ...(name ? { name } : {}),
            ...(mimeType ? { mimeType } : {}),
            ...(sha256 ? { sha256 } : {}),
            ...(publicUrl ? { publicUrl } : {}),
          }))
      : [],
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
  }
}

export function listArticleRecoveries(storage) {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw || raw.length > LIMIT) return []
    const value = JSON.parse(raw)
    if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 20) return []
    return value.records.map(record).filter(Boolean)
  } catch {
    return []
  }
}

export function readArticleRecovery(storage, id) {
  return listArticleRecoveries(storage).find((value) => value.id === id) || null
}

export function writeArticleRecovery(storage, value) {
  const next = record(value)
  if (!next) throw new Error("文章恢复信息不完整。")
  next.savedAt = new Date().toISOString()
  const records = listArticleRecoveries(storage).filter((entry) => entry.id !== next.id)
  if (records.length >= 20) throw new Error("本地恢复记录已满，请先保存或清理已有文章。")
  records.push(next)
  const encoded = JSON.stringify({ version: 1, records })
  if (encoded.length > LIMIT) throw new Error("文章较大，无法在此浏览器暂存，请下载当前编辑。")
  storage.setItem(KEY, encoded)
}

export function clearArticleRecovery(storage, id) {
  const records = listArticleRecoveries(storage).filter((entry) => entry.id !== id)
  if (records.length) storage.setItem(KEY, JSON.stringify({ version: 1, records }))
  else storage.removeItem(KEY)
}

export function recoveredBaseline(recovery, latestArticle, latestSha) {
  return {
    article: recovery.article === null ? null : structuredClone(recovery.article),
    openedSha: recovery.openedSha,
    raw: recovery.raw,
    savedForm: recovery.savedForm,
    form: { ...recovery.form },
    attachments: structuredClone(recovery.attachments || []),
    stale:
      recovery.openedSha !== (latestSha ?? null) || !equal(recovery.article, latestArticle ?? null),
  }
}

export function editorSourceText(raw, edited) {
  if (edited === raw.replace(/\r\n?/g, "\n")) return raw
  const body = raw.startsWith("\uFEFF") ? "\uFEFF" + edited.replace(/^\uFEFF/, "") : edited
  return raw.includes("\r\n") ? body.replace(/\r?\n/g, "\r\n") : body
}
