import { brandMarkColors } from "./site-brand-colors.mjs"

// Paired color presets approved in the theme preview. Only semantic colors are
// included here; glass, shadows, geometry and motion keep their existing rules.
const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const SITE_PALETTES = freeze([
  {
    id: "modern-professional",
    name: "现代专业",
    light: {
      label: "白黑 · 商务蓝 · 明黄",
      page: "#f3f5f8",
      surface: "#fafcff",
      reader: "#fafbfc",
      text: "#18202b",
      muted: "#566273",
      accent: "#234f82",
      signal: "#245887",
      onSignal: "#ffffff",
      mark: "#e3bd4a",
      display: "#18202b",
      code: "#e5ebf2",
    },
    dark: {
      label: "石墨 · 冰蓝 · 明黄",
      page: "#141b25",
      surface: "#202b39",
      reader: "#323b48",
      text: "#f0f4fa",
      muted: "#b5c2d2",
      accent: "#a5c9f4",
      signal: "#e2c569",
      onSignal: "#25251d",
      mark: "#e2c569",
      display: "#f0f4fa",
      code: "#252f3e",
    },
  },
  {
    id: "lively-reliable",
    name: "活力可靠",
    light: {
      label: "冷蓝 · 赤陶橙",
      page: "#eaf0f6",
      surface: "#f5f9fd",
      reader: "#faf9f6",
      text: "#1f3044",
      muted: "#586577",
      accent: "#9a481e",
      signal: "#b84f21",
      onSignal: "#ffffff",
      code: "#e1e8f0",
    },
    dark: {
      label: "深蓝 · 杏橙",
      page: "#132236",
      surface: "#21344d",
      reader: "#344154",
      text: "#f2f4f8",
      muted: "#c0cad8",
      accent: "#ffb78e",
      signal: "#f19b66",
      onSignal: "#222839",
      code: "#26364b",
    },
  },
  {
    id: "minimal-soft",
    name: "极简柔和",
    light: {
      label: "暖米 · 浅灰白 · 柔橙",
      page: "#f9f2e7",
      surface: "#f7f8f8",
      reader: "#f7f8f8",
      text: "#34302e",
      muted: "#6f6560",
      accent: "#875035",
      signal: "#e99f72",
      onSignal: "#342820",
      display: "#34302e",
      code: "#eae7e2",
    },
    dark: {
      label: "暖炭灰 · 柔橙",
      page: "#282421",
      surface: "#39312c",
      reader: "#45403b",
      text: "#f7f2ea",
      muted: "#c9bbad",
      accent: "#f3bf9f",
      signal: "#e99f72",
      onSignal: "#342820",
      display: "#f7f2ea",
      code: "#2e2a26",
    },
  },
  {
    id: "clean-multicolor",
    name: "简洁多彩",
    light: {
      label: "冰白底色 · 独立粉彩",
      page: "#f5fafe",
      surface: "#fcfdff",
      reader: "#f7fafc",
      text: "#293646",
      muted: "#526273",
      accent: "#415a7b",
      signal: "#cbe2f8",
      onSignal: "#273744",
      display: "#293646",
      code: "#eaf1f6",
    },
    dark: {
      label: "蓝炭灰 · 独立粉彩",
      page: "#20262f",
      surface: "#2c3440",
      reader: "#39424f",
      text: "#eef5fb",
      muted: "#becada",
      accent: "#cbe2f8",
      signal: "#cbe2f8",
      onSignal: "#273744",
      display: "#eef5fb",
      code: "#2b333f",
    },
    categories: {
      light: [
        { fg: "#284f73", bg: "#cbe2f8" },
        { fg: "#654176", bg: "#f0d9f8" },
        { fg: "#225f54", bg: "#c4f2e8" },
        { fg: "#765b26", bg: "#fcefd4" },
        { fg: "#884653", bg: "#ffdce1" },
        { fg: "#485778", bg: "#e5e9f5" },
        { fg: "#55623a", bg: "#e8eddc" },
      ],
      dark: [
        { fg: "#cbe2f8", bg: "#2d4358" },
        { fg: "#f0d9f8", bg: "#493650" },
        { fg: "#c4f2e8", bg: "#284b44" },
        { fg: "#fcefd4", bg: "#514631" },
        { fg: "#ffdce1", bg: "#543941" },
        { fg: "#e5e9f5", bg: "#383e53" },
        { fg: "#e8eddc", bg: "#424939" },
      ],
    },
  },
  {
    id: "friendly-comfort",
    name: "亲和舒适",
    light: {
      label: "雾绿 · 奶油白 · 翡翠绿",
      page: "#dde9e3",
      surface: "#fefaf4",
      reader: "#fefaf4",
      text: "#212529",
      muted: "#58655e",
      accent: "#006c5a",
      signal: "#03856f",
      onSignal: "#ffffff",
      display: "#212529",
      code: "#e9eee8",
    },
    dark: {
      label: "深松绿 · 奶油白",
      page: "#1c2724",
      surface: "#283a34",
      reader: "#35463f",
      text: "#fefaf4",
      muted: "#bdcdc4",
      accent: "#8cd2bb",
      signal: "#03856f",
      onSignal: "#ffffff",
      display: "#fefaf4",
      code: "#29372f",
    },
  },
  {
    id: "fresh-minimal",
    name: "清新简约",
    light: {
      label: "亚麻米 · 墨黑 · 灰青",
      page: "#efeae1",
      surface: "#f6f2eb",
      reader: "#f6f2eb",
      text: "#1c1b19",
      muted: "#665f54",
      accent: "#536361",
      signal: "#b0bcbb",
      onSignal: "#1c1b19",
      mark: "#b9b2a1",
      line: "#b9b2a1",
      display: "#1c1b19",
      code: "#e3ded4",
    },
    dark: {
      label: "墨黑 · 亚麻米 · 灰青",
      page: "#1c1b19",
      surface: "#2c2b27",
      reader: "#3d3b35",
      text: "#efeae1",
      muted: "#c4bdaa",
      accent: "#b0bcbb",
      signal: "#b0bcbb",
      onSignal: "#1c1b19",
      mark: "#b9b2a1",
      display: "#efeae1",
      code: "#292824",
    },
  },
])

