export const CATALOG_PATH = "library/catalog.json"
export const REPOSITORY = "LeiGuo0812/howard-notes"
export const BRANCH = "main"
import { validDay } from "./note-dates.mjs"

export function safeRelative(file) {
  return (
    typeof file === "string" &&
    !file.includes("\\") &&
    !file.includes("\0") &&
    !file.startsWith("/") &&
    file.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith("."))
  )
}

export function validateCatalog(catalog) {
  if (catalog?.version !== 2 || !Array.isArray(catalog.articles))
    throw new Error("发布目录格式不正确。")
  const ids = new Set(),
    files = new Set()
  for (const article of catalog.articles) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.id) || ids.has(article.id))
      throw new Error("文章网址重复或不合法。")
    if (
      !safeRelative(article.file) ||
      !article.file.startsWith("notes/") ||
      !article.file.endsWith(".md") ||
      files.has(article.file)
    )
      throw new Error("原文文件路径重复或不合法。")
    if (typeof article.title !== "string" || !article.title.trim() || article.title.length > 250)
      throw new Error("请填写文章标题。")
    if (typeof article.category !== "string" || !article.category.trim())
      throw new Error("请填写专题。")
    if (typeof article.published !== "boolean") throw new Error("请设置文章发布状态。")
    if (
      article.draftOf !== undefined &&
      (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.draftOf) ||
        article.draftOf === article.id ||
        article.published ||
        article.draftBaseline?.article?.id !== article.draftOf ||
        article.draftBaseline?.article?.published !== true ||
        typeof article.draftBaseline?.sha !== "string" ||
        !article.draftBaseline.sha ||
        !safeRelative(article.draftBaseline.article.file))
    )
      throw new Error("文章修改草稿的原版本信息不正确。")
    if (
      typeof article.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(article.date) ||
      Number.isNaN(Date.parse(article.date))
    )
      throw new Error("发布日期格式不正确。")
    if (
      [article.created, article.modified].some((value) => value !== undefined && !validDay(value))
    )
      throw new Error("笔记创建或修改日期格式不正确。")
    if (
      article.tags !== undefined &&
      (!Array.isArray(article.tags) || article.tags.some((t) => typeof t !== "string"))
    )
      throw new Error("标签格式不正确。")
    ids.add(article.id)
    files.add(article.file)
  }
  return catalog
}

export function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Updates one article against the version that was opened, never overwriting a concurrent edit.
export function mergeArticle(latest, opened, edited) {
  validateCatalog(latest)
  const current = latest.articles.find((item) => item.id === edited.id)
  if (!equal(current ?? null, opened ?? null))
    throw new Error("这篇文章的发布设置已在另一端更改。请先下载当前编辑内容，再重新载入最新版本。")
  const merged = structuredClone(latest)
  const index = merged.articles.findIndex((item) => item.id === edited.id)
  if (index < 0) merged.articles.push(edited)
  else merged.articles[index] = edited
  return validateCatalog(merged)
}
