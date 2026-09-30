import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { buildActivity } from "./lib/activity.mjs"
import { generateSitePages } from "./lib/site-pages.mjs"
import { validateSite, topicList } from "./lib/site-settings.mjs"
import { splitNote } from "./lib/library.mjs"
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

test("heatmap uses actual commits, China dates and exactly 365 days, including leap day", () => {
  const now = new Date("2024-03-01T02:00:00Z"),
    timestamps = [
      "2024-02-29T15:59:59Z",
      "2024-02-29T16:00:00Z",
      "2024-02-29T16:01:00Z",
      "2023-01-01T00:00:00Z",
      "2024-03-02T00:00:00Z",
    ].map((value) => Date.parse(value) / 1000)
  const activity = buildActivity(timestamps, now),
    days = activity.weeks.flatMap((week) => week.days)
  assert.equal(activity.total, 3)
  assert.equal(activity.asOf, "2024-03-01")
  assert.equal(days.filter((day) => day.inRange).length, 365)
  assert.equal(days.find((day) => day.date === "2024-02-29").count, 1)
  assert.equal(days.find((day) => day.date === "2024-03-01").count, 2)
  assert.equal(buildActivity([], now).total, 0)
})
test("topic and module hubs do not list articles; secondary lists paginate without drafts", () => {
  const articles = Array.from({ length: 53 }, (_, i) => article(i))
  articles.push(article(90, { published: false }))
  const { output, data } = generateSitePages(settings, { version: 2, articles }, buildActivity([]))
  const hub = splitNote(output.get("topics/index.md").toString())
  assert.equal(hub.data.type, "topic-hub")
  assert.equal(hub.body, "")
  assert.equal(splitNote(output.get("notes/index.md").toString()).data.type, "collection-hub")
  const route = `topics/${settings.topics[0].id}`
  const pages = [route, `${route}-p2`, `${route}-p3`].map(
    (route) => splitNote(output.get(route + ".md").toString()).data.listing,
  )
  assert.deepEqual(
    pages.map((page) => page.rows.length),
    [24, 24, 5],
  )
  assert.equal(new Set(pages.flatMap((page) => page.rows.map((row) => row.id))).size, 53)
  assert.ok(!pages.some((page) => page.rows.some((row) => row.id === "note-90")))
  assert.equal(data.topics[0].count, 53)
})
test("renaming or hiding a topic preserves original category, stable URL and article source", () => {
  const changed = structuredClone(settings),
    articles = [article(1)],
    before = JSON.stringify(articles)
  changed.topics[0].title = "新专题名称"
  changed.topics[0].visible = false
  const { output } = generateSitePages(changed, { version: 2, articles }, buildActivity([]))
  const page = splitNote(output.get(`topics/${changed.topics[0].id}.md`).toString())
  assert.equal(page.data.title, "新专题名称")
  assert.equal(page.data.listing.rows.length, 1)
  assert.equal(JSON.stringify(articles), before)
  const extra = topicList(changed, [...articles, article(2, { category: "本地新增专题" })])
  assert.equal(extra.at(-1).count, 1)
})
test("site settings reject malformed module and topic definitions", () => {
  const duplicate = structuredClone(settings)
  duplicate.topics.push({ ...duplicate.topics[0] })
  assert.throws(() => validateSite(duplicate))
  const missing = structuredClone(settings)
  missing.home.sections.pop()
  assert.throws(() => validateSite(missing))
  const invalid = structuredClone(settings)
  invalid.topics[0].id = "../../escape"
  assert.throws(() => validateSite(invalid))
})
