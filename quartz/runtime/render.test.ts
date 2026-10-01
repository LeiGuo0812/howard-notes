import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import siteSettings from "../../library/site.json"
import { extractShell, renderPages, type RuntimeProjection } from "./render"

const sourceShell = `<!doctype html><html><head><title>old</title><link rel="stylesheet" href="../index-test.css"><link rel="canonical" href="https://leiguo0812.github.io/howard-notes/notes/old"><meta name="description" content="old"><script data-persist="true">const fetchData=fetch('../static/contentIndex.json')</script></head><body><header><div class="search"><button class="search-button">搜索</button></div><button class="darkmode">主题</button></header><div class="graph"><h3>关系图谱</h3><div class="graph-outer"><svg class="note-relationship-graph"><text>old</text></svg><button class="global-graph-icon">打开</button></div><div class="global-graph-outer"><div class="global-graph-container" data-cfg="{}"></div></div></div><script type="module" src="../postscript-test.js" data-persist="true"></script></body></html>`
const shell = extractShell(sourceShell, { origin: "https://notes.example" })
const row = (id: string, title = id) => ({
  id,
  title,
  date: "2026-10-01",
  created: "2026-09-01",
  modified: "2026-10-01",
  category: "技术",
  categoryKey: "技术",
  excerpt: "摘要",
  tags: [{ id: "code", title: "code" }],
})
function fixture(): RuntimeProjection {
  const settings = structuredClone(siteSettings)
  settings.topics = [{ id: "tech", title: "技术", category: "技术", visible: true }]
  const articles = [row("fresh-note", "新文章 <script>"), row("related-note")]
  return {
    settings,
    revision: "revision-new",
    catalog: {
      articles: articles.map((note) => ({
        ...note,
        published: true,
        featured: note.id === "fresh-note",
      })),
    },
    blogData: {
      settings,
      total: 2,
      articles,
      featured: articles.slice(0, 1),
      recent: articles,
      topics: [
        {
          id: "tech",
          title: "技术",
          category: "技术",
          visible: true,
          count: 2,
          preview: articles,
          previewPool: articles,
        },
      ],
      tags: [{ id: "code", title: "code", count: 2 }],
      collections: settings.collections.map((collection) => ({ ...collection, count: 2 })),
      activity: { selected: "recent", periods: [] },
    },
    documents: articles.map((note) => ({
      id: note.id,
      created: note.created,
      modified: note.modified,
      text: "中文正文",
      tags: ["code"],
      html: '<h2 id="中文标题">中文标题</h2><p>中文正文 <a href="https://example.com" target="_blank" rel="noopener noreferrer">链接</a></p><pre><code>long code</code></pre>',
      toc: [{ depth: 0, text: "中文标题", slug: "中文标题" }],
      links: note.id === "fresh-note" ? ["notes/related-note"] : [],
    })),
    contentIndex: {},
    aboutHtml: "<p>关于本站</p>",
  }
}

test("shell resources are rooted and old canonical/index data is removed", () => {
  assert.match(shell.head, /href="\/howard-notes\/index-test.css"/)
  assert.match(shell.postscript, /src="\/howard-notes\/postscript-test.js"/)
  assert.doesNotMatch(shell.head, /old|const fetchData/)
  assert.match(shell.graphControls, /class="graph-container"/)
  assert.doesNotMatch(shell.graphControls, /note-relationship-graph|>old</)
})

test("new notes and directories render complete public routes without a prior HTML file", () => {
  const pages = renderPages(fixture(), shell)
  const paths = pages.map((page) => page.path)
  for (const expected of [
    "index",
    "notes/index",
    "topics/index",
    "topics/tech",
    "tags/index",
    "tags/code",
    "about",
    "notes/fresh-note",
  ])
    assert.ok(paths.includes(expected), expected)
  assert.equal(new Set(paths).size, paths.length)
  const article = pages.find((page) => page.path === "notes/fresh-note")!.html
  assert.match(article, /新文章 &lt;script&gt;/)
  assert.match(article, /中文正文/)
  assert.match(article, /data-maintenance-article="fresh-note"/)
  assert.match(article, /note-relationship-graph/)
  assert.match(article, /data-for="中文标题"/)
  assert.match(article, /href="https:\/\/notes.example\/howard-notes\/notes\/fresh-note"/)
  assert.match(article, /data-runtime-revision="revision-new"/)
  assert.match(article, /target="_blank" rel="noopener noreferrer"/)
  assert.match(pages.find((page) => page.path === "about")!.html, /关于本站/)
})

