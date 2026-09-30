import { validateSite } from "../../../scripts/lib/site-settings.mjs"
import {
  designVariables,
  orderedSections,
  sectionLimit,
  sitePages,
} from "../../../scripts/lib/site-design.mjs"

const enabled =
  window.parent !== window && new URLSearchParams(location.search).get("site-preview") === "1"
let draft: any,
  theme = "light",
  refreshRecommendations = () => {}
const label = (selector: string, value: string) => {
  const el = document.querySelector(selector)
  if (el) el.textContent = value
}

function applyPreview() {
  if (!draft) return
  const surface = document.querySelector<HTMLElement>(".site-surface")
  if (!surface) return
  document.documentElement.setAttribute("saved-theme", theme)
  for (const [key, value] of Object.entries(designVariables(draft)))
    surface.style.setProperty(key, value)
  surface.dataset.articleLayout = sitePages(draft).articleLayout
  label(".brand-mark", draft.brand.mark)
  label(".brand-name", draft.brand.name)
  label(".brand-subtitle", draft.brand.subtitle)
  label(".home-identity", draft.brand.name)
  label(".home-identity-subtitle", draft.brand.subtitle)
  label(".blog-footer > span", draft.footer)
  const nav = document.querySelector(".blog-nav")
  for (const item of draft.navigation) {
    const anchor = nav?.querySelector<HTMLAnchorElement>(`[data-nav-id="${item.id}"]`)
    if (anchor) {
      anchor.hidden = !item.visible
      anchor.textContent = item.label
      nav!.insertBefore(anchor, nav!.querySelector(".blog-admin"))
    }
  }
  const home = document.querySelector<HTMLElement>(".home-workspace")
  if (home) {
    home.className = `home-workspace layout-${draft.home.layout} density-${draft.home.density}`
    home.dataset.homeTemplate = sitePages(draft).homeTemplate
    label(".home-heading h1", draft.home.title)
    const description = home.querySelector<HTMLElement>(".home-description")
    if (description) {
      description.textContent = draft.home.description
      description.hidden = !draft.home.description
    }
    const modules = home.querySelector(".home-modules")!
    for (const section of orderedSections(draft)) {
      const module = modules.querySelector<HTMLElement>(`[data-section-id="${section.id}"]`)
      if (!module) continue
      module.hidden = !section.enabled
      module.querySelector(".module-heading h2")!.textContent = section.title
      modules.append(module)
      if (section.id === "featured") {
        module.querySelector<HTMLElement>("#random-notes")!.dataset.count = String(
          sectionLimit(section),
        )
      }
      if (section.id === "recent") {
        const pool = document.querySelector<HTMLTemplateElement>("#random-note-pool")
        const previews = module.querySelector(".home-note-previews")
        if (pool && previews) {
          const notes = [
            ...pool.content.querySelectorAll<HTMLAnchorElement>(".note-preview"),
          ].slice(0, sectionLimit(section))
          previews.replaceChildren(
            ...notes.map((note) => {
              const card = note.cloneNode(true) as HTMLElement
              card.classList.add("compact-preview")
              card.querySelector("small")?.remove()
              return card
            }),
          )
        }
      }
    }
    const recommendations = home.querySelector<HTMLElement>("#random-notes")
    const poolSize =
      document
        .querySelector<HTMLTemplateElement>("#random-note-pool")
        ?.content.querySelectorAll(".note-preview").length || 0
    if (
      recommendations &&
      recommendations.children.length !== Math.min(Number(recommendations.dataset.count), poolSize)
    )
      refreshRecommendations()
  }
  const directory = document.querySelector<HTMLElement>(".topic-directory")
  const collections = document.querySelector(".module-collections .collection-chips")
  for (const item of draft.collections) {
    const chip = collections?.querySelector<HTMLAnchorElement>(`[data-collection-id="${item.id}"]`)
    if (chip) {
      chip.hidden = !item.enabled
      chip.querySelector("span")!.textContent = item.title
      collections!.append(chip)
    }
  }
  if (directory)
    directory.className = `topic-directory topic-layout-${sitePages(draft).topicLayout}`
  const chips = document.querySelector<HTMLElement>(".module-topics .topic-chips")
  for (const topic of draft.topics) {
    let chip = chips?.querySelector<HTMLAnchorElement>(`[data-topic-id="${topic.id}"]`)
    if (!chip && chips) {
      chip = document.createElement("a")
      chip.className = "internal topic-chip"
      chip.dataset.topicId = topic.id
      // New empty topics have no public route until the layout is published.
      chip.setAttribute("aria-disabled", "true")
      chip.append(document.createElement("span"), document.createElement("small"))
      chip.querySelector("small")!.textContent = "0"
    }
    if (chip && chips) {
      chip.hidden = !topic.visible
      chip.querySelector("span")!.textContent = topic.title
      chips.append(chip)
    }
    let section = directory?.querySelector<HTMLElement>(`[data-topic-id="${topic.id}"]`)
    if (!section && directory) {
      section = document.createElement("section")
      section.className = "topic-section"
      section.dataset.topicId = topic.id
      const heading = document.createElement("div"),
        title = document.createElement("h2"),
        empty = document.createElement("p")
      heading.className = "topic-section-heading"
      title.textContent = topic.title
      heading.append(title)
      empty.className = "empty-list"
      empty.textContent = "暂无文章"
      section.append(heading, empty)
    }
    if (section && directory) {
      section.hidden = !topic.visible
      const heading = section.querySelector("h2 a") || section.querySelector("h2")
      if (heading) heading.textContent = topic.title
      directory.append(section)
      section.querySelectorAll<HTMLElement>(".note-preview").forEach((card, index) => {
        card.hidden = index >= sitePages(draft).topicPreviewCount
      })
    }
  }
  for (const container of [chips, directory])
    if (container)
      for (const child of [...container.children] as HTMLElement[]) {
        if (!draft.topics.some((topic: any) => topic.id === child.dataset.topicId))
          child.hidden = true
      }
  for (const small of document.querySelectorAll<HTMLElement>("[data-category]")) {
    const topic = draft.topics.find((topic: any) => topic.category === small.dataset.category)
    if (topic) small.textContent = topic.title
  }
}
if (enabled)
  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      event.origin !== location.origin ||
      event.data?.type !== "howard-layout-preview"
    )
      return
    try {
      validateSite(event.data.settings)
      draft = event.data.settings
      theme = event.data.theme === "dark" ? "dark" : "light"
      applyPreview()
      window.parent.postMessage({ type: "howard-preview-applied" }, location.origin)
    } catch {
      window.parent.postMessage({ type: "howard-preview-error" }, location.origin)
    }
  })
export function setupLayoutPreview(refresh: () => void) {
  if (!enabled) return
  refreshRecommendations = refresh
  applyPreview()
  window.parent.postMessage({ type: "howard-preview-ready" }, location.origin)
}
