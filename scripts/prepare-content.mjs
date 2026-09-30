import fs from "node:fs/promises"
import path from "node:path"
import { readLibrary, renderLibrary, walk } from "./lib/library.mjs"
import { generateSitePages } from "./lib/site-pages.mjs"
import { readActivity } from "./lib/activity.mjs"

const { catalog, sources } = await readLibrary("library")
const { output, warnings, records } = renderLibrary(catalog, sources)
for (const file of await walk("site"))
  if (file.endsWith(".md")) output.set(path.relative("site", file), await fs.readFile(file))
const settings = JSON.parse(sources.get("site.json").toString())
const pages = generateSitePages(settings, catalog, readActivity(catalog.articles), 24, sources)
for (const [file, bytes] of pages.output) output.set(file, bytes)
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
await fs.writeFile(".local/blog-data.json", JSON.stringify(pages.data))
await fs.writeFile(
  ".local/render-report.json",
  JSON.stringify({ articles: records.length, warnings }, null, 2),
)
console.log(
  `Prepared ${records.length} original notes, ${pages.data.topics.length} topics; ${warnings.length} unavailable source references retained as text.`,
)
