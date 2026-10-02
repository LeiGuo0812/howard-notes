import { githubMemoryAttachmentUrl } from "./memory-attachment-storage.mjs"

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`

export function attachmentStoragePlan(files, repository, commit) {
  return files.map((file) => {
    const storage = {
      provider: "github",
      repository,
      commit,
      path: file.path,
      sha256: file.sha256,
      size: file.size,
    }
    const url = githubMemoryAttachmentUrl(storage)
    if (!url) throw new Error("Invalid immutable attachment storage pointer")
    return { ...file, storage, url }
  })
}

export function attachmentMetadataSql(files, cards) {
  const mapping = new Map(files.map((file) => [file.id, file]))
  const statements = files.map(
    (file) =>
      `UPDATE memory_files SET metadata=json_set(metadata,'$.storage',json(${sql(JSON.stringify(file.storage))})) WHERE id=${sql(file.id)} AND sha256=${sql(file.sha256)} AND size=${file.size} AND complete=1;`,
  )
  let changedCards = 0
  for (const row of cards) {
    const card = JSON.parse(row.body)
    const attachments = card.attachments.map((attachment) => {
      const file = mapping.get(attachment.fileId)
      return file ? { ...attachment, url: file.url, storage: file.storage } : attachment
    })
    if (JSON.stringify(attachments) === JSON.stringify(card.attachments)) continue
    changedCards++
    // Optimistic guards preserve a concurrent edit. A post-write audit must
    // pass before the separate destructive phase is allowed to run.
    statements.push(
      `UPDATE memory_cards SET body=json_set(body,'$.attachments',json(${sql(JSON.stringify(attachments))})),version=version+1 WHERE id=${sql(row.id)} AND version=${row.version} AND body=${sql(row.body)};`,
    )
  }
  return { statements, changedCards }
}

export function verifyAttachmentMetadata(files, rows, cards, originalCards) {
  const mapping = new Map(files.map((file) => [file.id, file]))
  const current = new Map(rows.map((row) => [row.id, row]))
  for (const file of files) {
    const row = current.get(file.id)
    if (!row || row.sha256 !== file.sha256 || row.size !== file.size || row.complete !== 1)
      throw new Error("Attachment identity changed")
    if (JSON.stringify(JSON.parse(row.metadata).storage) !== JSON.stringify(file.storage))
      throw new Error("Attachment storage metadata is not activated")
  }
  const originals = new Map(originalCards.map((row) => [row.id, JSON.parse(row.body)]))
  if (cards.length !== originalCards.length)
    throw new Error("Card inventory changed during migration")
  let references = 0
  for (const row of cards) {
    const card = JSON.parse(row.body),
      original = originals.get(row.id)
    const { attachments, ...body } = card
    const { attachments: before, ...originalBody } = original || {}
    if (JSON.stringify(body) !== JSON.stringify(originalBody))
      throw new Error("Card text or settings changed during migration")
    if (attachments.length !== before.length) throw new Error("Attachment references changed")
    for (const [index, attachment] of attachments.entries()) {
      const file = mapping.get(attachment.fileId)
      if (!file) {
        if (JSON.stringify(attachment) !== JSON.stringify(before[index]))
          throw new Error("An unrelated attachment was modified")
        continue
      }
      const expected = { ...before[index], url: file.url, storage: file.storage }
      if (JSON.stringify(attachment) !== JSON.stringify(expected))
        throw new Error("Attachment link is not activated")
      references++
    }
  }
  return { files: files.length, cards: cards.length, references, originalTextPreserved: true }
}

export function attachmentPruneSql(files) {
  return files.map((file) => {
    const checks = Object.entries(file.storage).map(
      ([key, value]) =>
        `json_extract(f.metadata,'$.storage.${key}')=${typeof value === "number" ? value : sql(value)}`,
    )
    const cardChecks = Object.entries(file.storage).map(
      ([key, value]) =>
        `coalesce(json_extract(j.value,'$.storage.${key}'),'')<>${typeof value === "number" ? value : sql(value)}`,
    )
    return `DELETE FROM memory_file_chunks WHERE file_id=${sql(file.id)} AND EXISTS (SELECT 1 FROM memory_files f WHERE f.id=${sql(file.id)} AND f.sha256=${sql(file.sha256)} AND f.size=${file.size} AND f.complete=1 AND ${checks.join(" AND ")}) AND NOT EXISTS (SELECT 1 FROM memory_attachments a JOIN memory_cards m ON m.id=a.memory_id JOIN json_each(m.body,'$.attachments') j WHERE a.file_id=${sql(file.id)} AND json_extract(j.value,'$.fileId')=${sql(file.id)} AND (coalesce(json_extract(j.value,'$.url'),'')<>${sql(file.url)} OR ${cardChecks.join(" OR ")}));`
  })
}
