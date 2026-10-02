import { render } from "preact-render-to-string"
import { Fragment } from "preact"
import { jsx, jsxs } from "preact/jsx-runtime"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import type { Element, Root, RootContent } from "hast"
import { ArticleTitle } from "@quartz-community/article-title"
import { Breadcrumbs } from "@quartz-community/breadcrumbs"
import { BlogFrame, BlogNav, BlogHome, BlogFooter } from "../components/BlogView"
import type { BlogData } from "../components/BlogView"
import type { QuartzComponent, QuartzComponentProps } from "../components/types"
import { simplifySlug, type FullSlug } from "../util/path"
import { brandIconDataLink } from "../../scripts/lib/site-icon-svg.mjs"
import { sanitizeArticleHtml } from "../util/article-security"
import { contentIndexScript } from "../../scripts/lib/content-security.mjs"

export type RuntimeDocument = {
  id: string
  html: string
  toc: { depth: number; text: string; slug: string }[]
  text: string
  links: string[]
  tags?: string[]
  created: string
  modified: string
}
export type RuntimeProjection = {
  settings: BlogData["settings"]
  catalog: { articles: any[] }
  blogData: BlogData
  documents: RuntimeDocument[]
  contentIndex: Record<string, any>
  aboutHtml?: string
  revision?: string
}
export type RuntimeShell = {
  version?: number
  basePath: string
  origin?: string
  head: string
  postscript: string
  headerWidgets: string
  graphControls: string
}

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  )
const classes = (node: RootContent): string[] =>
  node.type === "element" ? ((node.properties.className ?? []) as string[]) : []
const find = (node: Root | Element, predicate: (node: Element) => boolean): Element | undefined => {
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (predicate(child)) return child
    const nested = find(child, predicate)
    if (nested) return nested
  }
}
const htmlJsx = (tree: Root | Element) =>
  toJsxRuntime(tree, { Fragment, jsx, jsxs, elementAttributeNameCase: "html" })

/** A stable thenable lets the existing graph read the latest revision after SPA navigation. */
export { contentIndexScript } from "../../scripts/lib/content-security.mjs"

/** Extract immutable compiled resources once; neither Node fs nor DOM globals are needed. */
export function extractShell(
  html: string,
  { basePath = "/howard-notes", origin = "https://leiguo0812.github.io" } = {},
): RuntimeShell {
  const document = fromHtml(html)
  const head = find(document, (node) => node.tagName === "head")
  const body = find(document, (node) => node.tagName === "body")
  if (!head || !body) throw new Error("网站页面模板不完整。")
  const base = new URL(`${basePath.replace(/\/$/, "")}/notes/template`, origin)
  const normalize = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue
      for (const name of ["href", "src"]) {
        const value = child.properties[name]
        if (typeof value !== "string" || /^(?:[a-z]+:|\/\/|#)/i.test(value)) continue
        child.properties[name] = new URL(value, base).pathname
      }
      normalize(child)
    }
  }
  normalize(head)
  // Resource scripts use relative fetch URLs; the content index is managed separately.
  head.children = head.children.filter((node) => {
    if (node.type !== "element") return true
    if (node.tagName === "title") return false
    if (node.tagName === "script" && toHtml(node).includes("const fetchData")) return false
    if (node.tagName === "link") {
      const rel = node.properties.rel as string[] | undefined
      if (rel?.some((value) => ["canonical", "alternate"].includes(value))) return false
    }
    if (node.tagName !== "meta") return true
    const name = String(node.properties.name ?? node.properties.property ?? "")
    return ![
      "description",
      "og:site_name",
      "og:title",
      "og:url",
      "og:description",
      "og:image",
      "og:image:url",
      "og:image:alt",
      "twitter:title",
      "twitter:description",
      "twitter:url",
      "twitter:domain",
      "twitter:image",
    ].includes(name)
  })
  const search = find(body, (node) => classes(node).includes("search"))
  const darkmode = find(body, (node) => classes(node).includes("darkmode"))
  const graph = find(body, (node) => classes(node).includes("graph"))
  if (!search || !darkmode || !graph) throw new Error("搜索、主题或图谱控件模板缺失。")
  const outer = find(graph, (node) => classes(node).includes("graph-outer"))
  if (outer) {
    outer.children = outer.children.map((child) =>
      classes(child).includes("note-relationship-graph")
        ? {
            type: "element",
            tagName: "div",
            properties: { className: ["graph-container"] },
            children: [],
          }
        : child,
    )
  }
  const scripts = body.children.filter(
    (child) => child.type === "element" && child.tagName === "script",
  )
  for (const script of scripts)
    if (script.type === "element") normalize({ type: "root", children: [script] })
  return {
    version: 1,
    basePath: basePath.replace(/\/$/, ""),
    origin,
    head: head.children.map((child) => toHtml(child)).join(""),
    postscript: scripts.map((child) => toHtml(child)).join(""),
    headerWidgets: toHtml(search) + toHtml(darkmode),
    graphControls: toHtml(graph),
  }
}

