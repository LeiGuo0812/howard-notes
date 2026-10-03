import { BACKUP_TABLES } from "../../content-service/backups.mjs"

export function verifyDeploymentSchema(rows) {
  for (const name of [
    "content_state",
    "sync_session",
    "public_documents",
    "public_pages",
    "public_payloads",
    "backups_epoch",
    ...BACKUP_TABLES,
  ]) {
    if (!rows.some((row) => row.type === "table" && row.name === name))
      throw new Error(`数据库缺少必需表 ${name}，已停止部署。`)
  }
  for (const table of BACKUP_TABLES)
    for (const operation of ["insert", "update", "delete"]) {
      const name = `backup_epoch_${table}_${operation}`
      const guard = rows.find((row) => row.type === "trigger" && row.name === name)
      const normalized = guard?.sql
        ?.toLowerCase()
        .replace(/\bif\s+not\s+exists\s+/g, "")
        .replace(/[\s"`\[\]]/g, "")
        .replace(/;$/, "")
      if (
        guard?.tbl_name !== table ||
        normalized !==
          `createtrigger${name}after${operation}on${table}beginupdatebackups_epochsetgeneration=generation+1whereid=1;end`
      )
        throw new Error(`数据库备份写入保护不完整: ${name}，已停止部署。`)
    }
  return true
}
