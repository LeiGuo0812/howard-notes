import {
  normalizeSite,
  orderedSections,
  sectionLimit,
  sitePages,
} from "../scripts/lib/site-design.mjs"
import { paletteCategory } from "../scripts/lib/site-palettes.mjs"
import { sitePreviewSettings } from "./site-preview-settings.mjs"

export const PREVIEW_SCENES = Object.freeze(["home", "topics", "notes", "article"])
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  )
const samples = Object.freeze([
  {
    title: "构建一个轻盈的知识空间",
    excerpt: "从清晰的内容组织开始，让笔记、专题和阅读体验自然连接。",
    date: "2026-09-28",
  },
  {
    title: "缓存与异步：让界面及时响应",
    excerpt: "先回应操作，再按需处理数据。用明确的状态管理保持体验稳定。",
    date: "2026-09-25",
  },
  {
    title: "Markdown 中的代码与排版",
    excerpt: "在中文段落、英文术语和代码之间建立舒适的阅读节奏。",
    date: "2026-09-22",
  },
  {
    title: "从一个小实验开始",
    excerpt: "记录问题、过程和结果，把一次探索整理成可以复用的经验。",
    date: "2026-09-19",
  },
  {
    title: "把复杂问题拆成简单步骤",
    excerpt: "围绕一个明确的问题组织材料，为后续工作留下清晰的线索。",
    date: "2026-09-16",
  },
  {
    title: "让阅读与思考保持连续",
    excerpt: "用专题、标签与链接连接知识，保留每一篇笔记自身的完整性。",
    date: "2026-09-12",
  },
])
const visibleTopics = (settings) => settings.topics.filter((topic) => topic.visible).slice(0, 6)
const topicName = (settings, index = 0) =>
  visibleTopics(settings)[index % Math.max(1, visibleTopics(settings).length)]?.title || "技术笔记"
const topicCategory = (settings, index = 0) =>
  visibleTopics(settings)[index % Math.max(1, visibleTopics(settings).length)]?.category ||
  "技术笔记"
