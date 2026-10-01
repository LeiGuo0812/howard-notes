import { fetchCanonical, registerEscapeHandler } from "./util"

type Entry = { slug: string; title: string; content: string; tags: string[]; searchable: string }
let entries: Entry[] | undefined
let loading: Promise<Entry[]> | undefined
let generation = 0
const previewCache = new Map<string, string>()

async function loadEntries() {
  if (entries) return entries
  if (!loading) {
    const version = generation
    loading = Promise.resolve(fetchData)
      .then((index) => {
        const loaded = Object.entries(index).map(([slug, data]) => ({
          slug,
          title: String(data.title || ""),
          content: String(data.content || ""),
          tags: Array.isArray(data.tags)
            ? data.tags.filter((tag: unknown) => typeof tag === "string")
            : [],
          searchable: `${data.title || ""} ${data.content || ""}`.toLocaleLowerCase(),
        }))
        if (version === generation) entries = loaded
        return loaded
      })
      .finally(() => {
        loading = undefined
      })
  }
  return loading
}

function parseQuery(value: string) {
  const tags: string[] = [],
    words: string[] = []
  for (const part of value.trim().split(/\s+/)) {
    if (part.startsWith("#") && part.length > 1) tags.push(part.slice(1).toLocaleLowerCase())
    else if (part && part !== "#") words.push(part.toLocaleLowerCase())
  }
  return { tags, words }
}

function highlighted(value: string, words: string[]) {
  const fragment = document.createDocumentFragment()
  if (!words.length) {
    fragment.append(value)
    return fragment
  }
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const matcher = new RegExp(pattern, "giu")
  let last = 0,
    match: RegExpExecArray | null
  while ((match = matcher.exec(value))) {
    fragment.append(value.slice(last, match.index))
    const span = document.createElement("span")
    span.className = "highlight"
    span.textContent = match[0]
    fragment.append(span)
    last = match.index + match[0].length
  }
  fragment.append(value.slice(last))
  return fragment
}

