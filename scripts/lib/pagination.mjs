const positiveInteger = (value, fallback = 1) =>
  Number.isSafeInteger(value) && value > 0 ? value : fallback
const mountedPaginations = new WeakMap()

export function paginationNumbers(requestedPage, requestedPages) {
  const pages = positiveInteger(requestedPages)
  const page = Math.min(pages, positiveInteger(requestedPage))
  const numbers = [...new Set([1, pages, page - 1, page, page + 1])]
    .filter((value) => value > 0 && value <= pages)
    .sort((a, b) => a - b)
  const result = []
  for (const number of numbers) {
    if (result.length && number - result[result.length - 1] > 1) result.push(null)
    result.push(number)
  }
  return result
}

export function paginationTarget(value, pages) {
  if (!/^-?\d+$/.test(String(value).trim())) return null
  const number = Number(value)
  if (!Number.isSafeInteger(number)) return null
  return Math.max(1, Math.min(positiveInteger(pages), number))
}

// Runtime lists use the same controls and data attributes as the server-rendered
// Pagination component. Build nodes directly so labels cannot become markup.
export function createPagination({ prefix, label, document: ownerDocument = document }) {
  const node = (tag, className, text) => {
    const element = ownerDocument.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }
  const nav = node("nav", "pagination site-pagination")
  nav.id = `${prefix}-pagination`
  nav.setAttribute("aria-label", label)
  const main = node("div", "pagination-main")
  for (const [action, text] of [
    ["previous", "上一页"],
    ["next", "下一页"],
  ]) {
    const control = node("button", "", text)
    control.type = "button"
    control.id = `${prefix}-${action}`
    control.dataset.paginationAction = action
    main.append(control)
  }
  const pages = node("span", "pagination-pages")
  pages.id = `${prefix}-pages`
  pages.dataset.paginationPages = ""
  main.insertBefore(pages, main.lastChild)
  const status = node("span", "pagination-state")
  status.id = `${prefix}-page-state`
  status.dataset.paginationState = ""
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  status.setAttribute("aria-atomic", "true")
  const form = node("form", "pagination-jump")
  form.dataset.paginationJump = ""
  form.noValidate = true
  const jumpLabel = node("label", "", "跳至")
  jumpLabel.htmlFor = `${prefix}-page-input`
  const input = node("input")
  input.id = jumpLabel.htmlFor
  input.dataset.paginationInput = ""
  input.type = "number"
  input.inputMode = "numeric"
  input.min = "1"
  input.max = "1"
  input.step = "1"
  input.value = "1"
  input.autocomplete = "off"
  input.setAttribute("aria-label", "跳转页码")
  const submit = node("button", "", "跳转")
  submit.type = "submit"
  submit.title = "跳转到输入的页码"
  form.append(jumpLabel, input, node("span", "", "页"), submit)
  nav.append(main, status, form)
  return nav
}

export function mountPagination(nav, { onPageChange }) {
  mountedPaginations.get(nav)?.destroy()
  const get = (selector) => nav.querySelector(selector)
  const numbers = get("[data-pagination-pages]")
  const status = get("[data-pagination-state]")
  const previous = get('[data-pagination-action="previous"]')
  const next = get('[data-pagination-action="next"]')
  const form = get("[data-pagination-jump]")
  const input = get("[data-pagination-input]")
  let state = { page: 1, pages: 1, hidden: false, busy: false },
    signature = "",
    composing = false
  const go = (page) => {
    if (page === null || page === state.page) return
    onPageChange(page)
  }
  const click = (event) => {
    const button = event.target.closest?.("button")
    if (!button || !nav.contains(button) || button.disabled) return
    const action = button.dataset.paginationAction
    if (!action && !button.hasAttribute("data-page")) return
    event.preventDefault()
    go(
      paginationTarget(
        action === "previous"
          ? state.page - 1
          : action === "next"
            ? state.page + 1
            : button.dataset.page,
        state.pages,
      ),
    )
  }
  const submit = (event) => {
    event.preventDefault()
    if (composing) return
    const page = paginationTarget(input.value, state.pages)
    input.setCustomValidity(page === null ? "请输入整数页码。" : "")
    if (page === null) {
      input.reportValidity()
      input.focus()
      return
    }
    input.value = String(page)
    go(page)
  }
  const clearValidity = () => input.setCustomValidity("")
  const startComposition = () => {
    composing = true
  }
  const endComposition = () => {
    composing = false
  }
  nav.addEventListener("click", click)
  form.addEventListener("submit", submit)
  input.addEventListener("input", clearValidity)
  input.addEventListener("compositionstart", startComposition)
  input.addEventListener("compositionend", endComposition)
  const controller = {
    update(values) {
      const oldPage = state.page,
        oldPages = state.pages
      state = { ...state, ...values }
      state.pages = positiveInteger(state.pages)
      state.page = Math.min(state.pages, positiveInteger(state.page))
      nav.hidden = state.hidden
      nav.setAttribute("aria-busy", String(!!state.busy))
      previous.disabled = state.page === 1
      next.disabled = state.page === state.pages
      status.textContent = `${state.page} / ${state.pages}`
      input.max = String(state.pages)
      if (
        oldPage !== state.page ||
        oldPages !== state.pages ||
        nav.ownerDocument.activeElement !== input
      )
        input.value = String(state.page)
      const current = `${state.page}:${state.pages}`
      if (signature === current) return
      signature = current
      const children = paginationNumbers(state.page, state.pages).map((number) => {
        const node = nav.ownerDocument.createElement(number === null ? "span" : "button")
        if (number === null) {
          node.className = "pagination-gap"
          node.textContent = "…"
          node.setAttribute("aria-hidden", "true")
        } else {
          node.type = "button"
          node.dataset.page = String(number)
          node.textContent = String(number)
          node.setAttribute("aria-label", `第 ${number} 页`)
          if (number === state.page) node.setAttribute("aria-current", "page")
        }
        return node
      })
      numbers.replaceChildren(...children)
    },
    destroy() {
      nav.removeEventListener("click", click)
      form.removeEventListener("submit", submit)
      input.removeEventListener("input", clearValidity)
      input.removeEventListener("compositionstart", startComposition)
      input.removeEventListener("compositionend", endComposition)
      if (mountedPaginations.get(nav) === controller) mountedPaginations.delete(nav)
    },
  }
  mountedPaginations.set(nav, controller)
  return controller
}
