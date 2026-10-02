import fs from "node:fs/promises"
import { parseArgs } from "node:util"
import { randomUUID } from "node:crypto"
import { privateMigrationNotes, byteHash } from "./lib/private-note-migration.mjs"
import { contentEndpoint, ownerToken, ownerRequest } from "./lib/owner-token.mjs"

const { values } = parseArgs({
  options: {
    vault: { type: "string" },
    inventory: { type: "string" },
    site: { type: "string" },
    apply: { type: "boolean", default: false },
    limit: { type: "string" },
    report: { type: "string" },
  },
})
if (!values.vault || !values.inventory)
  throw new Error(
    "请使用 --vault <OBSIDIAN_VAULT> --inventory <PRIVATE_INVENTORY_FILE>，默认仅盘点。",
  )
const inventory = JSON.parse(await fs.readFile(values.inventory, "utf8"))
let entries = await privateMigrationNotes(values.vault, inventory)
if (values.limit) {
  const limit = Number(values.limit)
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("试迁移数量不正确。")
  entries = entries.slice(0, limit)
}
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  apply: values.apply,
  private: true,
  notes: entries.length,
  bytes: entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.raw), 0),
  verified: 0,
  records: [],
}
if (values.apply) {
  if (!values.site) throw new Error("实际迁移需要 --site <SITE_URL>；只导入私密存储，不发布文章。")
  const request = ownerRequest(contentEndpoint(values.site), await ownerToken())
  // One original per invocation respects Workers Free's D1/CPU budget.
  // Repeating an interrupted import never overwrites a newer web edit.
  for (const entry of entries) {
    const response = await request("personal/articles/import", {
      articles: [
        {
          article: { ...entry.article, source: entry.metadata },
          raw: entry.raw,
          sourceHash: entry.sourceHash,
          requestId: randomUUID(),
        },
      ],
    })
    const acknowledgement = response.articles[0]
    const stored = await request(`personal/articles/${entry.article.id}`)
    const exact = byteHash(Buffer.from(stored.raw, "utf8")) === entry.sourceHash
    if (!exact && acknowledgement.imported)
      throw new Error("试迁移字节校验失败；保留本地原文，不继续导入。")
    report.records.push({
      id: entry.article.id,
      path: entry.metadata.originalPath,
      sourceHash: entry.sourceHash,
      remoteVersion: stored.version,
      exact,
      imported: Boolean(acknowledgement.imported),
      updatedOnWeb: !exact,
    })
    if (exact) report.verified++
    console.log(
      JSON.stringify({
        processed: report.records.length,
        total: entries.length,
        private: true,
        verified: report.verified,
      }),
    )
  }
}
if (values.report)
  await fs.writeFile(values.report, JSON.stringify(report, null, 2), { mode: 0o600 })
console.log(
  JSON.stringify({
    private: true,
    apply: report.apply,
    notes: report.notes,
    bytes: report.bytes,
    verified: report.verified,
  }),
)
