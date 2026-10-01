import fs from "node:fs/promises"
import path from "node:path"
import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
import YAML from "yaml"
import { brokerOrigin } from "../admin/auth.mjs"

const publicDir = path.resolve("public")
const config = YAML.parse(await fs.readFile("quartz.config.yaml", "utf8")).configuration
const base = new URL("https://" + config.baseUrl.replace(/\/$/, "") + "/")
const files = []
async function walk(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) await walk(file)
    else files.push(file)
  }
}
await walk(publicDir)
const existing = new Set(files)
const pages = new Map()
for (const file of files.filter((file) => file.endsWith(".html"))) {
  const tree = fromHtml(await fs.readFile(file, "utf8"))
  const ids = new Set(),
    links = []
  visit(tree, "element", (node) => {
    if (node.properties.id) ids.add(String(node.properties.id))
    if (node.tagName === "a" && node.properties.name) ids.add(String(node.properties.name))
    if (["a", "link", "img", "script"].includes(node.tagName)) {
      const value = node.properties.href ?? node.properties.src
      if (typeof value === "string") links.push(value)
    }
    if (node.tagName === "a" && (node.properties.className ?? []).includes("broken"))
      throw new Error(`未解析链接：${file}`)
  })
  pages.set(file, { ids, links })
}
const failures = []
// Validate the emitted policy: the OAuth result requests must be permitted by the browser.
const authConfig = JSON.parse(await fs.readFile("public/admin/auth-config.json", "utf8"))
const runtimeConfig = JSON.parse(await fs.readFile("public/runtime-config.json", "utf8"))
const adminTree = fromHtml(await fs.readFile("public/admin/index.html", "utf8"))
let adminPolicy = ""
let adminVersion = ""
let adminEntry = ""
visit(adminTree, "element", (node) => {
  if (
    node.tagName === "meta" &&
    String(node.properties.httpEquiv).toLowerCase() === "content-security-policy"
  )
    adminPolicy = String(node.properties.content)
  if (node.tagName === "meta" && node.properties.name === "howard-admin-version")
    adminVersion = String(node.properties.content)
  if (node.tagName === "script" && node.properties.type === "module")
    adminEntry = String(node.properties.src)
})
const connections = adminPolicy
  .split(";")
  .map((value) => value.trim())
  .find((value) => value.startsWith("connect-src "))
  ?.split(/\s+/)
  .slice(1)
  .sort()
const allowedConnections = [
  "'self'",
  "https://api.github.com",
  ...(authConfig.brokerOrigin ? [brokerOrigin(authConfig.brokerOrigin)] : []),
  ...(runtimeConfig.enabled ? [new URL(runtimeConfig.apiBase).origin] : []),
].sort()
if (JSON.stringify(connections) !== JSON.stringify(allowedConnections))
  failures.push(
    "Admin connection policy must permit only GitHub and the configured login/content origins",
  )
if (
  !adminPolicy.includes("script-src 'self' 'wasm-unsafe-eval'") ||
  /(?:^|\s)'unsafe-eval'/.test(adminPolicy)
)
  failures.push("The Markdown highlighter may compile WebAssembly without enabling JavaScript eval")
if (!/^[a-f0-9]{16}$/.test(adminVersion) || !/^admin-[A-Z0-9]+\.js$/.test(adminEntry))
  failures.push("Admin HTML must identify its release and load a versioned bundle")
const legacyEntry = await fs.readFile("public/admin/admin.js", "utf8")
if (!legacyEntry.includes(adminVersion) || legacyEntry.includes("已取消登录"))
  failures.push("The legacy admin entry must upgrade to the current release")
const maintenance = JSON.parse(await fs.readFile("public/maintenance-assets/manifest.json", "utf8"))
if (
  !/^maintenance-[A-Z0-9]+\.js$/.test(maintenance.entry) ||
  !/^[a-f0-9]{16}$/.test(maintenance.version) ||
  !existing.has(path.join(publicDir, "maintenance-assets", maintenance.entry))
)
  failures.push("Main-site maintenance must load a versioned entry on demand")
if (
  !/^maintenance-assets\/worker\/publication-[A-Z0-9]+\.js$/.test(maintenance.workerEntry || "") ||
  !existing.has(path.join(publicDir, maintenance.workerEntry || ""))
)
  failures.push("The publication worker must have an existing content-hashed entry")
