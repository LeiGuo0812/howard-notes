import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { buildActivity, readActivity } from "./lib/activity.mjs"
import { generateSitePages, tagList } from "./lib/site-pages.mjs"
import { validateSite, topicList } from "./lib/site-settings.mjs"
import { splitNote } from "./lib/library.mjs"
import { parseNoteDate, sortNotes } from "./lib/note-dates.mjs"
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
const article = (index, extra = {}) => ({
  id: `note-${index}`,
  file: `notes/${index}.md`,
  title: `文章${String(index).padStart(3, "0")}`,
  category: settings.topics[0].category,
  date: "2026-09-30",
  published: true,
  featured: index === 0,
  ...extra,
})

test("original Obsidian dates preserve China calendar days, ordinal dates and ISO zones", () => {
  assert.equal(parseNoteDate("Friday, July 12th 2024, 11:34:54 pm"), "2024-07-12")
  assert.equal(parseNoteDate("2024-02-29T23:55:00"), "2024-02-29")
  assert.equal(parseNoteDate("2024-02-29T16:00:00Z"), "2024-03-01")
  assert.equal(parseNoteDate("2024-02-30"), null)
  assert.equal(parseNoteDate("unknown"), null)
})
test("heatmap counts note creation and latest modification, deduplicates same-day activity and excludes drafts/future dates", () => {
  const now = new Date("2024-03-01T02:00:00Z")
  const articles = [
    article(1, { created: "2024-02-29", modified: "2024-03-01" }),
    article(2, { created: "2024-03-01", modified: "2024-03-01" }),
    article(3, { created: "2024-03-01", published: false }),
    article(4, { created: "2024-03-02" }),
    article(5, { created: "2022-01-01" }),
  ]
  const activity = buildActivity(articles, now),
    days = activity.weeks.flatMap((week) => week.days)
  assert.equal(activity.total, 3)
  assert.equal(days.filter((day) => day.inRange).length, 365)
  assert.equal(days.find((day) => day.date === "2024-02-29").count, 1)
  const march = days.find((day) => day.date === "2024-03-01")
  assert.deepEqual([march.count, march.created, march.modified], [2, 1, 1])
  const leap = buildActivity(articles, now, "2024")
  assert.equal(leap.weeks.flatMap((week) => week.days).filter((d) => d.inRange).length, 366)
  assert.equal(buildActivity([], now).total, 0)
  assert.deepEqual(
    readActivity(articles, now).periods.map((p) => p.id),
    ["recent", "2024", "2022"],
  )
})
test("sorts by original creation, latest modification and title without changing the catalog", () => {
  const articles = [
    article(3, { created: "2023-01-01", modified: "2026-01-01" }),
    article(1, { created: "2024-01-01", modified: "2025-01-01" }),
  ]
  const before = JSON.stringify(articles)
  assert.deepEqual(
    sortNotes(articles).map((a) => a.id),
    ["note-3", "note-1"],
  )
  assert.deepEqual(
    sortNotes(articles, "created-desc").map((a) => a.id),
    ["note-1", "note-3"],
  )
  assert.deepEqual(
    sortNotes(articles, "created-asc").map((a) => a.id),
    ["note-3", "note-1"],
  )
  assert.deepEqual(
    sortNotes(articles, "title-asc").map((a) => a.id),
    ["note-1", "note-3"],
  )
  assert.equal(JSON.stringify(articles), before)
})
test("topic previews contain four notes; all lists show all public notes and preserve legacy page routes", () => {
  const articles = Array.from({ length: 53 }, (_, i) => article(i))
  articles.push(article(90, { published: false }))
  const { output, data } = generateSitePages(
    settings,
    { version: 2, articles },
    readActivity(articles),
  )
  assert.equal(splitNote(output.get("topics/index.md").toString()).data.type, "topic-hub")
  const all = splitNote(output.get("notes/index.md").toString())
  assert.equal(all.data.type, "listing")
  assert.equal(all.data.listing.rows.length, 53)
  const route = `topics/${settings.topics[0].id}`
  const page = splitNote(output.get(route + ".md").toString())
  assert.equal(page.data.listing.rows.length, 53)
  assert.deepEqual(page.data.aliases, [`${route}-p2`, `${route}-p3`])
  assert.ok(!page.data.listing.rows.some((row) => row.id === "note-90"))
  assert.equal(data.topics[0].preview.length, 4)
  assert.equal(data.featured.length, 1)
  assert.equal(data.recent.length, 6)
  assert.equal(data.topics[0].count, 53)
})
test("tags merge equivalent slugs, deduplicate a note and support nested tags without exposing drafts", () => {
  const articles = [
    article(1, { tags: ["Python", "python", "影像/DWI", "../escape"] }),
    article(2, { tags: ["python"] }),
    article(3, { tags: ["secret"], published: false }),
  ]
  const tags = tagList(articles)
  assert.equal(tags.find((tag) => tag.id === "python").count, 2)
  assert.equal(tags.find((tag) => tag.id === "影像").count, 1)
  assert.equal(tags.find((tag) => tag.id === "影像/dwi").count, 1)
  assert.ok(!tags.some((tag) => tag.id.includes("..") || tag.id === "secret"))
  const { output } = generateSitePages(settings, { version: 2, articles }, readActivity(articles))
  assert.equal(splitNote(output.get("tags/index.md").toString()).data.type, "tag-hub")
  assert.equal(splitNote(output.get("tags/python.md").toString()).data.listing.rows.length, 2)
  assert.ok(!output.has("tags/secret.md"))
})
test("previews use source text without code/HTML, and never include private note content", () => {
  const articles = [article(1), article(2, { published: false })]
  const bytes = Buffer.from(
    "---\r\ndate created: 2024-01-01\r\n---\r\n# 标题\r\n\r\n正文 **格式** 内容。\r\n\r\n```js\r\nsecretCode\r\n```\r\n\r\n<script>alert(1)</script>\r\n",
  )
  const sources = new Map([
    ["notes/1.md", bytes],
    ["notes/2.md", Buffer.from("private-note")],
  ])
  const { data } = generateSitePages(
    settings,
    { version: 2, articles },
    readActivity(articles),
    24,
    sources,
  )
  assert.equal(data.recent[0].excerpt, "正文 格式 内容。")
  assert.ok(!JSON.stringify(data).includes("private-note"))
  assert.deepEqual(sources.get("notes/1.md"), bytes)
})
test("renaming or hiding a topic preserves original category, stable URL and article source", () => {
  const changed = structuredClone(settings),
    articles = [article(1)],
    before = JSON.stringify(articles)
  changed.topics[0].title = "新专题名称"
  changed.topics[0].visible = false
  const { output } = generateSitePages(changed, { version: 2, articles }, readActivity(articles))
  const page = splitNote(output.get(`topics/${changed.topics[0].id}.md`).toString())
  assert.equal(page.data.title, "新专题名称")
  assert.equal(page.data.listing.rows.length, 1)
  assert.equal(JSON.stringify(articles), before)
  const extra = topicList(changed, [...articles, article(2, { category: "本地新增专题" })])
  assert.equal(extra.at(-1).count, 1)
})
test("site settings reject malformed definitions while accepting existing settings", () => {
  const duplicate = structuredClone(settings)
  duplicate.topics.push({ ...duplicate.topics[0] })
  assert.throws(() => validateSite(duplicate))
  const missing = structuredClone(settings)
  missing.home.sections = missing.home.sections.filter((s) => s.id !== "activity")
  assert.throws(() => validateSite(missing))
  const invalid = structuredClone(settings)
  invalid.topics[0].id = "../../escape"
  assert.throws(() => validateSite(invalid))
  const legacy = structuredClone(settings)
  legacy.home.sections = legacy.home.sections.filter((s) =>
    ["topics", "collections", "activity"].includes(s.id),
  )
  legacy.navigation = legacy.navigation.filter((n) => n.id !== "tags")
  assert.equal(validateSite(legacy), legacy)
})