/** Render all public routes using the same view as the static Quartz build. */
export function renderPages(projection: RuntimeProjection, shell: RuntimeShell) {
  if (!shell.head || !shell.postscript || !shell.headerWidgets || !shell.graphControls)
    throw new Error("实时发布模板不完整，请重新部署前端。")
  const { settings, blogData } = projection
  const basePath = shell.basePath || "/howard-notes"
  const origin = (shell.origin || "https://leiguo0812.github.io").replace(/\/$/, "")
  const baseUrl = `${origin}${basePath}`
  const graphTree = fromHtml(shell.graphControls, { fragment: true })
  const widgetsTree = fromHtml(shell.headerWidgets, { fragment: true })
  const Graph: QuartzComponent = () => htmlJsx(graphTree)
  // BlogFrame uses component names to select its graph and TOC presentation.
  // Explicit names survive the maintenance bundle's identifier minification.
  Object.defineProperty(Graph, "name", { value: "Graph" })
  const HeaderWidgets: QuartzComponent = () => htmlJsx(widgetsTree)
  // One deterministic id per document keeps otherwise unchanged pages reusable
  // across publication attempts; the upstream constructor increments global ids.
  const Toc: QuartzComponent = function TableOfContents({ fileData }) {
    if (!fileData.toc?.length) return null
    return (
      <div class="toc">
        <button type="button" class="toc-header" aria-controls="runtime-toc" aria-expanded="true">
          <h3>目录</h3>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="fold"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <ul id="runtime-toc" class="toc-content overflow">
          {fileData.toc.map((entry) => (
            <li class={`depth-${entry.depth}`}>
              <a href={`#${entry.slug}`} data-for={entry.slug}>
                {entry.text}
              </a>
            </li>
          ))}
          <li class="overflow-end" />
        </ul>
      </div>
    )
  }
  Object.defineProperty(Toc, "name", { value: "TableOfContents" })
  const backlinks: QuartzComponent = ({ fileData, allFiles }) => {
    const referring = allFiles.filter((file) => file.links?.includes(simplifySlug(fileData.slug!)))
    if (!referring.length) return null
    return (
      <div class="backlinks">
        <h3>反向链接</h3>
        <ul id="runtime-backlinks" class="overflow">
          {referring.map((file) => (
            <li>
              <a class="internal" href={`../${file.slug}`}>
                {file.frontmatter?.title}
              </a>
            </li>
          ))}
          <li class="overflow-end" />
        </ul>
      </div>
    )
  }
  const title = ArticleTitle() as QuartzComponent
  const crumbs = Breadcrumbs({ rootName: "首页" }) as QuartzComponent
  // The upstream reading-time wrapper imports Node createRequire. Keep this
  // small metadata adapter browser-safe for publication on mobile as well.
  const meta: QuartzComponent = ({ fileData }) => {
    const text = String(fileData.text || "")
    if (!text) return null
    const day = String(fileData.frontmatter?.modified ?? "")
    const [year, month, date] = day.split("-")
    const cjk = text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
    const words = text
      .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
    return (
      <p class="content-meta" show-comma="true">
        <time dateTime={`${day}T00:00:00+08:00`}>
          {year}年{month}月{date}日
        </time>
        <span>{Math.max(1, Math.ceil((cjk + words) / 200))}分钟阅读</span>
      </p>
    )
  }
  const documents = new Map(projection.documents.map((document) => [document.id, document]))
  const rows = blogData.articles
  const articles = new Map(projection.catalog.articles.map((article) => [article.id, article]))
  const allFiles: any[] = rows.map((row) => ({
    slug: `notes/${row.id}`,
    filePath: `notes/${row.id}.md`,
    links: documents.get(row.id)?.links ?? [],
    frontmatter: { title: row.title, tags: row.tags.map((tag) => tag.title) },
  }))
  allFiles.push(
    { slug: "index", filePath: "index.md", frontmatter: { title: "首页" } },
    { slug: "notes/index", filePath: "notes/index.md", frontmatter: { title: "文章" } },
  )
  const pages: { path: string; html: string }[] = []
  function page(path: string, pageTitle: string, type: string, options: any = {}) {
    const note = options.document as RuntimeDocument | undefined
    if (!allFiles.some((file) => file.slug === path))
      allFiles.push({ slug: path, filePath: `${path}.md`, frontmatter: { title: pageTitle } })
    const props = {
      cfg: {
        baseUrl: baseUrl.replace(/^https?:\/\//, ""),
        locale: "zh-CN",
        pageTitle: settings.brand.name,
        defaultDateType: "modified",
      },
      ctx: { argv: { serve: false } },
      fileData: {
        slug: path as FullSlug,
        frontmatter: {
          title: pageTitle,
          description: options.description ?? "",
          type,
          ...(options.listing ? { listing: options.listing } : {}),
          ...(note
            ? { tags: note.tags ?? [], created: note.created, modified: note.modified }
            : {}),
        },
        ...(note
          ? {
              toc: note.toc,
              links: note.links,
              text: note.text,
              dates: {
                created: new Date(`${note.created}T00:00:00+08:00`),
                modified: new Date(`${note.modified}T00:00:00+08:00`),
                published: new Date(`${note.modified}T00:00:00+08:00`),
              },
            }
          : {}),
      },
      runtimeData: blogData,
      tree: { type: "root", children: [] },
      allFiles,
    } as unknown as QuartzComponentProps
    const Content: QuartzComponent = () => (
      <article class="popover-hint">
        <div
          class="markdown-preview-view markdown-rendered"
          dangerouslySetInnerHTML={{
            __html: sanitizeArticleHtml(note?.html ?? options.html ?? ""),
          }}
        />
      </article>
    )
    const body = BlogFrame.render({
      componentData: props,
      header: [BlogNav, HeaderWidgets],
      beforeBody: path === "index" ? [BlogHome] : [crumbs, title, ...(note ? [meta] : [])],
      pageBody: Content,
      afterBody: [],
      left: note ? [Graph, Toc] : [],
      right: note ? [backlinks] : [],
      footer: [BlogFooter],
    } as any)
    const canonical =
      path === "index" ? `${baseUrl}/` : `${baseUrl}/${path.replace(/\/index$/, "/")}`
    const description = options.description ?? settings.brand.subtitle
    const head = `${shell.head}${brandIconDataLink(settings)}<title>${escape(pageTitle)} | ${escape(settings.brand.name)}</title><meta name="description" content="${escape(description)}"><meta property="og:site_name" content="${escape(settings.brand.name)}"><meta property="og:title" content="${escape(pageTitle)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(canonical)}"><link rel="canonical" href="${escape(canonical)}"><link rel="alternate" type="application/rss+xml" title="${escape(settings.brand.name)}" href="${escape(baseUrl)}/index.xml"><script data-persist="true">${contentIndexScript(basePath)}</script>`
    pages.push({
      path,
      html: `<!DOCTYPE html>\n<html lang="zh" dir="ltr"><head>${head}</head><body data-slug="${escape(path)}" data-basepath="${escape(basePath)}" data-runtime-revision="${escape(projection.revision ?? "")}"><div id="quartz-root" class="page" data-frame="blog"><div id="quartz-body">${render(body)}</div></div>${shell.postscript}</body></html>`,
    })
  }
  const listing = (
    path: string,
    pageTitle: string,
    selected: typeof rows,
    parent = "notes/index",
    parentLabel = "全部文章",
    topicId?: string,
  ) =>
    page(path, pageTitle, "listing", {
      listing: {
        rows: selected,
        baseRoute: path,
        parent,
        parentLabel,
        total: selected.length,
        ...(topicId ? { topicId } : {}),
      },
    })
  page("index", settings.home.title, "home", {
    description: settings.home.description || settings.brand.subtitle,
  })
  listing("notes/index", "文章", rows, "index", "首页")
  listing("collections/index", "文章", rows, "index", "首页")
  page("topics/index", "专题", "topic-hub")
  page("tags/index", "标签", "tag-hub")
  page("memory/index", "记忆卡", "memory-hub")
  page("about", settings.about.title, "page", { html: projection.aboutHtml ?? "" })
  page("404", "页面不存在", "page", {
    html: `<p>没有找到这篇文章。</p><p><a class="internal" href="${escape(basePath)}/">返回首页</a></p>`,
  })
  for (const topic of blogData.topics)
    listing(
      `topics/${topic.id}`,
      topic.title,
      rows.filter((row) => (row.categoryKey ?? row.category) === topic.category),
      "topics/index",
      "专题",
      topic.id,
    )
  for (const collection of settings.collections)
    listing(
      `collections/${collection.id}`,
      collection.title,
      rows.filter((row) => collection.id !== "featured" || articles.get(row.id)?.featured),
    )
  for (const tag of blogData.tags)
    listing(
      `tags/${tag.id}`,
      `#${tag.title}`,
      rows.filter((row) => row.tags.some((item) => item.id === tag.id)),
      "tags/index",
      "标签",
    )
  for (const row of rows) {
    const note = documents.get(row.id)
    if (!note) throw new Error(`文章 ${row.id} 的正文投影缺失。`)
    page(`notes/${row.id}`, row.title, "article", { document: note, description: row.excerpt })
  }
  return pages
}
