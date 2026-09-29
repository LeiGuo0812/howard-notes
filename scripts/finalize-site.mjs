import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"

const config = YAML.parse(await fs.readFile("quartz.config.yaml", "utf8")).configuration
const base = "https://" + config.baseUrl.replace(/\/$/, "")
const escape = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch],
  )
const articles = []
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(file)
    else if (file.endsWith(".md")) {
      const text = await fs.readFile(file, "utf8")
      const match = text.match(/^---\n([\s\S]*?)\n---/)
      const data = match ? YAML.parse(match[1]) : {}
      if (data.type === "article" && data.publish === true && data.draft === false)
        articles.push({
          ...data,
          slug: path.relative("content", file).replace(/\.md$/, "").split(path.sep).join("/"),
        })
    }
  }
}
await walk("content/notes")
articles.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
const items = articles
  .map(
    (article) =>
      `<item><title>${escape(article.title)}</title><link>${base}/${article.slug}</link><guid isPermaLink="true">${base}/${article.slug}</guid><pubDate>${new Date(article.date + "T00:00:00+08:00").toUTCString()}</pubDate><description>${escape(article.description)}</description></item>`,
  )
  .join("\n")
await fs.writeFile(
  "public/index.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(config.pageTitle)}</title><link>${base}/</link><description>编程、数据分析与工具使用的技术笔记</description><language>zh-CN</language><atom:link href="${base}/index.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>\n`,
)
await fs.writeFile("public/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`)
console.log(`RSS: ${articles.length} articles`)
