import YAML from "yaml"
import { slugTag } from "@quartz-community/utils"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { topicList, collectionArticles, validateSite } from "./site-settings.mjs"
import { splitNote } from "./library-render.mjs"
import { safeRelative } from "./catalog.mjs"
import { createdDay, modifiedDay } from "./note-dates.mjs"
import { sectionLimit, sitePages } from "./site-design.mjs"

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true })

function excerpt(bytes) {
  if (!bytes) return ""
  const body = splitNote(utf8.decode(bytes)).body
  const tree = unified().use(remarkParse).parse(body)
  const textOf = (node) =>
    ["code", "html", "image"].includes(node.type)
      ? ""
      : (node.value ?? node.children?.map(textOf).join("") ?? "")
  return tree.children
    .filter((node) => node.type === "paragraph")
    .map(textOf)
    .filter((text) => !/^(?:\s*#[\p{L}\p{N}_/-]+\s*)+$/u.test(text))
    .join(" ")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name, alias) => alias || name)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140)
}
export function tagList(articles) {
  const tags = new Map()
  for (const article of articles.filter((a) => a.published)) {
    const seen = new Set()
    for (const name of article.tags || []) {
      const parts = name.trim().split("/")
      for (let length = 1; length <= parts.length; length++) {
        const title = parts.slice(0, length).join("/"),
          id = slugTag(title)
        if (!id || !safeRelative(`tags/${id}/index.md`) || seen.has(id)) continue
        seen.add(id)
        const tag = tags.get(id) || { id, title, articleIds: [] }
        tag.articleIds.push(article.id)
        tags.set(id, tag)
      }
    }
  }
  return [...tags.values()]
    .map((tag) => ({ ...tag, count: tag.articleIds.length }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "zh-CN"))
}

export function generateSitePages(
  settings,
  catalog,
  activity,
  legacyPageSize = 24,
  sources = new Map(),
  encode = (text) => Buffer.from(text),
  excerpts = new Map(),
  thumbnails = new Map(),
) {
  validateSite(settings)
  const output = new Map()
  const published = catalog.articles.filter((article) => article.published)
  const topics = topicList(settings, catalog.articles)
  const tags = tagList(published)
  const row = (article) => ({
    id: article.id,
    title: article.title,
    date: modifiedDay(article),
    created: createdDay(article),
    modified: modifiedDay(article),
    category:
      topics.find((topic) => topic.category === article.category)?.title || article.category,
    categoryKey: article.category,
    excerpt:
      article.description ||
      (excerpts.has(article.id) ? excerpts.get(article.id) : excerpt(sources.get(article.file))),
    tags: tags
      .filter((tag) => tag.articleIds.includes(article.id))
      .map(({ id, title }) => ({ id, title })),
    ...(thumbnails.has(article.id) ? { thumbnail: thumbnails.get(article.id) } : {}),
  })
  const rows = new Map(published.map((article) => [article.id, row(article)]))
  const markdown = (data, body = "") =>
    encode(`---\n${YAML.stringify({ publish: true, draft: false, ...data })}---\n${body}`)
  output.set(
    "index.md",
    markdown({
      title: settings.home.title,
      description: settings.home.description || settings.brand.subtitle,
      type: "home",
    }),
  )
  output.set("topics/index.md", markdown({ title: "专题", type: "topic-hub" }))
  output.set("tags/index.md", markdown({ title: "标签", type: "tag-hub" }))
  // Only the shell is public; memory data and permissions live in the independent API.
  output.set("memory/index.md", markdown({ title: "记忆卡", type: "memory-hub" }))
  output.set("private/index.md", markdown({ title: "私密文章", type: "private-hub" }))
  output.set("about.md", markdown({ title: settings.about.title }, settings.about.body))
  function listing(route, title, articles, parent, parentLabel, topicId) {
    const aliases = Array.from(
      { length: Math.max(0, Math.ceil(articles.length / legacyPageSize) - 1) },
      (_, i) => `${route}-p${i + 2}`,
    )
    output.set(
      `${route}.md`,
      markdown({
        title,
        type: "listing",
        ...(aliases.length ? { aliases } : {}),
        listing: {
          rows: articles.map((article) => rows.get(article.id)),
          baseRoute: route,
          parent,
          parentLabel,
          total: articles.length,
          ...(topicId ? { topicId } : {}),
        },
      }),
    )
  }
  const all = collectionArticles("all", published)
  listing("notes/index", "文章", all, "index", "首页")
  listing("collections/index", "文章", all, "index", "首页")
  for (const topic of topics)
    listing(
      `topics/${topic.id}`,
      topic.title,
      collectionArticles(
        "recent",
        published.filter((article) => article.category === topic.category),
      ),
      "topics/index",
      "专题",
      topic.id,
    )
  for (const collection of settings.collections)
    listing(
      `collections/${collection.id}`,
      collection.title,
      collectionArticles(collection.id, published),
      "notes/index",
      "全部文章",
    )
  for (const tag of tags)
    listing(
      `tags/${tag.id}`,
      `#${tag.title}`,
      all.filter((article) => tag.articleIds.includes(article.id)),
      "tags/index",
      "标签",
    )
  return {
    output,
    data: {
      settings,
      total: published.length,
      activity,
      topics: topics.map((topic) => {
        const previewPool = collectionArticles(
          "recent",
          published.filter((a) => a.category === topic.category),
        )
          .slice(0, 5)
          .map((a) => rows.get(a.id))
        return {
          ...topic,
          preview: previewPool.slice(0, sitePages(settings).topicPreviewCount),
          previewPool,
        }
      }),
      tags: tags.map(({ articleIds, ...tag }) => tag),
      articles: all.map((article) => rows.get(article.id)),
      featured: collectionArticles("featured", published)
        .slice(0, 6)
        .map((a) => rows.get(a.id)),
      recent: collectionArticles("recent", published)
        .slice(0, sectionLimit(settings.home.sections.find((section) => section.id === "recent")))
        .map((a) => rows.get(a.id)),
      collections: settings.collections.map((item) => ({
        ...item,
        count: collectionArticles(item.id, published).length,
      })),
    },
  }
}
