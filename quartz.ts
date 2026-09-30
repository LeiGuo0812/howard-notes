import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { frameRegistry } from "./quartz/components/frames/registry"
import { BlogFrame, BlogNav, BlogHome, BlogFooter } from "./quartz/components/Blog"
import { PageTypeDispatcher } from "./quartz/plugins/pageTypes/dispatcher"
import siteSettings from "./library/site.json"

frameRegistry.register("blog", BlogFrame, "howard-notes")
const config = await loadQuartzConfig()
config.configuration.pageTitle = `${siteSettings.brand.name} ${siteSettings.brand.subtitle}`.trim()
config.configuration.pageTitleSuffix = ` | ${siteSettings.brand.name}`
export default config
export const layout = await loadQuartzLayout()
for (const section of [layout.defaults, ...Object.values(layout.byPageType)]) {
  section.header = [BlogNav, ...(section.header ?? [])]
  section.beforeBody = [BlogHome, ...(section.beforeBody ?? [])]
  section.footer = [BlogFooter]
}
// The loader constructs its dispatcher before this project's TS layout overrides.
// Replace that dispatcher so both rendering and resource collection use this layout.
config.plugins.emitters = config.plugins.emitters.filter(
  (plugin) => plugin.name !== "PageTypeDispatcher",
)
config.plugins.emitters.push(PageTypeDispatcher(layout))