test("removing a published row removes every list, lucky card, graph and route reference", () => {
  const projection = fixture()
  projection.blogData.articles = projection.blogData.articles.slice(0, 1)
  projection.blogData.recent = projection.blogData.articles
  projection.blogData.topics[0].preview = projection.blogData.articles
  projection.blogData.topics[0].previewPool = projection.blogData.articles
  projection.documents = projection.documents.slice(0, 1)
  projection.documents[0].links = []
  const pages = renderPages(projection, shell)
  assert.ok(!pages.some((page) => page.path === "notes/related-note"))
  assert.ok(pages.every((page) => !page.html.includes("notes/related-note")))
})

test("article lists render optional root-relative thumbnails and preserve notes and view controls", () => {
  const projection = fixture()
  projection.blogData.articles[0].thumbnail = { src: "assets/figure.svg", alt: "原有图示" }
  const pages = renderPages(projection, shell)
  const listing = pages.find((page) => page.path === "notes/index")!.html
  const images = listing.match(/<img\b[^>]*data-article-thumbnail[^>]*>/g) || []
  assert.equal(images.length, 1)
  const src = images[0].match(/src="([^"]+)"/)![1]
  assert.equal(
    new URL(src, "https://notes.example/howard-notes/notes/").href,
    "https://notes.example/howard-notes/assets/figure.svg",
  )
  assert.match(images[0], /loading="lazy"/)
  assert.match(images[0], /referrerPolicy="no-referrer"/i)
  assert.match(listing, /data-listing-view="timeline"/)
  assert.match(listing, /id="article-timeline"/)
  assert.match(listing, /id="timeline-jump"/)
  assert.match(pages.find((page) => page.path === "notes/fresh-note")!.html, /中文正文/)
})

test("topic cards and the legacy list can both render from saved page settings", () => {
  const projection = fixture()
  projection.settings.pages.topicLayout = "cards"
  const topicHtml = () =>
    renderPages(projection, shell).find((page) => page.path === "topics/index")!.html
  assert.match(topicHtml(), /topic-card-grid/)
  projection.settings.pages.topicLayout = "list"
  assert.doesNotMatch(topicHtml(), /topic-card-grid/)
})

test("missing rendered bodies fail explicitly instead of publishing empty new routes", () => {
  const projection = fixture()
  projection.documents = []
  assert.throws(() => renderPages(projection, shell), /正文投影缺失/)
})

test("rendering an unchanged projection twice keeps every page hash stable", () => {
  const projection = fixture()
  const hashes = () =>
    renderPages(projection, shell).map(({ path, html }) => [
      path,
      createHash("sha256").update(html).digest("hex"),
    ])
  assert.deepEqual(hashes(), hashes())
})

test("runtime frames retain the Quartz Body container required by existing layout styles", () => {
  for (const { path, html } of renderPages(fixture(), shell)) {
    assert.match(
      html,
      /id="quartz-root" class="page" data-frame="blog"><div id="quartz-body"><div class="site-surface/,
      path,
    )
    assert.equal(html.match(/id="quartz-body"/g)?.length, 1, path)
  }
})

test("page settings update the tab icon without deploying new static image assets", () => {
  const projection = fixture()
  projection.settings = {
    ...projection.settings,
    brand: { ...projection.settings.brand, mark: "G&" },
    design: { ...projection.settings.design, accentColor: "#56789a" },
  }
  projection.blogData.settings = projection.settings
  const cachedShell = { ...shell, head: shell.head + '<link rel="icon" href="/old-brand.svg">' }
  for (const page of renderPages(projection, cachedShell)) {
    const icons = [...page.html.matchAll(/<link rel="icon"[^>]+>/g)].map((match) => match[0])
    assert.ok(
      icons.some((link) => link.includes("/old-brand.svg")),
      page.path,
    )
    const dataUrl = /href="([^"]+)"/.exec(icons.at(-1)!)![1]
    const svg = decodeURIComponent(dataUrl.slice("data:image/svg+xml,".length))
    assert.match(svg, /G&amp;/)
    assert.match(svg, /#56789a/)
  }
})

test("minified maintenance renderer retains graph and TOC presentation", async () => {
  const { runtimeBrowserPlugins } = await import(
    new URL("../../runtime/build.mjs", import.meta.url).href
  )
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./render.tsx", import.meta.url))],
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    target: ["es2022"],
    write: false,
    plugins: runtimeBrowserPlugins(),
    loader: { ".scss": "empty" },
  })
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles![0].text).toString("base64")}`
  )
  const pages = module.renderPages(fixture(), shell) as { path: string; html: string }[]
  const article = pages.find((page) => page.path === "notes/fresh-note")!.html
  assert.match(article, /note-relationship-graph/)
  assert.match(article, /reading-toc-surface/)
  assert.match(pages.find((page) => page.path === "notes/related-note")!.html, /runtime-backlinks/)
  assert.match(article, /id="quartz-body"/)
})
