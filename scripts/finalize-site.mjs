import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import { pageSecurityPolicy } from "./lib/content-security.mjs"

const config = YAML.parse(await fs.readFile("quartz.config.yaml", "utf8")).configuration
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
config.pageTitle = `${settings.brand.name} ${settings.brand.subtitle}`.trim()
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
// The login-only shell contains no private data and stays outside public discovery.
const searchFile = "public/static/contentIndex.json"
const searchIndex = JSON.parse(await fs.readFile(searchFile, "utf8"))
delete searchIndex["private/index"]
await fs.writeFile(searchFile, JSON.stringify(searchIndex))
const sitemapFile = "public/sitemap.xml"
const sitemap = await fs.readFile(sitemapFile, "utf8")
await fs.writeFile(
  sitemapFile,
  sitemap.replace(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g, (entry, location) =>
    [base + "/private", base + "/private/", base + "/private/index"].includes(location)
      ? ""
      : entry,
  ),
)
articles.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
const items = articles
  .map(
    (article) =>
      `<item><title>${escape(article.title)}</title><link>${base}/${article.slug}</link><guid isPermaLink="true">${base}/${article.slug}</guid><pubDate>${new Date(article.date + "T00:00:00+08:00").toUTCString()}</pubDate><description>${escape(article.description)}</description></item>`,
  )
  .join("\n")
await fs.writeFile(
  "public/index.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(config.pageTitle)}</title><link>${base}/</link><description>${escape(settings.home.description || settings.brand.subtitle)}</description><language>zh-CN</language><atom:link href="${base}/index.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>\n`,
)
await fs.writeFile("public/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`)
console.log(`RSS: ${articles.length} articles`)

// GitHub Pages cannot set response headers. Its static fallback receives the same
// script restrictions in an early meta policy, before any bootstrap executes.
const [authConfig, runtimeConfig] = await Promise.all([
  fs.readFile("admin/auth-config.json", "utf8").then(JSON.parse),
  fs.readFile("runtime/config.json", "utf8").then(JSON.parse),
])
const policy = await pageSecurityPolicy({
  basePath: new URL(base).pathname.replace(/\/$/, ""),
  connectOrigins: [authConfig.brokerOrigin, runtimeConfig.enabled ? runtimeConfig.apiBase : ""],
  meta: true,
})
async function securePages(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await securePages(file)
    else if (entry.name.endsWith(".html")) {
      let html = await fs.readFile(file, "utf8")
      if (!/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
        html = html.replace(
          /<head>/i,
          `<head><meta http-equiv="Content-Security-Policy" content="${escape(policy)}">`,
        )
        await fs.writeFile(file, html)
      }
    }
  }
}
await securePages("public")
