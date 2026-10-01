export const SITE_PATH = "library/site.json"
export const SECTION_IDS = ["featured", "recent", "topics", "collections", "tags", "activity"]
export const COLLECTION_IDS = ["recent", "featured", "all"]
export const NAV_IDS = ["notes", "topics", "tags", "memories", "about"]
import { sortNotes } from "./note-dates.mjs"
import { validateImageHost } from "./image-host.mjs"
import { validateDesign } from "./site-design.mjs"
const text = (value, limit, required = true) =>
  typeof value === "string" && value.length <= limit && (!required || !!value.trim())
const id = (value) =>
  typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80
function unique(items, key) {
  return new Set(items.map((item) => item[key])).size === items.length
}

export function validateSite(settings) {
  validateDesign(settings)
  if (settings?.imageHost !== undefined) validateImageHost(settings.imageHost)
  if (
    settings?.version !== 1 ||
    !text(settings.brand?.name, 40) ||
    !text(settings.brand?.subtitle, 60, false) ||
    !text(settings.brand?.mark, 5)
  )
    throw new Error("请检查站点名称。")
  const home = settings.home
  if (
    !text(home?.title, 80) ||
    !text(home?.description, 200, false) ||
    !["single", "split"].includes(home?.layout) ||
    !["comfortable", "compact"].includes(home?.density)
  )
    throw new Error("首页设置不正确。")
  if (
    !Array.isArray(home.sections) ||
    !["topics", "collections", "activity"].every((id) =>
      home.sections.some((item) => item.id === id),
    ) ||
    !unique(home.sections, "id") ||
    home.sections.some(
      (item) =>
        !SECTION_IDS.includes(item.id) ||
        typeof item.enabled !== "boolean" ||
        !text(item.title, 40),
    )
  )
    throw new Error("首页模块设置不正确。")
  if (
    !Array.isArray(settings.topics) ||
    settings.topics.length > 80 ||
    !unique(settings.topics, "id") ||
    !unique(settings.topics, "title") ||
    !unique(settings.topics, "category") ||
    settings.topics.some(
      (topic) =>
        !id(topic.id) ||
        !text(topic.title, 60) ||
        !text(topic.category, 120) ||
        typeof topic.visible !== "boolean",
    )
  )
    throw new Error("专题名称或标识重复，或格式不正确。")
  if (
    !Array.isArray(settings.collections) ||
    settings.collections.length !== COLLECTION_IDS.length ||
    !unique(settings.collections, "id") ||
    settings.collections.some(
      (item) =>
        !COLLECTION_IDS.includes(item.id) ||
        !text(item.title, 40) ||
        typeof item.enabled !== "boolean",
    )
  )
    throw new Error("文章入口设置不正确。")
  if (
    !Array.isArray(settings.navigation) ||
    !["notes", "topics", "about"].every((id) =>
      settings.navigation.some((item) => item.id === id),
    ) ||
    !unique(settings.navigation, "id") ||
    settings.navigation.some(
      (item) =>
        !NAV_IDS.includes(item.id) || !text(item.label, 20) || typeof item.visible !== "boolean",
    )
  )
    throw new Error("导航设置不正确。")
  if (
    !["green", "blue", "ochre"].includes(settings.accent) ||
    !text(settings.footer, 100, false) ||
    !text(settings.about?.title, 80) ||
    !text(settings.about?.body, 30000, false)
  )
    throw new Error("页面内容设置不正确。")
  return settings
}

// A deterministic URL for categories added locally before they are configured in the UI.
export function categoryId(category) {
  let a = 2166136261,
    b = 5381
  for (const ch of category) {
    a = Math.imul(a ^ ch.codePointAt(0), 16777619)
    b = Math.imul(b, 33) ^ ch.codePointAt(0)
  }
  return `topic-${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}
export function topicList(settings, articles) {
  const topics = settings.topics.map((topic) => ({ ...topic }))
  for (const category of new Set(articles.map((article) => article.category))) {
    if (!topics.some((topic) => topic.category === category))
      topics.push({ id: categoryId(category), title: category, category, visible: true })
  }
  if (!unique(topics, "id")) throw new Error("专题网址重复，请调整专题标识。")
  return topics.map((topic) => ({
    ...topic,
    count: articles.filter(
      (article) => article.category === topic.category && article.published !== false,
    ).length,
  }))
}

export function collectionArticles(id, articles) {
  const visible = articles.filter((article) => article.published)
  const sorted = sortNotes(visible)
  return id === "featured" ? sorted.filter((article) => article.featured) : sorted
}