for (const route of ["index.html", "notes/index.html", "tags/index.html"])
  if (!(await fs.readFile(path.join(publicDir, route), "utf8")).includes("data-maintenance-login"))
    failures.push(`Missing maintenance login: ${route}`)
const workspaceTemplate = await fs.readFile("public/maintenance-assets/workspace.txt", "utf8")
if (workspaceTemplate.includes("<script") || !workspaceTemplate.includes('id="save-draft"'))
  failures.push("Maintenance must reuse the shared editor without auto-running admin scripts")
for (const [file, { links }] of pages) {
  const route = path
    .relative(publicDir, file)
    .split(path.sep)
    .join("/")
    .replace(/index\.html$/, "")
    .replace(/\.html$/, "")
  const pageUrl = new URL(route, base)
  for (const link of links) {
    if (/^(mailto:|tel:|data:|javascript:)/.test(link)) continue
    let target
    try {
      target = new URL(link, pageUrl)
    } catch {
      // Historical notes contain literal URL examples such as localhost:<端口号>.
      // Retain the original example without treating it as a generated site route.
      if (route.startsWith("notes/") && /^[a-z][a-z0-9+.-]*:/i.test(link)) continue
      failures.push(`${route}: invalid URL ${link}`)
      continue
    }
    if (target.origin !== base.origin) continue
    if (
      !target.pathname.startsWith(base.pathname) &&
      target.pathname !== base.pathname.slice(0, -1)
    ) {
      failures.push(`${route}: escapes site base: ${link}`)
      continue
    }
    const relative = decodeURIComponent(target.pathname.slice(base.pathname.length))
    const local = path.resolve(publicDir, relative)
    const resolved = [local, local + ".html", path.join(local, "index.html")].find((value) =>
      existing.has(value),
    )
    if (!resolved) {
      failures.push(`${route}: missing ${link}`)
      continue
    }
    const hash = decodeURIComponent(target.hash.slice(1))
    if (hash && pages.has(resolved) && !pages.get(resolved).ids.has(hash))
      failures.push(`${route}: missing anchor ${link}`)
  }
}
const manifest = JSON.parse(await fs.readFile("content/.publish-manifest.json", "utf8"))
const allowed = new Set(
  manifest.files.filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3)),
)
const index = JSON.parse(await fs.readFile("public/static/contentIndex.json", "utf8"))
for (const slug of allowed) {
  if (!existing.has(path.join(publicDir, slug + ".html")))
    failures.push(`Missing rendered document: ${slug}`)
  if (!index[slug]) failures.push(`Missing search document: ${slug}`)
}
for (const slug of Object.keys(index))
  if (!allowed.has(slug) && slug !== "tags" && !slug.startsWith("tags/"))
    failures.push(`Unexpected search document: ${slug}`)
for (const file of files)
  if (/\/(\.obsidian|\.git|\.trash)\/|\.md$|publish-manifest/.test(file))
    failures.push(`Unexpected public file: ${file}`)
const expectedAssets = manifest.files.filter((file) => file.startsWith("assets/")).sort()
const emittedAssets = files
  .map((file) => path.relative(publicDir, file))
  .filter((file) => file.startsWith("assets/"))
  .sort()
if (JSON.stringify(expectedAssets) !== JSON.stringify(emittedAssets))
  failures.push("Public attachments differ from the export manifest")
let articleCount = 0
for (const file of manifest.files.filter((file) => file.endsWith(".md"))) {
  const text = await fs.readFile(path.join("content", file), "utf8")
  const data = YAML.parse(text.match(/^---\n([\s\S]*?)\n---/)[1])
  if (data.type === "article") articleCount++
}
const rss = await fs.readFile("public/index.xml", "utf8")
if ((rss.match(/<item>/g) ?? []).length !== articleCount)
  failures.push("RSS article count is incorrect")
if (failures.length) {
  console.error(failures.join("\n"))
  process.exitCode = 1
} else
  console.log(
    `Verified ${pages.size} HTML pages, ${articleCount} articles, ${expectedAssets.length} attachments, RSS and search index.`,
  )
