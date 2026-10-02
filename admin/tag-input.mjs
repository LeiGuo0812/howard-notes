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

// A tag is entered as one value. Commas and nested paths in existing tags are
// preserved; only an explicit Enter creates a new chip.
export function createMemoryTagInput(host, { onError = () => {} } = {}) {
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
  on(input, "compositionstart", () => {
    composing = true
  })
  on(input, "compositionend", () => {
    composing = false
    compositionEndedAt = Date.now()
  })
  on(input, "input", () => input.setCustomValidity(""))
  on(input, "keydown", (event) => {
    if (isTagCommitKey(event, composing, Date.now() - compositionEndedAt < 40)) {
      event.preventDefault()
      commit()
    }
  })
  on(chips, "click", (event) => {
    const button = event.target.closest("button[data-remove-memory-tag]")
    if (!button || !chips.contains(button)) return
    tags = tags.filter((tag) => tag !== button.dataset.removeMemoryTag)
    render()
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
      render()
    },
    commit,
    getTags() {
      return [...tags]
    },
    destroy() {
      for (const remove of listeners) remove()
      tags = []
      chips.replaceChildren()
      input.value = ""
    },
  }
}
