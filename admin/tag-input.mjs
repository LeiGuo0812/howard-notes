const MAX_TAGS = 200
const MAX_TAG_LENGTH = 160

export function normalizeMemoryTag(value) {
  const tag = String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .trim()
  if (tag.length > MAX_TAG_LENGTH || /[\u0000-\u001f]/.test(tag))
    throw new Error("标签最多 160 个字符，不能包含换行或控制字符。")
  return tag
}

export function normalizeMemoryTags(values) {
  const tags = [...new Set(values.map(normalizeMemoryTag).filter(Boolean))]
  if (tags.length > MAX_TAGS) throw new Error("最多添加 200 个标签。")
  return tags
}

export function isTagCommitKey(event, composing = false, compositionJustEnded = false) {
  return (
    event.key === "Enter" &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !composing &&
    !compositionJustEnded
  )
}

// Article fields keep their original comma-separated format. Only the segment
// at the caret is replaced when the author explicitly chooses a suggestion.
export function articleTagSegment(value, caret = String(value).length) {
  const text = String(value ?? "")
  const position = Math.max(0, Math.min(text.length, Number(caret) || 0))
  let start = position,
    end = position
  while (start > 0 && !/[,，]/.test(text[start - 1])) start--
  while (end < text.length && !/[,，]/.test(text[end])) end++
  return {
    query: text.slice(start, end).trim(),
    start,
    end,
    selected: [...text.slice(0, start).split(/[,，]/), ...text.slice(end).split(/[,，]/)]
      .map((tag) => tag.trim())
      .filter(Boolean),
  }
}

export function replaceArticleTag(value, caret, tag) {
  const text = String(value ?? "")
  const segment = articleTagSegment(text, caret)
  const leadingSpace = text.slice(segment.start, segment.end).match(/^\s*/)?.[0] || ""
  const inserted = leadingSpace + String(tag)
  return {
    value: text.slice(0, segment.start) + inserted + text.slice(segment.end),
    caret: segment.start + inserted.length,
  }
}

export function matchTagSuggestions(values, query, { selected = [], limit = 8 } = {}) {
  const needle = String(query ?? "")
    .trim()
    .toLocaleLowerCase()
  if (!needle) return []
  const excluded = new Set(selected.map((tag) => String(tag).trim()))
  const seen = new Set()
  const prefix = [],
    contains = []
  const count = Math.max(1, Math.min(12, Math.floor(Number(limit) || 8)))
  for (const value of values || []) {
    if (typeof value !== "string") continue
    const tag = value.trim()
    if (!tag || seen.has(tag) || excluded.has(tag) || /[\u0000-\u001f]/.test(tag)) continue
    seen.add(tag)
    const search = tag.toLocaleLowerCase()
    if (search.startsWith(needle)) {
      if (prefix.length < count) prefix.push(tag)
    } else if (search.includes(needle) && contains.length < count) contains.push(tag)
  }
  return [...prefix, ...contains].slice(0, count)
}

let suggestionSequence = 0

