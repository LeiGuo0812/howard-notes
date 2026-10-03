import { validateSite } from "../scripts/lib/site-settings.mjs"

const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]),
  )

// A sample receives public layout fields only. Repository credentials, owner
// catalogues, image destinations and originals have no role in a layout preview.
export function sitePreviewSettings(settings) {
  const value = {
    version: settings?.version,
    brand: pick(settings?.brand, ["name", "mark", "subtitle"]),
    accent: settings?.accent,
    design: pick(settings?.design, [
      "palette",
      "font",
      "chineseFont",
      "englishFont",
      "accentColor",
      "darkAccentColor",
      "fontSize",
      "lineHeight",
      "contentWidth",
      "cardGap",
      "radius",
    ]),
    pages: pick(settings?.pages, [
      "homeTemplate",
      "topicLayout",
      "articleLayout",
      "topicPreviewCount",
    ]),
    home: {
      ...pick(settings?.home, ["title", "description", "layout", "density", "activityPinned"]),
      sections: settings?.home?.sections?.map((section) =>
        pick(section, ["id", "title", "enabled", "limit"]),
      ),
    },
    topics: settings?.topics?.map((topic) => pick(topic, ["id", "title", "category", "visible"])),
    collections: settings?.collections?.map((item) => pick(item, ["id", "title", "enabled"])),
    navigation: settings?.navigation?.map((item) => pick(item, ["id", "label", "visible"])),
    footer: settings?.footer,
    about: { title: settings?.about?.title, body: "" },
  }
  validateSite(value)
  return structuredClone(value)
}
