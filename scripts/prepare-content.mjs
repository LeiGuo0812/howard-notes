import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import { readLibrary, renderLibrary, walk } from "./lib/library.mjs"

const { catalog, sources } = await readLibrary("library")
const { output, warnings, records } = renderLibrary(catalog, sources)
for (const file of await walk("site"))
  if (file.endsWith(".md")) output.set(path.relative("site", file), await fs.readFile(file))
const groups = new Map()
for (const article of catalog.articles.filter((article) => article.published)) {
  if (!groups.has(article.category)) groups.set(article.category, [])
  groups.get(article.category).push(article)
}
let topics = `---\n${YAML.stringify({ title: "专题导航", description: "按主题浏览原文笔记。", publish: true, draft: false })}---\n\n`
for (const [category, articles] of groups) {
  topics += `## ${category}\n\n`
  for (const article of articles.sort((a, b) => a.title.localeCompare(b.title, "zh-CN")))
    topics += `- [${article.title.replace(/[\[\]]/g, "")}](notes/${article.id})\n`
  topics += "\n"
}
output.set("topics.md", Buffer.from(topics))
// content is generated and ignored. The original bytes live exclusively in library.
await fs.mkdir("content", { recursive: true })
for (const file of await walk("content")) await fs.unlink(file)
for (const [file, bytes] of output) {
  const target = path.join("content", file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, bytes)
}
await fs.writeFile(
  "content/.publish-manifest.json",
  JSON.stringify({ files: [...output.keys()].sort(), records, warnings }, null, 2) + "\n",
)
await fs.mkdir(".local", { recursive: true })
await fs.writeFile(
  ".local/render-report.json",
  JSON.stringify({ articles: records.length, warnings }, null, 2),
)
console.log(
  `Prepared ${records.length} original notes, ${groups.size} topics; ${warnings.length} unavailable source references retained as text.`,
)