function setupSearch() {
  for (const widget of document.querySelectorAll<HTMLElement>(".search")) {
    const container = widget.querySelector<HTMLElement>(".search-container")!
    const button = widget.querySelector<HTMLButtonElement>(".search-button")!
    const input = widget.querySelector<HTMLInputElement>(".search-bar")!
    const layout = widget.querySelector<HTMLElement>(".search-layout")!
    if (!container || !button || !input || !layout) continue
    const results = document.createElement("div")
    results.className = "results-container"
    results.setAttribute("role", "listbox")
    results.setAttribute("aria-label", "搜索结果")
    const preview = document.createElement("div")
    preview.className = "preview-container"
    layout.replaceChildren(results, ...(layout.dataset.preview === "true" ? [preview] : []))
    widget.querySelectorAll(".tag-suggestions,.ghost-text").forEach((node) => node.remove())
    const suggestions = document.createElement("div")
    suggestions.className = "tag-suggestions"
    suggestions.setAttribute("role", "listbox")
    suggestions.hidden = true
    input.after(suggestions)
    let selected = -1,
      tagSelected = -1,
      sequence = 0,
      previewSequence = 0
    let cards: HTMLAnchorElement[] = [],
      offeredTags: string[] = []
    let previewTimer: ReturnType<typeof setTimeout>
    const base = () => document.body.dataset.basepath || ""
    const close = () => {
      container.classList.remove("active")
      button.setAttribute("aria-expanded", "false")
      input.value = ""
      layout.classList.remove("display-results")
      suggestions.hidden = true
      sequence++
      previewSequence++
      clearTimeout(previewTimer)
      button.focus()
    }
    const status = (message: string) => {
      const row = document.createElement("p")
      row.className = "result-card no-match"
      row.textContent = message
      row.setAttribute("role", "status")
      results.replaceChildren(row)
      preview.replaceChildren()
      cards = []
    }
    const showPreview = async (anchor: HTMLAnchorElement) => {
      const version = ++previewSequence
      try {
        let html = previewCache.get(anchor.href)
        if (!html) {
          const response = await fetchCanonical(new URL(anchor.href))
          if (!response.ok) return
          html = await response.text()
          previewCache.set(anchor.href, html)
          while (previewCache.size > 6) previewCache.delete(previewCache.keys().next().value!)
        }
        if (version !== previewSequence || !container.classList.contains("active")) return
        const doc = new DOMParser().parseFromString(html, "text/html")
        const inner = document.createElement("div")
        inner.className = "preview-inner"
        for (const node of doc.querySelectorAll(".popover-hint")) {
          node.querySelectorAll("script").forEach((script) => script.remove())
          for (const element of node.querySelectorAll<HTMLElement>("[href],[src]")) {
            for (const name of ["href", "src"]) {
              const value = element.getAttribute(name)
              if (value && !value.startsWith("#"))
                element.setAttribute(name, new URL(value, anchor.href).href)
            }
          }
          inner.append(node)
        }
        preview.replaceChildren(inner)
      } catch {
        /* Search results remain usable if a preview request fails. */
      }
    }
    const focusCard = (index: number) => {
      selected = Math.max(0, Math.min(index, cards.length - 1))
      cards.forEach((card, position) => card.classList.toggle("focus", position === selected))
      if (!cards[selected]) return
      cards[selected].scrollIntoView({ block: "nearest" })
      clearTimeout(previewTimer)
      if (layout.dataset.preview === "true")
        previewTimer = setTimeout(() => void showPreview(cards[selected]), 150)
    }
    const chooseTag = () => {
      const tag = offeredTags[tagSelected]
      if (!tag) return
      input.value = input.value.replace(/#[^\s]*$/, `#${tag} `)
      suggestions.hidden = true
      void run()
    }
    const run = async () => {
      const version = ++sequence
      const query = input.value
      const { tags, words } = parseQuery(query)
      layout.classList.toggle("display-results", Boolean(tags.length || words.length))
      if (!query.trim()) {
        results.replaceChildren()
        preview.replaceChildren()
        suggestions.hidden = true
        return
      }
      try {
        if (!entries) status("正在加载笔记…")
        const notes = await loadEntries()
        if (version !== sequence) return
        const tagPrefix = query.match(/#([^\s]*)$/)?.[1]
        offeredTags =
          tagPrefix === undefined
            ? []
            : [...new Set(notes.flatMap((note) => note.tags))]
                .filter((tag) => tag.toLocaleLowerCase().startsWith(tagPrefix.toLocaleLowerCase()))
                .sort()
                .slice(0, 10)
        suggestions.replaceChildren(
          ...offeredTags.map((tag, index) => {
            const option = document.createElement("div")
            option.className = `tag-suggestion-item${index === 0 ? " active" : ""}`
            option.setAttribute("role", "option")
            option.dataset.index = String(index)
            option.textContent = `#${tag}`
            return option
          }),
        )
        tagSelected = 0
        suggestions.hidden = !offeredTags.length
        if (!tags.length && !words.length) {
          results.replaceChildren()
          preview.replaceChildren()
          return
        }
        const matches = notes
          .filter(
            (note) =>
              tags.every((tag) =>
                note.tags.some((candidate) => candidate.toLocaleLowerCase() === tag),
              ) && words.every((word) => note.searchable.includes(word)),
          )
          .map((note) => ({
            note,
            score: words.reduce(
              (score, word) => score + (note.title.toLocaleLowerCase().includes(word) ? 8 : 1),
              0,
            ),
          }))
          .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title, "zh-CN"))
          .slice(0, 8)
        if (!matches.length) {
          status("没有找到相关笔记")
          return
        }
        cards = matches.map(({ note }) => {
          const anchor = document.createElement("a")
          anchor.className = "result-card"
          anchor.href = `${base()}/${note.slug.replace(/\/index$/, "/")}`
          anchor.dataset.slug = note.slug
          const heading = document.createElement("h3")
          heading.className = "card-title"
          heading.append(highlighted(note.title, words))
          anchor.append(heading)
          if (note.tags.length) {
            const list = document.createElement("ul")
            list.className = "tags"
            for (const tag of note.tags.slice(0, 5)) {
              const li = document.createElement("li"),
                p = document.createElement("p")
              p.textContent = `#${tag}`
              p.classList.toggle("match-tag", tags.includes(tag.toLocaleLowerCase()))
              li.append(p)
              list.append(li)
            }
            anchor.append(list)
          }
          const paragraph = document.createElement("p")
          paragraph.className = "card-description"
          const position = Math.max(
            0,
            words.length ? note.content.toLocaleLowerCase().indexOf(words[0]) - 35 : 0,
          )
          const snippet = note.content.slice(position, position + 180)
          paragraph.append(
            highlighted(
              `${position ? "…" : ""}${snippet}${position + 180 < note.content.length ? "…" : ""}`,
              words,
            ),
          )
          anchor.append(paragraph)
          return anchor
        })
        results.replaceChildren(...cards)
        focusCard(0)
      } catch {
        if (version === sequence) status("索引暂时无法加载，请重试。")
      }
    }
    const open = (tags = false) => {
      container.classList.add("active")
      button.setAttribute("aria-expanded", "true")
      input.focus()
      if (tags) input.value = "#"
      void run()
    }
    const clickButton = (event: MouseEvent) => {
      event.stopPropagation()
      open()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        if (container.classList.contains("active") && !event.shiftKey) close()
        else open(event.shiftKey)
      }
    }
    const inputKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (!suggestions.hidden && ["ArrowDown", "ArrowUp", "Tab", "Enter"].includes(event.key)) {
        event.preventDefault()
        if (event.key === "Tab" || event.key === "Enter") chooseTag()
        else {
          tagSelected = Math.max(
            0,
            Math.min(offeredTags.length - 1, tagSelected + (event.key === "ArrowDown" ? 1 : -1)),
          )
          suggestions
            .querySelectorAll(".tag-suggestion-item")
            .forEach((item, index) => item.classList.toggle("active", index === tagSelected))
        }
      } else if (["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
        event.preventDefault()
        focusCard(selected + (event.key === "ArrowUp" || event.shiftKey ? -1 : 1))
      } else if (event.key === "Enter" && cards[selected]) {
        event.preventDefault()
        cards[selected].click()
      } else if (event.key === "Escape") close()
    }
    const clickTag = (event: MouseEvent) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")
      if (option) {
        tagSelected = Number(option.dataset.index)
        chooseTag()
      }
    }
    const overResult = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(".result-card")
      const index = anchor ? cards.indexOf(anchor) : -1
      if (index >= 0 && index !== selected) focusCard(index)
    }
    const chooseResult = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      if (!(event.target as HTMLElement).closest("a.result-card")) return
      close()
    }
    const update = () => {
      if (container.classList.contains("active")) void run()
    }
    button.addEventListener("click", clickButton)
    input.addEventListener("input", run)
    input.addEventListener("keydown", inputKey)
    document.addEventListener("keydown", key)
    document.addEventListener("howard:index-invalidated", update)
    suggestions.addEventListener("click", clickTag)
    results.addEventListener("mouseover", overResult)
    results.addEventListener("click", chooseResult)
    registerEscapeHandler(container, close)
    window.addCleanup(() => {
      sequence++
      previewSequence++
      clearTimeout(previewTimer)
      button.removeEventListener("click", clickButton)
      input.removeEventListener("input", run)
      input.removeEventListener("keydown", inputKey)
      document.removeEventListener("keydown", key)
      document.removeEventListener("howard:index-invalidated", update)
      suggestions.removeEventListener("click", clickTag)
      results.removeEventListener("mouseover", overResult)
      results.removeEventListener("click", chooseResult)
    })
  }
}

document.addEventListener("howard:index-invalidated", () => {
  generation++
  entries = undefined
  loading = undefined
  previewCache.clear()
})
document.addEventListener("nav", setupSearch)
document.addEventListener("render", setupSearch)