const paletteIds = new Map(SITE_PALETTES.map((palette) => [palette.id, palette]))
const roles = Object.freeze({
  page: "page",
  surface: "surface",
  reader: "reader",
  text: "text",
  muted: "muted",
  accent: "accent",
  signal: "signal",
  onSignal: "on-signal",
  code: "code",
  mark: "mark",
  line: "line",
  display: "display",
})

// "current" deliberately has no preset: older settings continue using the
// site's existing colors. Unknown values cannot inject names or CSS values.
export function getSitePalette(selection) {
  const id =
    typeof selection === "string" ? selection : (selection?.design?.palette ?? selection?.palette)
  return typeof id === "string" ? paletteIds.get(id) : undefined
}

export function paletteVariables(selection) {
  const palette = getSitePalette(selection)
  if (!palette) return {}
  const variables = {}
  for (const mode of ["light", "dark"]) {
    for (const [key, role] of Object.entries(roles)) {
      const value = palette[mode][key]
      if (value) variables[`--site-palette-${role}-${mode}`] = value
    }
    const mark = brandMarkColors(palette[mode])
    variables[`--site-palette-mark-${mode}`] = mark.background
    variables[`--site-palette-mark-ink-${mode}`] = mark.foreground
    for (const [index, colors] of (palette.categories?.[mode] ?? []).entries()) {
      variables[`--site-palette-category-${index + 1}-bg-${mode}`] = colors.bg
      variables[`--site-palette-category-${index + 1}-fg-${mode}`] = colors.fg
    }
  }
  return variables
}

// Topic identity, rather than its position in a list, determines the color.
// Adding topics, shuffling recommendations and navigating cannot change it.
export function paletteCategory(category) {
  const identity = typeof category === "string" ? category.normalize("NFKC").trim() : ""
  let hash = 2166136261
  for (const character of identity)
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0
  return String((hash % 7) + 1)
}
