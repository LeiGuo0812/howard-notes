const KEY = "howard-notes:local-trash:v1"
const TTL = 30 * 86400000
export function listLocalTrash(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) || "null")
    if (value?.version !== 1 || !Array.isArray(value.records)) return []
    const records = value.records.filter(
      (row) =>
        row?.local === true &&
        typeof row.id === "string" &&
        typeof row.recovery?.form?.body === "string" &&
        Number.isFinite(row.expiresAt) &&
        row.expiresAt > now,
    )
    if (records.length !== value.records.length) write(storage, records)
    return records
  } catch {
    return []
  }
}
function write(storage, records) {
  const data = JSON.stringify({ version: 1, records })
  if (data.length > 4000000) throw new Error("回收站内容较大，请先下载正文或清理已有本地记录。")
  storage.setItem(KEY, data)
}
export function trashLocalRecovery(storage, recovery, now = Date.now()) {
  if (!storage) throw new Error("当前浏览器无法保存回收站，请先下载正文。")
  const record = {
    id: crypto.randomUUID(),
    local: true,
    title: recovery.form.title || "未命名文章",
    deletedAt: new Date(now).toISOString(),
    expiresAt: now + TTL,
    recovery: structuredClone(recovery),
  }
  write(storage, [...listLocalTrash(storage, now), record])
  return record
}
export function removeLocalTrash(storage, id, now = Date.now()) {
  write(
    storage,
    listLocalTrash(storage, now).filter((row) => row.id !== id),
  )
}
