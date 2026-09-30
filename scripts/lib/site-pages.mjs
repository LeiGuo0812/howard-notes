import YAML from "yaml"
import { topicList, collectionArticles, validateSite } from "./site-settings.mjs"

export function generateSitePages(settings, catalog, activity, pageSize = 24) {
  validateSite(settings)
  const output = new Map()
  const published = catalog.articles.filter((article) => article.published)
  const topics = topicList(settings, catalog.articles)
  const markdown = (data, body = "") =>
    Buffer.from(`---\n${YAML.stringify({ publish: true, draft: false, ...data })}---\n${body}`)
  output.set(
    "index.md",
    markdown({
      title: settings.home.title,
      description: settings.home.description || settings.brand.subtitle,
      type: "home",
    }),
  )
  output.set("topics/index.md", markdown({ title: "专题", type: "topic-hub" }))
  output.set("notes/index.md", markdown({ title: "文章", type: "collection-hub" }))
  output.set("collections/index.md", markdown({ title: "文章", type: "collection-hub" }))
  output.set("about.md", markdown({ title: settings.about.title }, settings.about.body))
  function listing(route, title, articles, parent, parentLabel, topicId) {
    const pageCount = Math.max(1, Math.ceil(articles.length / pageSize))
    for (let page = 1; page <= pageCount; page++) {
      const rows = articles
        .slice((page - 1) * pageSize, page * pageSize)
        .map((article) => ({
          id: article.id,
          title: article.title,
          date: article.modified || article.date,
          category:
            topics.find((topic) => topic.category === article.category)?.title || article.category,
        }))
      const data = {
        title,
        type: "listing",
        listing: {
          rows,
          page,
          pageCount,
          baseRoute: route,
          parent,
          parentLabel,
          total: articles.length,
          ...(topicId ? { topicId } : {}),
        },
      }
      output.set(`${route}${page > 1 ? `-p${page}` : ""}.md`, markdown(data))
    }
  }
  for (const topic of topics)
    listing(
      `topics/${topic.id}`,
      topic.title,
      collectionArticles(
        "all",
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
      "文章",
    )
  return {
    output,
    data: {
      settings,
      topics,
      activity,
      total: published.length,
      collections: settings.collections.map((item) => ({
        ...item,
        count: collectionArticles(item.id, published).length,
      })),
    },
  }
}
