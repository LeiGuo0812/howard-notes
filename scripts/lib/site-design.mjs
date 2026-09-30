export const DEFAULT_DESIGN = Object.freeze({
  font: "sans",
  fontSize: 16,
  lineHeight: 1.95,
  contentWidth: 1200,
  cardGap: 22,
  radius: 12,
})
export const DEFAULT_PAGES = Object.freeze({
  homeTemplate: "classic",
  topicLayout: "list",
  articleLayout: "wide",
  topicPreviewCount: 4,
})
export const ACCENT_COLORS = Object.freeze({
  green: ["#286352", "#91cbb2"],
  blue: ["#365f8b", "#93bbdf"],
  ochre: ["#896222", "#dec18d"],
})
const fonts = {
  sans: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", SimSun, serif',
  system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
}
export function siteDesign(settings) {
  const colors = ACCENT_COLORS[settings.accent] || ACCENT_COLORS.blue
  return {
    ...DEFAULT_DESIGN,
    accentColor: colors[0],
    darkAccentColor: colors[1],
    ...settings.design,
  }
}
export function sitePages(settings) {
  return { ...DEFAULT_PAGES, ...settings.pages }
}
export function normalizeSite(settings) {
  const result = structuredClone(settings)
  result.design = siteDesign(settings)
  result.pages = sitePages(settings)
  result.home.activityPinned ??= true
  for (const [id, title] of [
    ["featured", "试试手气"],
    ["recent", "最近文章"],
    ["tags", "标签"],
  ])
    if (!result.home.sections.some((section) => section.id === id))
      result.home.sections.push({ id, title, enabled: false })
  result.home.sections = orderedSections(result)
  return result
}
export function sectionLimit(section) {
  return section?.limit ?? (section?.id === "featured" ? 3 : 6)
}
export function orderedSections(settings) {
  const sections = [...settings.home.sections]
  return settings.home.activityPinned !== false
    ? sections.sort((a, b) => Number(a.id === "activity") - Number(b.id === "activity"))
    : sections
}
export function applyHomeTemplate(settings, template) {
  const result = normalizeSite(settings)
  result.pages.homeTemplate = template
  const orders = {
    classic: ["featured", "recent", "topics", "collections", "tags", "activity"],
    articles: ["featured", "recent", "tags", "topics", "collections", "activity"],
    knowledge: ["topics", "tags", "featured", "recent", "collections", "activity"],
  }
  if (!orders[template]) throw new Error("首页模板不正确。")
  result.home.sections.sort(
    (a, b) => orders[template].indexOf(a.id) - orders[template].indexOf(b.id),
  )
  result.home.layout = template === "knowledge" ? "split" : "single"
  if (template === "knowledge")
    for (const section of result.home.sections)
      if (["topics", "tags"].includes(section.id)) section.enabled = true
  return result
}
export function designVariables(settings) {
  const d = siteDesign(settings)
  return {
    "--site-accent-light": d.accentColor,
    "--site-accent-dark": d.darkAccentColor,
    "--site-font": fonts[d.font],
    "--site-font-size": `${d.fontSize}px`,
    "--site-line-height": String(d.lineHeight),
    "--site-content-width": `${d.contentWidth}px`,
    "--site-card-gap": `${d.cardGap}px`,
    "--site-radius": `${d.radius}px`,
  }
}
export function designStyle(settings) {
  return Object.entries(designVariables(settings))
    .map(([key, value]) => `${key}:${value}`)
    .join(";")
}
export function validateDesign(settings) {
  if (!settings || typeof settings !== "object") throw new Error("页面设置不正确。")
  const d = siteDesign(settings),
    p = sitePages(settings)
  const number = (value, min, max, integer = false) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value))
  if (
    !Object.hasOwn(fonts, d.font) ||
    !/^#[\da-f]{6}$/i.test(d.accentColor) ||
    !/^#[\da-f]{6}$/i.test(d.darkAccentColor) ||
    !number(d.fontSize, 14, 22, true) ||
    !number(d.lineHeight, 1.4, 2.4) ||
    !number(d.contentWidth, 760, 1440, true) ||
    !number(d.cardGap, 8, 40, true) ||
    !number(d.radius, 0, 24, true)
  )
    throw new Error("样式设置不正确，请检查颜色、字号、间距和宽度。")
  if (
    !["classic", "articles", "knowledge"].includes(p.homeTemplate) ||
    !["list", "cards"].includes(p.topicLayout) ||
    !["wide", "centered"].includes(p.articleLayout) ||
    !number(p.topicPreviewCount, 3, 5, true)
  )
    throw new Error("页面模板设置不正确。")
  if (
    settings.home?.activityPinned !== undefined &&
    typeof settings.home.activityPinned !== "boolean"
  )
    throw new Error("热图位置设置不正确。")
  for (const section of settings.home?.sections || [])
    if (
      section.limit !== undefined &&
      (!["featured", "recent"].includes(section.id) ||
        !number(section.limit, 1, section.id === "featured" ? 6 : 20, true))
    )
      throw new Error("文章展示数量不正确。")
}
