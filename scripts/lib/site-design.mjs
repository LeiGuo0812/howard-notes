import { getSitePalette, paletteVariables } from "./site-palettes.mjs"
import { brandMarkColors } from "./site-brand-colors.mjs"

export const DEFAULT_DESIGN = Object.freeze({
  palette: "current",
  font: "sans",
  chineseFont: "sans",
  englishFont: "system",
  fontSize: 16,
  lineHeight: 1.95,
  contentWidth: 1040,
  cardGap: 22,
  radius: 20,
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
const chineseFallbacks = {
  黑体: ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei"],
  宋体: ["Songti SC", "Noto Serif CJK SC", "SimSun"],
  楷体: ["Kaiti SC", "KaiTi", "STKaiti", "Noto Serif CJK SC", "SimSun"],
}
const englishFallbacks = {
  无衬线: ["SF Pro Text", "Segoe UI", "Helvetica Neue", "Arial", "Liberation Sans"],
  衬线: ["Georgia", "Times New Roman", "Liberation Serif"],
  等宽: ["SFMono-Regular", "Cascadia Code", "Consolas", "Menlo", "Liberation Mono"],
}
const fontOptions = (rows, fallbacks) =>
  Object.freeze(
    rows.map(([id, label, group, ...families]) =>
      Object.freeze({
        id,
        label,
        group,
        families: Object.freeze([...new Set([...families, ...fallbacks[group]])]),
        generic:
          group === "等宽"
            ? "monospace"
            : ["宋体", "楷体", "衬线"].includes(group)
              ? "serif"
              : "sans-serif",
      }),
    ),
  )
// Local font families only: selecting an unavailable family uses the following
// platform fallbacks, without downloading fonts or changing source notes.
export const CHINESE_FONTS = fontOptions(
  [
    ["sans", "系统黑体", "黑体"],
    ["pingfang", "苹方 PingFang SC", "黑体", "PingFang SC"],
    ["heiti", "黑体 Heiti SC", "黑体", "Heiti SC"],
    ["microsoft-yahei", "微软雅黑", "黑体", "Microsoft YaHei"],
    ["dengxian", "等线", "黑体", "DengXian"],
    ["simhei", "中易黑体", "黑体", "SimHei"],
    ["stheiti", "华文黑体", "黑体", "STHeiti"],
    ["stxihei", "华文细黑", "黑体", "STXihei"],
    ["lihei-pro", "儷黑 Pro", "黑体", "LiHei Pro"],
    ["noto-sans-sc", "Noto Sans SC", "黑体", "Noto Sans SC"],
    ["noto-sans-cjk", "Noto Sans CJK SC", "黑体", "Noto Sans CJK SC"],
    ["source-han-sans", "思源黑体", "黑体", "Source Han Sans SC", "思源黑体"],
    ["sarasa-gothic", "更纱黑体", "黑体", "Sarasa Gothic SC", "Sarasa UI SC"],
    ["wqy-microhei", "文泉驿微米黑", "黑体", "WenQuanYi Micro Hei"],
    ["wqy-zenhei", "文泉驿正黑", "黑体", "WenQuanYi Zen Hei"],
    ["serif", "系统宋体", "宋体"],
    ["songti", "宋体 Songti SC", "宋体", "Songti SC"],
    ["simsun", "中易宋体", "宋体", "SimSun"],
    ["nsimsun", "新宋体", "宋体", "NSimSun"],
    ["stsong", "华文宋体", "宋体", "STSong"],
    ["stzhongsong", "华文中宋", "宋体", "STZhongsong"],
    ["fangsong", "仿宋", "宋体", "FangSong"],
    ["stfangsong", "华文仿宋", "宋体", "STFangsong"],
    ["noto-serif-sc", "Noto Serif SC", "宋体", "Noto Serif SC"],
    ["noto-serif-cjk", "Noto Serif CJK SC", "宋体", "Noto Serif CJK SC"],
    ["source-han-serif", "思源宋体", "宋体", "Source Han Serif SC", "思源宋体"],
    ["kaiti", "楷体", "楷体", "Kaiti SC", "KaiTi"],
    ["stkaiti", "华文楷体", "楷体", "STKaiti"],
    ["lxgw-wenkai", "霞鹜文楷", "楷体", "LXGW WenKai", "LXGW WenKai GB"],
    ["lxgw-wenkai-screen", "霞鹜文楷屏幕阅读版", "楷体", "LXGW WenKai Screen"],
  ],
  chineseFallbacks,
)
export const ENGLISH_FONTS = fontOptions(
  [
    ["system", "System / 系统字体", "无衬线"],
    ["sans", "Sans-serif / 通用无衬线", "无衬线", "Arial", "Helvetica"],
    ["sf-pro", "SF Pro", "无衬线", "SF Pro Text", "SF Pro Display"],
    ["segoe-ui", "Segoe UI", "无衬线", "Segoe UI"],
    ["helvetica-neue", "Helvetica Neue", "无衬线", "Helvetica Neue"],
    ["helvetica", "Helvetica", "无衬线", "Helvetica"],
    ["arial", "Arial", "无衬线", "Arial"],
    ["aptos", "Aptos", "无衬线", "Aptos"],
    ["calibri", "Calibri", "无衬线", "Calibri"],
    ["verdana", "Verdana", "无衬线", "Verdana"],
    ["tahoma", "Tahoma", "无衬线", "Tahoma"],
    ["trebuchet", "Trebuchet MS", "无衬线", "Trebuchet MS"],
    ["avenir-next", "Avenir Next", "无衬线", "Avenir Next"],
    ["avenir", "Avenir", "无衬线", "Avenir"],
    ["gill-sans", "Gill Sans", "无衬线", "Gill Sans"],
    ["inter", "Inter", "无衬线", "Inter"],
    ["roboto", "Roboto", "无衬线", "Roboto"],
    ["open-sans", "Open Sans", "无衬线", "Open Sans"],
    ["lato", "Lato", "无衬线", "Lato"],
    ["noto-sans", "Noto Sans", "无衬线", "Noto Sans"],
    ["source-sans", "Source Sans 3", "无衬线", "Source Sans 3", "Source Sans Pro"],
    ["ubuntu", "Ubuntu", "无衬线", "Ubuntu"],
    ["liberation-sans", "Liberation Sans", "无衬线", "Liberation Sans"],
    ["dejavu-sans", "DejaVu Sans", "无衬线", "DejaVu Sans"],
    ["serif", "Serif / 通用衬线", "衬线"],
    ["georgia", "Georgia", "衬线", "Georgia"],
    ["times-new-roman", "Times New Roman", "衬线", "Times New Roman"],
    ["cambria", "Cambria", "衬线", "Cambria"],
    ["palatino", "Palatino", "衬线", "Palatino", "Palatino Linotype"],
    ["book-antiqua", "Book Antiqua", "衬线", "Book Antiqua"],
    ["baskerville", "Baskerville", "衬线", "Baskerville"],
    ["charter", "Charter", "衬线", "Charter", "Bitstream Charter"],
    ["noto-serif", "Noto Serif", "衬线", "Noto Serif"],
    ["source-serif", "Source Serif 4", "衬线", "Source Serif 4", "Source Serif Pro"],
    ["merriweather", "Merriweather", "衬线", "Merriweather"],
    ["liberation-serif", "Liberation Serif", "衬线", "Liberation Serif"],
    ["dejavu-serif", "DejaVu Serif", "衬线", "DejaVu Serif"],
    ["mono", "Monospace / 通用等宽", "等宽"],
    ["jetbrains-mono", "JetBrains Mono", "等宽", "JetBrains Mono"],
    ["cascadia-code", "Cascadia Code", "等宽", "Cascadia Code"],
    ["consolas", "Consolas", "等宽", "Consolas"],
    ["menlo", "Menlo", "等宽", "Menlo"],
    ["monaco", "Monaco", "等宽", "Monaco"],
    ["courier-new", "Courier New", "等宽", "Courier New"],
    ["fira-code", "Fira Code", "等宽", "Fira Code"],
    ["source-code-pro", "Source Code Pro", "等宽", "Source Code Pro"],
    ["ibm-plex-mono", "IBM Plex Mono", "等宽", "IBM Plex Mono"],
    ["liberation-mono", "Liberation Mono", "等宽", "Liberation Mono"],
    ["dejavu-sans-mono", "DejaVu Sans Mono", "等宽", "DejaVu Sans Mono"],
  ],
  englishFallbacks,
)
const chineseFonts = Object.fromEntries(CHINESE_FONTS.map((font) => [font.id, font]))
const englishFonts = Object.fromEntries(ENGLISH_FONTS.map((font) => [font.id, font]))
const legacyFonts = {
  sans: { chineseFont: "sans", englishFont: "system" },
  serif: { chineseFont: "serif", englishFont: "serif" },
  system: { chineseFont: "sans", englishFont: "system" },
}
const familyList = (families) => families.map((family) => JSON.stringify(family)).join(", ")
export function siteDesign(settings) {
  const colors = ACCENT_COLORS[settings.accent] || ACCENT_COLORS.blue
  const palette = getSitePalette(settings.design?.palette)
  const design = {
    ...DEFAULT_DESIGN,
    accentColor: palette?.light.accent || colors[0],
    darkAccentColor: palette?.dark.accent || colors[1],
    ...settings.design,
  }
  const legacy = Object.hasOwn(legacyFonts, design.font)
    ? legacyFonts[design.font]
    : legacyFonts.sans
  for (const key of ["chineseFont", "englishFont"])
    if (settings.design?.[key] === undefined) design[key] = legacy[key]
  return design
}
export function sitePages(settings) {
  return { ...DEFAULT_PAGES, ...settings.pages }
}
export function applySitePalette(settings, paletteId) {
  const palette = getSitePalette(paletteId)
  if (paletteId !== "current" && !palette) throw new Error("配色方案不正确。")
  const result = normalizeSite(settings)
  const colors = ACCENT_COLORS[result.accent] || ACCENT_COLORS.blue
  result.design.palette = paletteId
  result.design.accentColor = palette?.light.accent || colors[0]
  result.design.darkAccentColor = palette?.dark.accent || colors[1]
  return result
}
export function normalizeSite(settings) {
  const result = structuredClone(settings)
  result.design = siteDesign(settings)
  result.pages = sitePages(settings)
  result.home.activityPinned ??= true
  for (const [id, title] of [
    ["featured", "试试手气"],
    ["recent", "最近文章"],
  ])
    if (!result.home.sections.some((section) => section.id === id))
      result.home.sections.push({ id, title, enabled: false })
  result.home.sections = orderedSections(result)
  return result
}
export function sectionLimit(section) {
  return section?.id === "memories" ? 4 : (section?.limit ?? (section?.id === "featured" ? 3 : 6))
}
export function orderedSections(settings) {
  // Older published settings and local layout drafts keep their other choices.
  // Tags become a memory preview in the same slot; collection routes still exist.
  const hasMemories = settings.home.sections.some((section) => section.id === "memories")
  const sections = settings.home.sections.flatMap((section) => {
    if (section.id === "collections") return []
    if (section.id === "tags")
      return hasMemories
        ? []
        : [{ id: "memories", title: "记忆卡", enabled: section.enabled, limit: 4 }]
    return [{ ...section }]
  })
  if (!sections.some((section) => section.id === "memories")) {
    const activityIndex = sections.findIndex((section) => section.id === "activity")
    sections.splice(activityIndex < 0 ? sections.length : activityIndex, 0, {
      id: "memories",
      title: "记忆卡",
      enabled: true,
      limit: 4,
    })
  }
  return settings.home.activityPinned !== false
    ? sections.sort((a, b) => Number(a.id === "activity") - Number(b.id === "activity"))
    : sections
}
export function applyHomeTemplate(settings, template) {
  const result = normalizeSite(settings)
  result.pages.homeTemplate = template
  const orders = {
    classic: ["featured", "recent", "topics", "memories", "activity"],
    articles: ["featured", "recent", "memories", "topics", "activity"],
    knowledge: ["topics", "memories", "featured", "recent", "activity"],
  }
  if (!orders[template]) throw new Error("首页模板不正确。")
  result.home.sections.sort(
    (a, b) => orders[template].indexOf(a.id) - orders[template].indexOf(b.id),
  )
  result.home.layout = template === "knowledge" ? "split" : "single"
  if (template === "knowledge")
    for (const section of result.home.sections)
      if (["topics", "memories"].includes(section.id)) section.enabled = true
  return result
}
export function designVariables(settings) {
  const d = siteDesign(settings)
  const palette = getSitePalette(d.palette)
  const lightMark = brandMarkColors(palette?.light, d.accentColor)
  const darkMark = brandMarkColors(palette?.dark, d.darkAccentColor)
  const chinese = Object.hasOwn(chineseFonts, d.chineseFont)
    ? chineseFonts[d.chineseFont]
    : chineseFonts.sans
  const english = Object.hasOwn(englishFonts, d.englishFont)
    ? englishFonts[d.englishFont]
    : englishFonts.system
  // Generic/system-ui families would resolve CJK glyphs before the chosen
  // Chinese family. Keep explicit Latin families first and the generic last.
  const families = [...new Set([...english.families, ...chinese.families])]
  return {
    ...paletteVariables(d),
    "--site-accent-light": d.accentColor,
    "--site-accent-dark": d.darkAccentColor,
    "--site-brand-fill-light": lightMark.background,
    "--site-brand-ink-light": lightMark.foreground,
    "--site-brand-fill-dark": darkMark.background,
    "--site-brand-ink-dark": darkMark.foreground,
    "--site-font": `${familyList(families)}, ${chinese.generic}`,
    "--site-font-chinese": `${familyList(chinese.families)}, ${chinese.generic}`,
    "--site-font-english": `${familyList(english.families)}, ${english.generic}`,
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
export function applyDesignVariables(target, settings) {
  const palette = siteDesign(settings).palette
  // Switching away from multicolor must remove its category colors, rather
  // than leave old inline variables behind in a live preview or workspace.
  for (const property of Array.from(target.style))
    if (property.startsWith("--site-palette-")) target.style.removeProperty(property)
  for (const [key, value] of Object.entries(designVariables(settings)))
    target.style.setProperty(key, value)
  target.setAttribute("data-site-palette", getSitePalette(palette) ? palette : "current")
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
    (d.palette !== "current" && !getSitePalette(d.palette)) ||
    !Object.hasOwn(legacyFonts, d.font) ||
    !Object.hasOwn(chineseFonts, d.chineseFont) ||
    !Object.hasOwn(englishFonts, d.englishFont) ||
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
      ((section.id === "memories" && section.limit !== 4) ||
        (section.id !== "memories" &&
          (!["featured", "recent"].includes(section.id) ||
            !number(section.limit, 1, section.id === "featured" ? 6 : 20, true))))
    )
      throw new Error("文章展示数量不正确。")
}