const svg = (path) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${path}"/></svg>`
function card(settings, note, index, compact = false) {
  const category = paletteCategory(topicCategory(settings, index))
  const content = `<a href="#" class="internal note-preview${compact ? " compact-preview" : " frosted-panel"}"${compact ? "" : " data-spotlight"} data-palette-category="${category}"><div class="preview-note-heading"><h3>${escape(note.title)}</h3><time>${note.date}</time></div><p>${escape(note.excerpt)}</p>${compact ? "" : `<small>${escape(topicName(settings, index))}</small>`}</a>`
  return compact
    ? content
    : `<div class="frost-environment lucky-preview-surface" data-palette-category="${category}">${content}</div>`
}
function chips(settings) {
  return `<div class="topic-chips">${visibleTopics(settings)
    .map(
      (topic, index) =>
        `<a class="internal topic-chip" href="#" data-palette-category="${paletteCategory(topic.category)}"><span>${escape(topic.title)}</span><small>${3 + index}</small></a>`,
    )
    .join("")}</div>`
}
function heatmap() {
  return `<div class="activity-chart"><div class="activity-summary"><span>笔记活动</span><span>9 月</span></div><div class="heatmap-scroll"><div class="heatmap-weeks">${Array.from({ length: 18 }, (_, week) => `<div class="heatmap-week"><span class="heatmap-month">${week === 0 ? "9 月" : ""}</span>${Array.from({ length: 7 }, (_, day) => `<span class="heatmap-day level-${(week * 3 + day * 7) % 5}"></span>`).join("")}</div>`).join("")}</div></div></div>`
}
function home(settings) {
  const sections = orderedSections(settings).filter((section) => section.enabled)
  return `<div class="home-workspace layout-${settings.home.layout} density-${settings.home.density}" data-home-template="${sitePages(settings).homeTemplate}"><p class="home-eyebrow"><span class="home-identity">${escape(settings.brand.name)}</span><span class="home-identity-subtitle">${escape(settings.brand.subtitle)}</span></p><div class="home-heading"><h1>${escape(settings.home.title)}</h1><span>6 篇样稿</span></div>${settings.home.description ? `<p class="home-description">${escape(settings.home.description)}</p>` : ""}<div class="home-modules">${sections
    .map((section) => {
      let body = ""
      if (["featured", "curated", "recent"].includes(section.id)) {
        const compact = section.id === "recent"
        body = `<div class="home-note-previews ${compact ? "recent-previews" : "lucky-previews"}${section.id === "curated" ? " curated-previews" : ""}">${samples
          .slice(0, Math.min(6, sectionLimit(section)))
          .map((note, index) => card(settings, note, index, compact))
          .join("")}</div>`
      } else if (section.id === "topics") body = chips(settings)
      else if (section.id === "activity") body = heatmap()
      else if (section.id === "memories")
        body = `<div class="sample-memories">${samples
          .slice(0, 2)
          .map(
            (note) =>
              `<div class="frost-environment"><div class="frosted-panel sample-memory" data-spotlight><time>${note.date}</time><p>${escape(note.excerpt)}</p></div></div>`,
          )
          .join("")}</div>`
      return `<section class="home-module module-${section.id}" data-section-id="${section.id}"><div class="module-heading"><div class="module-title"><h2>${escape(section.title)}</h2>${["featured", "curated"].includes(section.id) ? `<button class="refresh-home-notes" id="${section.id === "curated" ? "refresh-curated-notes" : "refresh-random-notes"}" type="button" title="换一组">${svg("M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1M6 18a7 7 0 0 0 12-1")}<span>换一组</span></button>` : ""}</div><a class="internal" href="#">全部 ↗</a></div>${body}</section>`
    })
    .join("")}</div></div>`
}
function topics(settings) {
  const cards = sitePages(settings).topicLayout === "cards"
  return `<h1 class="article-title">专题</h1><div class="topic-directory topic-layout-${cards ? "cards topic-card-grid" : "list"}">${visibleTopics(
    settings,
  )
    .map(
      (topic, index) =>
        `<section class="topic-section topic-card${cards ? " frosted-panel" : ""}" data-palette-category="${paletteCategory(topic.category)}"${cards ? " data-spotlight" : ""}><div class="topic-section-heading"><h2><a class="internal" href="#">${escape(topic.title)}</a></h2><small>3 篇笔记</small></div><div class="topic-note-previews">${samples
          .slice(0, Math.min(3, sitePages(settings).topicPreviewCount))
          .map((note, offset) => card(settings, note, index + offset, true))
          .join("")}</div></section>`,
    )
    .join("")}</div>`
}
function notes(settings) {
  return `<div class="listing-page"><h1 class="article-title">文章</h1>${chips(settings)}<div class="listing-controls"><label class="listing-search"><span class="sr-only">搜索文章</span><input type="search" placeholder="标题、专题、标签" aria-label="样稿搜索" readonly></label><label class="listing-sort"><span>排序</span><select aria-label="样稿排序"><option>更新：最近优先</option></select></label></div><ol class="article-rows">${samples.map((note, index) => `<li><a class="internal article-row" href="#"><div class="article-row-copy"><span class="article-row-title">${escape(note.title)}</span><div class="article-row-meta"><small>${escape(topicName(settings, index))}</small><time>${note.date}</time></div><p class="article-row-excerpt">${escape(note.excerpt)}</p></div></a></li>`).join("")}</ol></div>`
}
function article(settings) {
  return `<div class="page-header"><nav class="breadcrumb-container"><a href="#">首页</a><span> / </span><a href="#">${escape(topicName(settings))}</a></nav><h1 class="article-title">构建一个轻盈的知识空间</h1><div class="article-note-meta"><span>创建 2026-09-12</span><span>更新 2026-09-28</span><div class="tag-chips"><a class="internal topic-chip" href="#"><span>技术</span></a><a class="internal topic-chip" href="#"><span>学习</span></a></div></div></div><article class="sample-article"><p>好的知识空间让内容保持清晰，也为持续思考留下余地。这篇样稿展示正文、标题、链接与代码的阅读效果。</p><h2 id="sample-overview">组织内容</h2><p>先围绕明确的问题建立笔记，再用专题连接相关内容。中文段落中的 <strong>重要概念</strong>、英文术语 Cache 与 <a href="#">参考链接</a>，应有自然的层次。</p><blockquote><p>让每一个界面先回应操作，再处理需要等待的数据。</p></blockquote><h2 id="sample-code">代码与记录</h2><pre><code>const cache = new Map()\n\nasync function readNote(id) {\n  if (cache.has(id)) return cache.get(id)\n  const note = await fetchNote(id)\n  cache.set(id, note)\n  return note\n}</code></pre><h3>检查步骤</h3><table><thead><tr><th>模块</th><th>关注点</th></tr></thead><tbody><tr><td>导航</td><td>入口清晰，状态明确</td></tr><tr><td>阅读</td><td>字号、行距与正文宽度</td></tr><tr><td>交互</td><td>先显示，再等待</td></tr></tbody></table><p>这是一份固定样稿，仅用于比较页面布局和配色。</p></article>`
}
export function renderSitePreviewSample(settings, scene = "home") {
  settings = normalizeSite(sitePreviewSettings(settings))
  if (!PREVIEW_SCENES.includes(scene)) throw new Error("预览页面不正确。")
  const views = { home, topics, notes, article }
  const active = scene === "article" ? "notes" : scene
  const sidebar =
    scene === "article"
      ? `<aside class="left sidebar reading-sidebar" aria-label="样稿目录"><details class="reading-tools" open><summary>目录</summary><div class="reading-tool-panels"><div class="frost-environment reading-toc-surface"><div class="frosted-panel sample-toc"><strong>目录</strong><ol><li><a href="#sample-overview">组织内容</a></li><li><a href="#sample-code">代码与记录</a></li></ol></div></div></div></details></aside>`
      : ""
  return `<div class="page" data-frame="blog"><div id="quartz-body"><div class="site-surface accent-${settings.accent}" data-article-layout="${sitePages(settings).articleLayout}"><header class="blog-header"><a href="#" class="blog-brand internal"><span class="brand-mark">${escape(settings.brand.mark)}</span><span><span class="brand-name">${escape(settings.brand.name)}</span><span class="brand-subtitle">${escape(settings.brand.subtitle)}</span></span></a><nav class="blog-nav" aria-label="主导航">${settings.navigation
    .filter((item) => item.visible)
    .map(
      (item) =>
        `<a class="internal" href="#" data-nav-id="${item.id}"${item.id === active ? ' aria-current="page"' : ""}>${escape(item.label)}</a>`,
    )
    .join(
      "",
    )}</nav><div class="search"><button type="button" class="search-button" aria-label="样稿搜索">${svg("M21 21l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0")}<p>搜索</p></button></div><button class="darkmode" type="button" aria-label="样稿主题">${svg("M20 14a9 9 0 0 1-10-10A9 9 0 1 0 20 14Z")}</button></header><div class="blog-layout ${scene === "home" ? "is-home" : scene === "article" ? "is-article" : "is-directory"}">${sidebar}<main class="center" id="main-content">${views[scene](settings)}</main></div><footer class="blog-footer"><span>${escape(settings.footer)}</span><span>页面样稿</span></footer></div></div></div>`
}