// The caller supplies already-verified metadata. There are no network requests
// or persistent candidate caches here; each editor owns and destroys its DOM.
export function createTagSuggestions(
  input,
  {
    container = input.parentElement,
    getSuggestions = () => [],
    getSelected = () => [],
    multiple = false,
    preventSubmit = false,
    onSelect,
  } = {},
) {
  const document = input.ownerDocument
  const list = document.createElement("div")
  list.className = "tag-suggestions"
  list.id = `tag-suggestions-${++suggestionSequence}`
  list.hidden = true
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "已有标签")
  container.append(list)
  const attributes = [
    "role",
    "aria-autocomplete",
    "aria-controls",
    "aria-expanded",
    "aria-activedescendant",
    "autocomplete",
  ]
  const original = new Map(attributes.map((name) => [name, input.getAttribute(name)]))
  input.setAttribute("role", "combobox")
  input.setAttribute("aria-autocomplete", "list")
  input.setAttribute("aria-controls", list.id)
  input.setAttribute("aria-expanded", "false")
  input.setAttribute("autocomplete", "off")
  let candidates = [],
    active = -1,
    composing = false,
    compositionEndedAt = -Infinity,
    destroyed = false
  const listeners = []
  const on = (element, name, listener) => {
    element.addEventListener(name, listener)
    listeners.push(() => element.removeEventListener(name, listener))
  }
  const hide = () => {
    if (destroyed) return
    candidates = []
    active = -1
    list.hidden = true
    list.replaceChildren()
    input.setAttribute("aria-expanded", "false")
    input.removeAttribute("aria-activedescendant")
  }
  const selectActive = (index) => {
    active = index
    for (let i = 0; i < list.children.length; i++)
      list.children[i].setAttribute("aria-selected", String(i === active))
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `${list.id}-${active}`)
      list.children[active]?.scrollIntoView({ block: "nearest" })
    } else input.removeAttribute("aria-activedescendant")
  }
  const focused = () => (input.getRootNode()?.activeElement || document.activeElement) === input
  const refresh = () => {
    if (destroyed) return
    if (composing || input.disabled || !focused()) return hide()
    const segment = multiple
      ? articleTagSegment(input.value, input.selectionStart ?? input.value.length)
      : { query: input.value.trim().replace(/^#/, "").trim(), selected: [] }
    candidates = matchTagSuggestions(getSuggestions(), segment.query, {
      selected: [...segment.selected, ...getSelected()],
    })
    active = -1
    input.removeAttribute("aria-activedescendant")
    const fragment = document.createDocumentFragment()
    for (const [index, tag] of candidates.entries()) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "tag-suggestion"
      button.id = `${list.id}-${index}`
      button.dataset.tagSuggestion = String(index)
      button.setAttribute("role", "option")
      button.setAttribute("aria-selected", "false")
      button.tabIndex = -1
      button.textContent = tag
      fragment.append(button)
    }
    list.replaceChildren(fragment)
    list.hidden = candidates.length === 0
    input.setAttribute("aria-expanded", String(!list.hidden))
  }
  const choose = (index) => {
    const tag = candidates[index]
    if (destroyed || !tag || composing || input.disabled) return
    hide()
    if (onSelect) onSelect(tag)
    else {
      const result = multiple
        ? replaceArticleTag(input.value, input.selectionStart ?? input.value.length, tag)
        : { value: tag, caret: tag.length }
      input.value = result.value
      input.setSelectionRange(result.caret, result.caret)
      const Event = document.defaultView.Event
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    // Dispatching input follows existing dirty/recovery handling, but selecting
    // a value must not immediately reopen the same completed query.
    hide()
    input.focus({ preventScroll: true })
  }
  on(input, "input", refresh)
  on(input, "focus", refresh)
  on(input, "click", refresh)
  on(input, "keyup", (event) => {
    if (multiple && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refresh()
  })
  on(input, "blur", hide)
  on(input, "compositionstart", () => {
    composing = true
    hide()
  })
  on(input, "compositionend", () => {
    composing = false
    compositionEndedAt = Date.now()
    refresh()
  })
  on(input, "keydown", (event) => {
    if (event.isComposing || event.keyCode === 229 || composing) return
    if (Date.now() - compositionEndedAt < 40) {
      // Some IMEs emit a normal Enter just after compositionend. Leave the
      // candidate untouched, but do not let that key implicitly submit an
      // article form and publish the draft.
      if (event.key === "Enter" && preventSubmit) event.preventDefault()
      return
    }
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault()
      event.stopPropagation()
      hide()
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      if (list.hidden) refresh()
      if (!candidates.length) return
      event.preventDefault()
      selectActive(
        event.key === "ArrowDown"
          ? (active + 1) % candidates.length
          : active < 0
            ? candidates.length - 1
            : (active - 1 + candidates.length) % candidates.length,
      )
    } else if (event.key === "Enter") {
      if (active >= 0 && !list.hidden) {
        event.preventDefault()
        choose(active)
      } else if (preventSubmit) {
        event.preventDefault()
        hide()
      }
    } else if (event.key === "Tab") hide()
  })
  on(list, "pointerdown", (event) => {
    if (event.target.closest(".tag-suggestion")) event.preventDefault()
  })
  on(list, "click", (event) => {
    const button = event.target.closest("[data-tag-suggestion]")
    if (button && list.contains(button)) choose(Number(button.dataset.tagSuggestion))
  })
  return {
    refresh,
    hide,
    destroy() {
      if (destroyed) return
      hide()
      destroyed = true
      for (const remove of listeners) remove()
      list.remove()
      for (const [name, value] of original)
        if (value === null) input.removeAttribute(name)
        else input.setAttribute(name, value)
    },
  }
}

// A tag is entered as one value. Commas and nested paths in existing tags are
// preserved; only an explicit Enter creates a new chip.
export function createMemoryTagInput(host, { onError = () => {}, getSuggestions = () => [] } = {}) {
  const input = host.querySelector("input")
  const chips = host.querySelector(".memory-editor-tag-chips")
  const document = host.ownerDocument
  let tags = []
  let composing = false
  let compositionEndedAt = -Infinity
  const listeners = []
  const on = (element, name, listener) => {
    element.addEventListener(name, listener)
    listeners.push(() => element.removeEventListener(name, listener))
  }
  const render = () => {
    const fragment = document.createDocumentFragment()
    for (const tag of tags) {
      const chip = document.createElement("span")
      chip.className = "memory-editor-tag-chip"
      const text = document.createElement("span")
      text.textContent = `#${tag}`
      const remove = document.createElement("button")
      remove.type = "button"
      remove.dataset.removeMemoryTag = tag
      remove.textContent = "×"
      remove.title = `移除标签 #${tag}`
      remove.setAttribute("aria-label", remove.title)
      chip.append(text, remove)
      fragment.append(chip)
    }
    chips.replaceChildren(fragment)
  }
  const commit = () => {
    if (composing) {
      input.focus()
      onError("请先确认正在输入的标签。")
      return false
    }
    try {
      const tag = normalizeMemoryTag(input.value)
      const next = tag ? normalizeMemoryTags([...tags, tag]) : tags
      tags = next
      input.value = ""
      input.setCustomValidity("")
      render()
      suggestions.hide()
      host.scrollTop = host.scrollHeight
      return true
    } catch (error) {
      input.setCustomValidity(error.message)
      input.reportValidity()
      input.focus()
      onError(error.message)
      return false
    }
  }
  const suggestions = createTagSuggestions(input, {
    container: host.parentElement,
    getSuggestions,
    getSelected: () => tags,
    onSelect(tag) {
      input.value = tag
      if (commit()) input.dispatchEvent(new document.defaultView.Event("input", { bubbles: true }))
    },
  })
  on(input, "compositionstart", () => {
    composing = true
  })
  on(input, "compositionend", () => {
    composing = false
    compositionEndedAt = Date.now()
  })
  on(input, "input", () => input.setCustomValidity(""))
  on(input, "keydown", (event) => {
    if (
      !event.defaultPrevented &&
      isTagCommitKey(event, composing, Date.now() - compositionEndedAt < 40)
    ) {
      event.preventDefault()
      commit()
    }
  })
  on(chips, "click", (event) => {
    const button = event.target.closest("button[data-remove-memory-tag]")
    if (!button || !chips.contains(button)) return
    tags = tags.filter((tag) => tag !== button.dataset.removeMemoryTag)
    render()
    suggestions.hide()
    host.scrollTop = host.scrollHeight
    input.focus({ preventScroll: true })
  })
  return {
    setTags(values) {
      tags = normalizeMemoryTags(values || [])
      input.value = ""
      input.setCustomValidity("")
      composing = false
      compositionEndedAt = -Infinity
      suggestions.hide()
      render()
    },
    commit,
    getTags() {
      return [...tags]
    },
    refreshSuggestions: suggestions.refresh,
    hideSuggestions: suggestions.hide,
    destroy() {
      suggestions.destroy()
      for (const remove of listeners) remove()
      tags = []
      chips.replaceChildren()
      input.value = ""
    },
  }
}
