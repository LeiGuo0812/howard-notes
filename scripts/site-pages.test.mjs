import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { buildActivity, readActivity } from "./lib/activity.mjs"
import { generateSitePages, tagList } from "./lib/site-pages.mjs"
import { validateSite, topicList } from "./lib/site-settings.mjs"
import { splitNote } from "./lib/library.mjs"
import { parseNoteDate, sortNotes } from "./lib/note-dates.mjs"
import {
  normalizeSite,
  applyHomeTemplate,
  orderedSections,
  designVariables,
  designStyle,
  CHINESE_FONTS,
  ENGLISH_FONTS,
  applySitePalette,
} from "./lib/site-design.mjs"
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

test("palette selection preserves layout and fonts, supports custom links, and rejects unknown presets", () => {
  const original = normalizeSite(settings)
  assert.equal(original.design.palette, "current")
  const selected = applySitePalette(original, "minimal-soft")
  assert.equal(selected.design.palette, "minimal-soft")
  assert.equal(selected.design.accentColor, "#875035")
  assert.equal(selected.design.darkAccentColor, "#f3bf9f")
  assert.equal(designVariables(selected)["--site-palette-reader-light"], "#f7f8f8")
  assert.deepEqual(selected.home, original.home)
  assert.deepEqual(selected.pages, original.pages)
  for (const key of [
    "chineseFont",
    "englishFont",
    "fontSize",
    "lineHeight",
    "contentWidth",
    "cardGap",
    "radius",
  ])
    assert.equal(selected.design[key], original.design[key])
  const restored = normalizeSite(JSON.parse(JSON.stringify(selected)))
  assert.equal(restored.design.palette, "minimal-soft")
  assert.doesNotThrow(() => validateSite(restored))
  restored.design.accentColor = "#884466"
  assert.equal(designVariables(restored)["--site-accent-light"], "#884466")
  const legacy = applySitePalette(restored, "current")
  assert.ok(!Object.keys(designVariables(legacy)).some((key) => key.startsWith("--site-palette-")))
  assert.equal(original.design.palette, "current")
  selected.design.palette = "removed-theme"
  assert.throws(() => validateSite(selected), /样式/)
  assert.throws(() => applySitePalette(original, "removed-theme"), /配色/)
})

test("layout defaults preserve existing configuration; templates and heatmap pinning are independent", () => {
  // Exercise legacy defaults independently of choices saved through the admin.
  const legacy = structuredClone(settings)
  delete legacy.design
  delete legacy.pages
  legacy.accent = "blue"
  const before = structuredClone(legacy),
    normalized = normalizeSite(legacy)
  assert.deepEqual(legacy, before)
  assert.equal(normalized.pages.homeTemplate, "classic")
  assert.equal(normalized.pages.articleLayout, "wide")
  assert.equal(normalized.design.contentWidth, 1040)
  assert.equal(normalized.design.accentColor, "#365f8b")
  const knowledge = applyHomeTemplate(legacy, "knowledge")
  assert.equal(knowledge.home.sections[0].id, "topics")
  assert.equal(knowledge.home.sections.find((section) => section.id === "memories").enabled, true)
  const activity = knowledge.home.sections.find((section) => section.id === "activity")
  knowledge.home.sections = [
    activity,
    ...knowledge.home.sections.filter((section) => section !== activity),
  ]
  assert.equal(orderedSections(knowledge).at(-1).id, "activity")
  knowledge.home.activityPinned = false
  assert.equal(orderedSections(knowledge)[0].id, "activity")
  assert.doesNotThrow(() => validateSite(knowledge))
})
test("style validation rejects injected CSS and invalid sizes; configured counts exclude unpublished notes", () => {
  const configured = normalizeSite(settings)
  configured.design.accentColor = "#884466"
  configured.home.sections.find((section) => section.id === "recent").limit = 9
  configured.pages.topicPreviewCount = 3
  const articles = Array.from({ length: 15 }, (_, i) => article(i))
  articles.push(article(99, { published: false }))
  const result = generateSitePages(configured, { version: 2, articles }, readActivity(articles))
  assert.equal(result.data.recent.length, 9)
  assert.equal(result.data.topics[0].preview.length, 3)
  assert.equal(result.data.topics[0].previewPool.length, 5)
  assert.ok(result.data.recent.every((row) => row.id !== "note-99"))
  assert.equal(designVariables(configured)["--site-accent-light"], "#884466")
  for (const [key, value] of [
    ["accentColor", "red;background:url(https://example.test)"],
    ["font", "url(bad)"],
    ["fontSize", 100],
    ["lineHeight", Infinity],
    ["radius", -1],
  ]) {
    const invalid = structuredClone(configured)
    invalid.design[key] = value
    assert.throws(() => validateSite(invalid), /样式/)
  }
  configured.pages.topicLayout = "arbitrary"
  assert.throws(() => validateSite(configured), /模板/)
})

