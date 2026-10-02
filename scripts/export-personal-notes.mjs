import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { contentEndpoint, ownerToken, ownerRequest } from "./lib/owner-token.mjs"
import { safeRelative } from "./lib/catalog.mjs"

const { values } = parseArgs({ options: { site: { type: "string" }, output: { type: "string" } } })
if (!values.site || !values.output)
  throw new Error(
    "请使用 --site <SITE_URL> --output <NEW_PRIVATE_EXPORT_DIR>；此命令不修改远端或已有本地笔记。",
  )
await fs.mkdir(values.output, { recursive: false, mode: 0o700 })
const request = ownerRequest(contentEndpoint(values.site), await ownerToken())
const tables = {}
let generation = null
for (const type of ["articles", "drafts", "versions", "draftVersions", "files", "attachments"]) {
  const records = []
  let page = 1
  while (page) {
    const result = await request(
      `personal/export?type=${type}&page=${page}${generation === null ? "" : `&generation=${generation}`}`,
    )
    if (
      !Number.isSafeInteger(result.generation) ||
      (generation !== null && result.generation !== generation)
    )
      throw new Error("导出时远端已有修改，未生成成功标记，请重新导出。")
    generation = result.generation
    records.push(...result.records)
    page = result.nextPage
  }
  tables[type] = records
  await fs.writeFile(path.join(values.output, `${type}.json`), JSON.stringify(records, null, 2), {
    flag: "wx",
    mode: 0o600,
  })
}
for (const record of tables.articles) {
  const article = JSON.parse(record.article)
  if (!safeRelative(article.file)) throw new Error("导出包含不安全原文路径。")
  const file = path.join(values.output, "markdown", article.file)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, record.raw, { flag: "wx", mode: 0o600 })
}
// Binary objects are included by the independent encrypted backup exporter.
// This is a readable text export, and never a two-way synchronization source.
const checked = await request(`personal/export?type=articles&page=1&generation=${generation}`)
if (checked.generation !== generation) throw new Error("导出时远端已有修改，请重新导出。")
await fs.writeFile(
  path.join(values.output, "manifest.json"),
  JSON.stringify(
    {
      format: "personal-notes-readonly-export-v1",
      createdAt: new Date().toISOString(),
      private: true,
      generation,
      consistent: true,
      articles: tables.articles.length,
      drafts: tables.drafts.length,
      binaryAttachments: "use-encrypted-backup",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
)
console.log(
  JSON.stringify({
    readonly: true,
    articles: tables.articles.length,
    drafts: tables.drafts.length,
  }),
)