test("legacy home tag slot migrates to four memory previews and removes browsing without changing other settings", () => {
  const legacy = structuredClone(settings)
  legacy.home.sections = [
    { id: "recent", title: "近期阅读", enabled: true, limit: 8 },
    { id: "tags", title: "旧标签", enabled: false },
    { id: "collections", title: "浏览", enabled: true },
    { id: "topics", title: "主题", enabled: true },
    { id: "featured", title: "推荐", enabled: true, limit: 3 },
    { id: "activity", title: "活动", enabled: true },
  ]
  const before = JSON.stringify(legacy)
  assert.doesNotThrow(() => validateSite(legacy))
  const normalized = normalizeSite(legacy)
  assert.deepEqual(
    normalized.home.sections.map((section) => section.id),
    ["recent", "memories", "topics", "featured", "activity"],
  )
  assert.deepEqual(normalized.home.sections[1], {
    id: "memories",
    title: "记忆卡",
    enabled: false,
    limit: 4,
  })
  assert.equal(normalized.home.sections[0].limit, 8)
  assert.deepEqual(orderedSections(legacy), normalized.home.sections)
  assert.deepEqual(normalized.collections, legacy.collections)
  assert.equal(JSON.stringify(legacy), before)
  assert.doesNotThrow(() => validateSite(normalized))
  assert.deepEqual(normalizeSite(normalized).home.sections, normalized.home.sections)
  for (const template of ["classic", "articles", "knowledge"])
    assert.ok(
      applyHomeTemplate(legacy, template).home.sections.every(
        (section) => !["tags", "collections"].includes(section.id),
      ),
    )
})

test("a saved new memory module takes precedence over its old tag module", () => {
  const changed = structuredClone(settings)
  const memory = changed.home.sections.find((section) => section.id === "memories")
  memory.title = "随手记录"
  memory.enabled = false
  changed.home.sections.unshift({ id: "tags", title: "标签", enabled: true })
  const modules = orderedSections(changed)
  assert.equal(modules.filter((section) => section.id === "memories").length, 1)
  assert.deepEqual(
    modules.find((section) => section.id === "memories"),
    memory,
  )
  memory.limit = 5
  assert.throws(() => validateSite(changed), /展示数量/)
})

test("legacy typography migrates to separate language choices without changing saved settings", () => {
  for (const [font, chineseFont, englishFont] of [
    ["sans", "sans", "system"],
    ["serif", "serif", "serif"],
    ["system", "sans", "system"],
  ]) {
    const legacy = structuredClone(settings)
    legacy.design = { ...legacy.design, font }
    delete legacy.design.chineseFont
    delete legacy.design.englishFont
    const before = structuredClone(legacy)
    const normalized = normalizeSite(legacy)
    assert.equal(normalized.design.chineseFont, chineseFont)
    assert.equal(normalized.design.englishFont, englishFont)
    assert.deepEqual(legacy, before)
    assert.doesNotThrow(() => validateSite(normalized))
    assert.equal(designVariables(legacy)["--site-font"], designVariables(normalized)["--site-font"])
  }
  const explicit = normalizeSite(settings)
  explicit.design.font = "serif"
  explicit.design.chineseFont = "microsoft-yahei"
  explicit.design.englishFont = "georgia"
  const reloaded = normalizeSite(JSON.parse(JSON.stringify(explicit)))
  assert.equal(reloaded.design.chineseFont, "microsoft-yahei")
  assert.equal(reloaded.design.englishFont, "georgia")
})

test("English families precede the chosen Chinese family, with generic fallbacks last", () => {
  const configured = normalizeSite(settings)
  configured.design.chineseFont = "noto-serif-cjk"
  configured.design.englishFont = "georgia"
  const variables = designVariables(configured)
  assert.ok(variables["--site-font"].startsWith('"Georgia",'))
  assert.ok(
    variables["--site-font"].indexOf('"Georgia"') <
      variables["--site-font"].indexOf('"Noto Serif CJK SC"'),
  )
  assert.ok(variables["--site-font-chinese"].startsWith('"Noto Serif CJK SC",'))
  assert.ok(variables["--site-font-english"].startsWith('"Georgia",'))
  assert.match(variables["--site-font"], /, serif$/)
  assert.ok(!variables["--site-font"].includes("system-ui"))
  assert.equal(
    new Set(variables["--site-font"].split(", ")).size,
    variables["--site-font"].split(", ").length,
  )
})

test("every local font option validates and unsupported font identifiers cannot inject CSS", () => {
  for (const [key, fonts] of [
    ["chineseFont", CHINESE_FONTS],
    ["englishFont", ENGLISH_FONTS],
  ]) {
    assert.equal(new Set(fonts.map((font) => font.id)).size, fonts.length)
    assert.ok(Object.isFrozen(fonts))
    for (const font of fonts) {
      const configured = normalizeSite(settings)
      configured.design[key] = font.id
      assert.doesNotThrow(() => validateSite(configured), font.id)
      assert.ok(
        designVariables(configured)["--site-font"].includes(JSON.stringify(font.families[0])),
      )
    }
    for (const invalidFont of [
      "__proto__",
      "constructor",
      "Arial; background:url(evil)",
      null,
      42,
    ]) {
      const configured = normalizeSite(settings)
      configured.design[key] = invalidFont
      assert.throws(() => validateSite(configured), /样式/)
      assert.doesNotThrow(() => designStyle(configured))
      assert.ok(!designStyle(configured).includes("evil"))
    }
  }
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

test("memory hub has only a shell and never adds cards to article discovery data", () => {
  const articles = [article(0, { tags: ["article-only"] })]
  const result = generateSitePages(settings, { version: 2, articles }, readActivity(articles))
  const memory = result.output.get("memory/index.md").toString()
  assert.match(memory, /type: memory-hub/)
  assert.doesNotMatch(memory, /article-only|文章000/)
  assert.equal(result.data.articles.length, 1)
  assert.equal(result.data.total, 1)
  assert.deepEqual(
    result.data.tags.map(({ title }) => title),
    ["article-only"],
  )
})
