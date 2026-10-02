import { marked } from "marked"
import DOMPurify from "dompurify"
import { formatSelection } from "./formatting.mjs"
import { createPanelWindow } from "./panel-window.mjs"
import { requestOwnerAccess } from "./owner-access.mjs"
import { createMemoryTagInput } from "./tag-input.mjs"
import { mountPagination } from "../scripts/lib/pagination.mjs"
import { githubMemoryAttachmentUrl } from "../scripts/lib/memory-attachment-storage.mjs"
import { createDurableDraftController } from "./durable-drafts.mjs"
import { memoryRecoveryRecord, validatedMemoryRecovery } from "./memory-recovery.mjs"

const PAGE_SIZE = 20
const validSorts = new Set(["created-desc", "created-asc", "modified-desc", "modified-asc"])
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
const dateLabel = (value) =>
  Number.isFinite(new Date(value).getTime()) ? dateFormat.format(new Date(value)) : "日期未记录"
const visibilityLabel = (value) =>
  ({ PUBLIC: "公开", PRIVATE: "私密", PROTECTED: "未公开" })[value] || value
const safeUrl = (value, base) => {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value, base)
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}
const icon = (path) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const editIcon = icon('<path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5"/>')
const trashIcon = icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>')
const restoreIcon = icon('<path d="M4 10a8 8 0 1 1 0 5M4 4v6h6"/>')

function createElement(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

// Original implementation: no Memos or third-party component source is copied.
export function mountMemories(hub, { siteBase }) {
  const get = (selector) => hub.querySelector(selector)
  const list = get("#memory-cards"),
    timeline = get("#memory-timeline"),
    message = get("#memory-message")
  const search = get("#memory-search"),
    sort = get("#memory-sort"),
    statusControl = get("#memory-status")
  const sidebar = get("#memory-sidebar"),
    tags = get("#memory-tags"),
    timeNavigation = get("#memory-time-navigation")
  const pagination = get("#memory-pagination"),
    count = get("#memory-count"),
    activeFilter = get("#memory-active-filter")
  const query = new URLSearchParams(location.search)
  const recoveryLauncher = createElement("button", "memory-recovery-launch", "恢复稿")
  recoveryLauncher.type = "button"
  recoveryLauncher.dataset.memoryAction = "recoveries"
  recoveryLauncher.title = "查看云端未保存的记忆卡"
  recoveryLauncher.hidden = true
  get(".memory-heading").insertBefore(recoveryLauncher, get(".memory-new"))
  let requestedCard = location.hash.startsWith("#memory-card-") ? location.hash.slice(1) : null
  let state = {
    q: query.get("q") || "",
    tag: query.get("tag") || "",
    page: Number.isSafeInteger(Math.floor(Number(query.get("page"))))
      ? Math.max(1, Math.floor(Number(query.get("page"))) || 1)
      : 1,
    sort: validSorts.has(query.get("sort")) ? query.get("sort") : "created-desc",
    view: query.get("view") === "timeline" ? "timeline" : "cards",
    status: "NORMAL",
  }
  let apiBase,
    owner = false,
    alive = true,
    request = 0,
    pendingFetch,
    searchTimer,
    noticeTimer,
    editor,
    editorWindow,
    forcePublic = false,
    authEpoch = 0
  let cloudController,
    cloudRequest = 0
  const cloudRecords = new Map()
  const records = new Map(),
    listeners = []
  let pageCount = 1
  const pager = mountPagination(pagination, {
    onPageChange(page) {
      state.page = page
      writeUrl()
      void load()
      hub.scrollIntoView({ block: "start" })
    },
  })
  const updatePagination = (busy = false) => {
    pager.update({
      page: state.page,
      pages: pageCount,
      hidden: state.view !== "cards" || pageCount <= 1,
      busy,
    })
  }
  const resourceBlobs = new Map()
  let resourceEpoch = 0
  const releaseResources = () => {
    resourceEpoch++
    resourceObserver?.disconnect()
    for (const resource of resourceBlobs.values())
      void resource.then((url) => URL.revokeObjectURL(url)).catch(() => {})
    resourceBlobs.clear()
  }
  const protectedResource = async (element, newTab) => {
    const source = element.dataset.memoryResource
    if (!source || !owner || !alive) return
    const epoch = resourceEpoch
    try {
      if (!resourceBlobs.has(source))
        resourceBlobs.set(
          source,
          (async () => {
            const access = await requestOwnerAccess()
            const publicOnly = forcePublic || access?.loggedOut
            const response = await fetch(source, {
              credentials: publicOnly ? "omit" : "same-origin",
              cache: "no-store",
              headers:
                !publicOnly && access?.token ? { Authorization: `Bearer ${access.token}` } : {},
            })
            if (!response.ok) throw new Error("附件加载失败，请重新登录后重试。")
            return URL.createObjectURL(await response.blob())
          })(),
        )
      const url = await resourceBlobs.get(source)
      if (epoch !== resourceEpoch || !alive || !owner) {
        newTab?.close()
        return
      }
      if (element.tagName === "IMG") element.src = url
      else {
        element.href = url
        if (newTab) newTab.location.href = url
        else notify("附件已准备好，请点击打开。", "done")
      }
    } catch (error) {
      if (epoch !== resourceEpoch || !alive) return
      resourceBlobs.delete(source)
      if (element.tagName === "IMG") element.alt = "图片加载失败"
      else {
        newTab?.close()
        notify(error.message, "error")
      }
    }
  }
  const resourceObserver =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                resourceObserver.unobserve(entry.target)
                void protectedResource(entry.target)
              }
          },
          { rootMargin: "400px" },
        )
      : null
  const protectResources = (element) => {
    // GitHub Pages cannot send the worker's HttpOnly cookie. Fetch protected
    // files with the same in-memory Bearer used by the existing maintenance UI.
    if (!owner || !apiBase || new URL(apiBase).origin === location.origin) return
    for (const item of element.querySelectorAll("img,a")) {
      const source = item.src || item.href
      if (!source?.startsWith(`${apiBase}/files/`)) continue
      item.dataset.memoryResource = source
      if (item.tagName === "IMG") {
        item.removeAttribute("src")
        if (resourceObserver) resourceObserver.observe(item)
        else void protectedResource(item)
      } else {
        item.href = "#"
        item.addEventListener("click", (event) => {
          if (item.href.startsWith("blob:")) return
          event.preventDefault()
          event.stopPropagation()
          const tab = window.open("about:blank", "_blank")
          if (tab) tab.opener = null
          void protectedResource(item, tab)
        })
      }
    }
  }
  const progress = createElement("aside", "memory-progress")
  progress.hidden = true
  progress.setAttribute("role", "status")
  progress.setAttribute("aria-live", "polite")
  const progressText = createElement("span")
  const progressAction = createElement("button")
  progressAction.type = "button"
  progressAction.hidden = true
  progress.append(progressText, progressAction)
  document.body.append(progress)

  const on = (target, type, callback, options) => {
    target.addEventListener(type, callback, options)
    listeners.push(() => target.removeEventListener(type, callback, options))
  }
  const notify = (text, kind = "working", retry) => {
    clearTimeout(noticeTimer)
    progress.hidden = false
    progress.dataset.state = kind
    progressText.textContent = text
    progressAction.hidden = !retry
    progressAction.textContent = "重试"
    progressAction.onclick = retry || null
    if (kind === "done")
      noticeTimer = setTimeout(() => {
        progress.hidden = true
      }, 5000)
  }
  const writeUrl = () => {
    const url = new URL(location.href)
    for (const key of ["q", "tag", "view", "page", "sort"]) {
      const value = state[key]
      if (
        !value ||
        (key === "view" && value === "cards") ||
        (key === "page" && value === 1) ||
        (key === "sort" && value === "created-desc")
      )
        url.searchParams.delete(key)
      else url.searchParams.set(key, String(value))
    }
    history.replaceState(history.state, "", url)
  }
  const requestJson = async (path, options = {}) => {
    const access = await requestOwnerAccess()
    const publicOnly = forcePublic || access?.loggedOut
    if (options.method === "POST" && (!owner || publicOnly)) throw new Error("请重新登录后操作。")
    const headers = new Headers(options.headers)
    if (!publicOnly && access?.token) headers.set("Authorization", `Bearer ${access.token}`)
    const response = await fetch(`${apiBase}${path}`, {
      cache: "no-store",
      credentials: publicOnly ? "omit" : "same-origin",
      ...options,
      headers,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(
        result.error ||
          result.message ||
          (response.status === 401 ? "请重新登录后操作。" : "操作未完成，请重试。"),
      )
      error.status = response.status
      throw error
    }
    return result
  }
  const privateRequest = async (path, method = "GET", body) => {
    const epoch = authEpoch
    if (!owner || forcePublic || !apiBase) {
      const error = new Error("请重新登录后操作。")
      error.status = 401
      throw error
    }
    const access = await requestOwnerAccess()
    if (!owner || forcePublic || access?.loggedOut || epoch !== authEpoch) {
      const error = new Error("请重新登录后操作。")
      error.status = 401
      throw error
    }
    const encoded = body === undefined ? null : JSON.stringify(body)
    const response = await fetch(`${apiBase.replace(/\/memories$/, "")}/personal/${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      ...(encoded == null
        ? {}
        : { body: encoded, keepalive: new TextEncoder().encode(encoded).length < 60000 }),
      headers: {
        ...(access?.token ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(encoded == null ? {} : { "Content-Type": "application/json" }),
      },
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(result.error || "恢复稿保存未完成，请重试。")
      error.status = response.status
      throw error
    }
    return result
  }
  const draftController = () =>
    (cloudController ||= createDurableDraftController({
      request: privateRequest,
      onState: (value) => {
        if (alive && owner) editor?.recoveryState(value)
      },
    }))
  const updateRecoveryLauncher = () => {
    recoveryLauncher.hidden = !owner || cloudRecords.size === 0
    recoveryLauncher.textContent = `恢复稿 ${cloudRecords.size}`
  }
  const loadCloudRecoveries = async () => {
    if (!owner || !alive) return
    const serial = ++cloudRequest,
      epoch = authEpoch
    try {
      const result = await privateRequest("drafts?all=1")
      if (!alive || !owner || serial !== cloudRequest || epoch !== authEpoch) return
      cloudRecords.clear()
      for (const draft of result.drafts || [])
        if (draft.kind === "memory" || /^(?:new-)?memory-/.test(draft.editorId))
          cloudRecords.set(draft.editorId, draft)
      updateRecoveryLauncher()
    } catch (error) {
      if (alive && owner && serial === cloudRequest && epoch === authEpoch && error.status !== 401)
        recoveryLauncher.title = "恢复稿暂时无法读取，点击重试"
    }
  }
  const updateControls = () => {
    for (const control of hub.querySelectorAll("[data-memory-view]"))
      control.setAttribute("aria-pressed", String(control.dataset.memoryView === state.view))
    get('[data-memory-action="new"]').hidden = !owner
    updateRecoveryLauncher()
    get(".memory-status-controls").hidden = !owner
    list.hidden = state.view !== "cards"
    timeline.hidden = state.view !== "timeline"
    tags.hidden = state.view !== "cards"
    timeNavigation.hidden = state.view !== "timeline"
    const indexToggle = sidebar.querySelector("summary")
    indexToggle.textContent = state.view === "timeline" ? "时间索引" : "标签索引"
    indexToggle.title = state.view === "timeline" ? "按年月跳转" : "按记忆卡标签筛选"
    hub.dataset.memoryView = state.view
    hub.dataset.memoryOwner = String(owner)
    activeFilter.hidden = !state.tag
    activeFilter.replaceChildren()
    if (state.tag) {
      const button = createElement("button", "memory-filter-clear", `#${state.tag} ×`)
      button.type = "button"
      button.dataset.memoryTag = ""
      button.title = "清除标签筛选"
      activeFilter.append(button)
    }
  }
  const renderTags = (values) => {
    const fragment = document.createDocumentFragment()
    const title = createElement("h2", "memory-index-heading", "标签")
    fragment.append(title)
    const all = createElement("button", "memory-tag-item", "全部")
    all.type = "button"
    all.dataset.memoryTag = ""
    all.setAttribute("aria-pressed", String(!state.tag))
    fragment.append(all)
    for (const tag of values || []) {
      const button = createElement("button", "memory-tag-item")
      button.type = "button"
      button.dataset.memoryTag = tag.name
      button.setAttribute("aria-pressed", String(state.tag === tag.name))
      button.append(
        createElement("span", "", `#${tag.name}`),
        createElement("small", "", String(tag.count)),
      )
      fragment.append(button)
    }
    tags.replaceChildren(fragment)
  }
  const chooseTag = (tag) => {
    state.tag = tag
    state.page = 1
    sidebar.open = matchMedia("(min-width: 1001px)").matches
    writeUrl()
    updateControls()
    void load()
  }
  const resourceUrl = (attachment) =>
    safeUrl(
      githubMemoryAttachmentUrl(attachment.storage) ||
        (attachment.fileId
          ? `${apiBase}/files/${encodeURIComponent(attachment.fileId)}`
          : attachment.url),
      attachment.url?.startsWith("/howard-notes/api/content/memories/files/")
        ? new URL(apiBase).origin
        : siteBase,
    )
  const purgePrivateState = () => {
    authEpoch++
    cloudRequest++
    cloudController?.dispose()
    cloudController = null
    cloudRecords.clear()
    updateRecoveryLauncher()
    editor?.destroy()
    editor = null
    editorWindow = null
    releaseResources()
    records.clear()
    list.replaceChildren()
    timeline.replaceChildren()
    tags.replaceChildren()
    timeNavigation.replaceChildren()
    count.textContent = ""
    state.status = "NORMAL"
    statusControl.value = "NORMAL"
    state.tag = ""
    state.q = ""
    state.page = 1
    pageCount = 1
    updatePagination()
    search.value = ""
    activeFilter.replaceChildren()
    activeFilter.hidden = true
    writeUrl()
    clearTimeout(noticeTimer)
    progress.hidden = true
    progressAction.hidden = true
    progressAction.onclick = null
  }
  function renderMarkdown(element, content, attachments = []) {
    element.innerHTML = DOMPurify.sanitize(
      marked.parse(content || "", { gfm: true, breaks: true }),
      {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["style", "iframe", "form", "button", "script"],
        FORBID_ATTR: ["style", "srcset", "id", "name"],
      },
    )
    for (const input of element.querySelectorAll("input")) {
      if (input.type === "checkbox") input.disabled = true
      else input.remove()
    }
    const originalImage = (source) => {
      const safe = safeUrl(source, siteBase)
      let filename, sourcePath
      try {
        sourcePath = new URL(source, siteBase).pathname
        filename = decodeURIComponent(sourcePath.split("/").pop())
      } catch {}
      const exact = attachments.find(
        (item) =>
          item.sourceUrl === source ||
          item.externalLink === source ||
          item.originalUrl === source ||
          (item.sourcePath && item.sourcePath === sourcePath),
      )
      const candidates = filename
        ? attachments.filter((item) => [item.name, item.filename].includes(filename))
        : []
      const match = exact || (candidates.length === 1 ? candidates[0] : null)
      return match ? resourceUrl(match) : safe
    }
    for (const image of element.querySelectorAll("img")) {
      const url = originalImage(image.getAttribute("src"))
      if (!url) image.removeAttribute("src")
      else image.src = url
      image.loading = "lazy"
      image.decoding = "async"
      image.referrerPolicy = "no-referrer"
    }
    for (const link of element.querySelectorAll("a")) {
      const url = originalImage(link.getAttribute("href"))
      if (!url) link.removeAttribute("href")
      else link.href = url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      link.setAttribute("data-router-ignore", "")
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (
        !node.parentElement.closest("a,pre,code,kbd,script,style") &&
        /(^|\s)#[\p{L}\p{N}_]/u.test(node.textContent)
      )
        textNodes.push(node)
    }
    for (const node of textNodes) {
      const expression = /(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/.-]*)/gu
      const fragment = document.createDocumentFragment()
      let previous = 0
      for (const match of node.textContent.matchAll(expression)) {
        fragment.append(
          document.createTextNode(node.textContent.slice(previous, match.index) + match[1]),
        )
        const button = createElement("button", "memory-inline-tag", `#${match[2]}`)
        button.type = "button"
        button.dataset.memoryTag = match[2]
        button.title = `浏览 #${match[2]}`
        fragment.append(button)
        previous = match.index + match[0].length
      }
      fragment.append(document.createTextNode(node.textContent.slice(previous)))
      node.replaceWith(fragment)
    }
  }
  function renderCard(memory) {
    const card = createElement("article", "memory-card")
    card.dataset.memoryId = memory.id
    card.id = `memory-card-${memory.id}`
    const header = createElement("header", "memory-card-heading")
    const time = createElement("time", "", dateLabel(memory.created))
    time.dateTime = memory.created
    time.title = `创建 ${dateLabel(memory.created)} · 更新 ${dateLabel(memory.modified)}`
    header.append(time)
    if (owner) {
      const badge = createElement("span", "memory-visibility", visibilityLabel(memory.visibility))
      badge.dataset.visibility = memory.visibility
      header.append(badge)
      const actions = createElement("div", "memory-card-actions")
      const edit = createElement("button")
      edit.type = "button"
      edit.dataset.memoryAction = memory.status === "TRASH" ? "restore" : "edit"
      edit.dataset.memoryId = memory.id
      edit.title = memory.status === "TRASH" ? "恢复记忆卡" : "编辑记忆卡"
      edit.setAttribute("aria-label", edit.title)
      edit.innerHTML = memory.status === "TRASH" ? restoreIcon : editIcon
      actions.append(edit)
      if (memory.status !== "TRASH") {
        const remove = createElement("button")
        remove.type = "button"
        remove.dataset.memoryAction = "delete"
        remove.dataset.memoryId = memory.id
        remove.title = "移入回收站，保留 30 天"
        remove.setAttribute("aria-label", "删除记忆卡")
        remove.innerHTML = trashIcon
        actions.append(remove)
      }
      header.append(actions)
    }
    const body = createElement("div", "memory-card-body")
    renderMarkdown(body, memory.content, memory.attachments)
    card.append(header, body)
    if (memory.content?.length > 800 || (memory.content?.split("\n").length || 0) > 16) {
      card.classList.add("is-collapsed")
      const expand = createElement("button", "memory-expand", "展开全文")
      expand.type = "button"
      expand.dataset.memoryAction = "expand"
      expand.setAttribute("aria-expanded", "false")
      card.append(expand)
    }
    const usedResources = new Set(
      [...body.querySelectorAll("img,a")].map((item) => item.src || item.href),
    )
    const attachments = createElement("div", "memory-attachments")
    for (const attachment of memory.attachments || []) {
      const url = resourceUrl(attachment)
      if (!url || usedResources.has(url)) continue
      const name = attachment.name || attachment.filename || "附件"
      const link = createElement("a", "memory-attachment")
      link.href = url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      link.setAttribute("data-router-ignore", "")
      if (
        (attachment.mimeType || attachment.type || "").startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(name)
      ) {
        const image = createElement("img")
        image.src = url
        image.alt = name
        image.loading = "lazy"
        image.decoding = "async"
        image.referrerPolicy = "no-referrer"
        link.append(image)
      } else link.textContent = `↗ ${name}`
      attachments.append(link)
    }
    if (attachments.childElementCount) card.append(attachments)
    if (memory.tags?.length) {
      const labels = createElement("footer", "memory-card-tags")
      for (const tag of memory.tags) {
        const button = createElement("button", "memory-tag-chip", `#${tag}`)
        button.type = "button"
        button.dataset.memoryTag = tag
        button.title = `浏览 #${tag}`
        labels.append(button)
      }
      card.append(labels)
    }
    if (memory.status === "TRASH")
      card.append(createElement("small", "memory-trash-label", "回收站 · 删除后保留 30 天"))
    if (memory.pinned) card.dataset.pinned = "true"
    protectResources(card)
    return card
  }
  async function renderTimeline(memories, serial) {
    const groups = new Map()
    const field = state.sort.startsWith("modified") ? "modified" : "created"
    for (const memory of memories) {
      const date = new Date(memory[field])
      const month = Number.isFinite(date.getTime())
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        : "undated"
      if (!groups.has(month)) groups.set(month, [])
      groups.get(month).push(memory)
    }
    const monthKeys = [...groups.keys()].sort((a, b) =>
      a === "undated"
        ? 1
        : b === "undated"
          ? -1
          : state.sort.endsWith("asc")
            ? a.localeCompare(b)
            : b.localeCompare(a),
    )
    const fragment = document.createDocumentFragment(),
      navigation = document.createDocumentFragment()
    navigation.append(createElement("h2", "memory-index-heading", "时间"))
    const yearGroups = new Map()
    let index = 0
    for (const month of monthKeys) {
      const section = createElement("section", "memory-timeline-month")
      section.id = `memory-month-${month}`
      const label =
        month === "undated" ? "日期未记录" : `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`
      section.append(createElement("h2", "memory-month-heading", label))
      const entries = createElement("div", "memory-timeline-entries")
      for (const memory of groups.get(month)) {
        if (index && index % 20 === 0) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
          if (!alive || serial !== request) return
        }
        const entry = createElement("div", `memory-timeline-entry${index++ % 2 ? " is-right" : ""}`)
        entry.append(renderCard(memory))
        entries.append(entry)
      }
      section.append(entries)
      fragment.append(section)
      const year = month === "undated" ? "未记录" : month.slice(0, 4)
      let yearGroup = yearGroups.get(year)
      if (!yearGroup) {
        yearGroup = createElement("div", "memory-nav-year")
        const button = createElement(
          "button",
          "memory-nav-year-heading",
          month === "undated" ? year : `${year} 年`,
        )
        button.type = "button"
        button.dataset.memoryPeriod = month
        yearGroup.append(button)
        yearGroups.set(year, yearGroup)
        navigation.append(yearGroup)
      }
      const button = createElement("button", "memory-month-link")
      button.type = "button"
      button.dataset.memoryPeriod = month
      button.append(
        createElement("span", "", month === "undated" ? label : `${Number(month.slice(5))} 月`),
        createElement("small", "", String(groups.get(month).length)),
      )
      yearGroup.append(button)
    }
    timeline.replaceChildren(fragment)
    timeNavigation.replaceChildren(navigation)
  }
  async function load({ quiet = false } = {}) {
    if (!alive || !apiBase) return
    const serial = ++request
    pendingFetch?.abort()
    pendingFetch = new AbortController()
    updateControls()
    updatePagination(true)
    if (!quiet) {
      message.textContent = "正在加载…"
      message.hidden = false
    }
    const parameters = new URLSearchParams({
      page: String(state.page),
      pageSize: String(PAGE_SIZE),
      sort: state.sort,
      q: state.q,
      tag: state.tag,
      status: state.status,
    })
    if (state.view === "timeline") parameters.set("view", "timeline")
    try {
      const result = await requestJson(`?${parameters}`, { signal: pendingFetch.signal })
      if (!alive || serial !== request) return
      if (owner && result.owner !== true) {
        owner = false
        purgePrivateState()
        updateControls()
        return load()
      }
      owner = result.owner === true
      if (owner) void loadCloudRecoveries()
      if (!owner && state.status !== "NORMAL") {
        state.status = "NORMAL"
        statusControl.value = "NORMAL"
        return load()
      }
      const values = result.memories || []
      pageCount = Math.max(1, Math.ceil((result.total || 0) / PAGE_SIZE))
      if (state.view === "cards" && state.page > 1 && !values.length && result.total > 0) {
        state.page = pageCount
        writeUrl()
        return load()
      }
      if (state.view === "cards" && !result.total && state.page !== 1) {
        state.page = 1
        writeUrl()
      }
      records.clear()
      for (const memory of values) records.set(String(memory.id), memory)
      updateControls()
      // The timeline uses dates; keep the selected tag in its filter chip
      // without rebuilding an invisible tag list on every refresh.
      if (state.view === "cards") renderTags(result.tags)
      else tags.replaceChildren()
      count.textContent = `${result.total || 0} 张`
      updatePagination()
      if (state.view === "timeline") {
        list.replaceChildren()
        await renderTimeline(values, serial)
        if (!alive || serial !== request) return
      } else {
        timeline.replaceChildren()
        timeNavigation.replaceChildren()
        list.replaceChildren(...values.map(renderCard))
        if (requestedCard) {
          let id = requestedCard
          try {
            id = decodeURIComponent(id)
          } catch {
            // A malformed hash cannot select a card.
          }
          const selected = document.getElementById(id)
          if (selected && list.contains(selected)) {
            requestedCard = null
            selected.scrollIntoView({ block: "start" })
          }
        }
      }
      message.hidden = values.length > 0
      message.textContent =
        state.status === "TRASH"
          ? "回收站为空"
          : state.q || state.tag
            ? "没有找到匹配的记忆卡"
            : "暂无记忆卡"
    } catch (error) {
      if (!alive || serial !== request || error.name === "AbortError") return
      message.hidden = false
      message.textContent = error.message
      notify("记忆卡加载未完成。", "error", () => void load())
    } finally {
      if (alive && serial === request) updatePagination()
    }
  }
  const mutate = async (memory, action, body) => {
    const path = memory ? `/${encodeURIComponent(memory.id)}${action ? `/${action}` : ""}` : ""
    return requestJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }
  const act = (memory, action) => {
    if (!owner || !memory) return
    const epoch = authEpoch
    const label = action === "restore" ? "正在恢复记忆卡…" : "正在移入回收站…"
    notify(label)
    void mutate(memory, action, { version: memory.version })
      .then(() => {
        if (!alive || !owner || epoch !== authEpoch) return
        notify(action === "restore" ? "记忆卡已恢复。" : "已移入回收站，保留 30 天。", "done")
        void load({ quiet: true })
      })
      .catch((error) => {
        if (alive && owner && epoch === authEpoch)
          notify(error.message, "error", () => act(memory, action))
      })
  }
  function createEditor() {
    const editorListeners = []
    const on = (target, type, listener) => {
      target.addEventListener(type, listener)
      editorListeners.push(() => target.removeEventListener(type, listener))
    }
    const host = createElement("section", "memory-editor")
    host.hidden = true
    host.setAttribute("role", "dialog")
    host.setAttribute("aria-modal", "false")
    host.setAttribute("aria-labelledby", "memory-editor-heading")
    host.innerHTML = `<header class="memory-editor-heading"><span id="memory-editor-heading" tabindex="0">新建记忆卡</span><div><button type="button" data-editor-window="maximize" title="全屏显示" aria-label="全屏显示">↗</button><button type="button" data-editor-window="close" title="收起窗口" aria-label="收起窗口">${icon('<path d="m5 5 14 14M5 19 19 5"/>')}</button></div></header><div class="memory-editor-toolbar"><button type="button" data-memory-format="bold" title="加粗"><strong>B</strong></button><button type="button" data-memory-format="italic" title="斜体"><i>I</i></button><button type="button" data-memory-format="h2" title="二级标题">H2</button><button type="button" data-memory-format="quote" title="引用">❝</button><button type="button" data-memory-format="unordered" title="列表">☷</button><button type="button" data-memory-format="task" title="任务列表">☑</button><button type="button" data-memory-format="inline-code" title="行内代码">&lt;/&gt;</button><button type="button" data-memory-format="link" title="插入链接">↗</button><div class="memory-editor-views"><button type="button" data-editor-view="edit" aria-pressed="false" title="编辑">编辑</button><button type="button" data-editor-view="split" aria-pressed="true" title="编辑并预览">双栏</button><button type="button" data-editor-view="preview" aria-pressed="false" title="实时预览">预览</button></div></div><div class="memory-editor-content" data-editor-view="split"><label class="sr-only" for="memory-editor-text">记忆卡内容 Markdown</label><textarea id="memory-editor-text" spellcheck="false" placeholder="记下一件事… #标签"></textarea><div class="memory-editor-preview memory-card-body" aria-label="实时预览"></div></div><footer class="memory-editor-footer"><label>可见性 <select id="memory-editor-visibility"><option value="PRIVATE">私密</option><option value="PROTECTED">未公开</option><option value="PUBLIC">公开</option></select></label><div class="memory-editor-tag-label"><label for="memory-editor-tags">标签</label><div class="memory-editor-tag-input" role="group" aria-label="记忆卡标签"><div class="memory-editor-tag-chips"></div><input id="memory-editor-tags" placeholder="输入标签，按回车添加" autocomplete="off" /></div></div><button type="button" class="memory-editor-delete" hidden title="移入回收站，保留 30 天">删除</button><button type="button" class="memory-editor-save">发布</button></footer>`
    const heading = host.querySelector(".memory-editor-heading"),
      caption = host.querySelector("#memory-editor-heading")
    const textarea = host.querySelector("textarea"),
      preview = host.querySelector(".memory-editor-preview")
    const visibility = host.querySelector("#memory-editor-visibility")
    const tagControl = createMemoryTagInput(host.querySelector(".memory-editor-tag-input"), {
      onError: (text) => notify(text, "error"),
    })
    const save = host.querySelector(".memory-editor-save"),
      remove = host.querySelector(".memory-editor-delete")
    const recoveryStatus = createElement("button", "memory-recovery-state", "云恢复稿")
    recoveryStatus.type = "button"
    recoveryStatus.title = "未保存内容自动保存为私密云恢复稿；点击重试或比较"
    heading.insertBefore(recoveryStatus, heading.lastElementChild)
    const recoveryOffer = createElement("button", "memory-recovery-offer", "恢复未保存修改")
    recoveryOffer.type = "button"
    recoveryOffer.hidden = true
    recoveryOffer.title = "恢复这张记忆卡在另一设备未保存的编辑"
    host.querySelector(".memory-editor-toolbar").append(recoveryOffer)
    let current,
      lastAttachments = [],
      lastContent = "",
      locked = false,
      previewFrame,
      draftId,
      newRequestId,
      recoveryTimer,
      recoveryDirty = false,
      availableRecovery,
      editorSerial = 0
    const recoveryRecord = () =>
      memoryRecoveryRecord(
        current,
        {
          content: textarea.value,
          visibility: visibility.value,
          tags: tagControl.getTags(),
          pendingTag: host.querySelector("#memory-editor-tags").value,
        },
        { original: lastContent, newRequestId },
      )
    const saveRecovery = () => {
      clearTimeout(recoveryTimer)
      if (!recoveryDirty || !draftId || !owner || forcePublic) return Promise.resolve(null)
      const id = draftId,
        value = recoveryRecord(),
        epoch = authEpoch
      const stamp = JSON.stringify(value)
      return draftController()
        .save(id, value)
        .then((saved) => {
          if (alive && owner && epoch === authEpoch) {
            cloudRecords.set(id, {
              editorId: id,
              kind: "memory",
              id: value.memoryId,
              title: value.content.replace(/^\uFEFF/, "").slice(0, 30) || "记忆卡恢复稿",
            })
            updateRecoveryLauncher()
            if (draftId === id && JSON.stringify(recoveryRecord()) === stamp) recoveryDirty = false
          }
          return saved
        })
    }
    const dirty = () => {
      if (!draftId || locked) return
      recoveryDirty = true
      recoveryStatus.textContent = "未暂存"
      clearTimeout(recoveryTimer)
      recoveryTimer = setTimeout(() => void saveRecovery().catch(() => {}), 1000)
    }
    const clearRecovery = (id) => {
      if (!id) return
      void draftController()
        .remove(id)
        .then(() => {
          if (!alive || !owner) return
          cloudRecords.delete(id)
          updateRecoveryLauncher()
        })
        .catch(() => {})
    }
    const hide = () => {
      void saveRecovery().catch(() => {})
      editorWindow.detach()
      host.hidden = true
    }
    const renderPreview = () => {
      if (previewFrame) cancelAnimationFrame(previewFrame)
      previewFrame = requestAnimationFrame(() => {
        renderMarkdown(preview, textarea.value, lastAttachments)
        protectResources(preview)
        previewFrame = 0
      })
    }
    const show = (memory, recovery = null, id = null) => {
      if (locked) {
        notify("上一条记忆卡正在保存，可以继续浏览。")
        return
      }
      void saveRecovery().catch(() => {})
      clearTimeout(recoveryTimer)
      const serial = ++editorSerial,
        epoch = authEpoch
      current = memory || null
      draftId = id || (memory ? `memory-${memory.id}` : `new-memory-${crypto.randomUUID()}`)
      newRequestId = recovery?.newRequestId || crypto.randomUUID()
      availableRecovery = null
      recoveryDirty = false
      recoveryOffer.hidden = true
      recoveryStatus.textContent = recovery ? "已恢复云稿" : "云恢复稿"
      lastAttachments = memory?.attachments || []
      lastContent = memory?.content || ""
      caption.textContent = memory ? "编辑记忆卡" : "新建记忆卡"
      textarea.value = lastContent
      visibility.value = memory?.visibility || "PRIVATE"
      tagControl.setTags(memory?.tags || [])
      remove.hidden = !memory
      save.textContent = memory ? "保存" : "发布"
      save.hidden = false
      if (recovery) {
        textarea.value = recovery.content
        visibility.value = recovery.visibility
        tagControl.setTags(recovery.tags)
        host.querySelector("#memory-editor-tags").value = recovery.pendingTag || ""
      }
      host.querySelector('[data-editor-view="edit"]').click()
      if (!matchMedia("(max-width: 800px)").matches)
        host.querySelector('[data-editor-view="split"]').click()
      host.hidden = false
      renderPreview()
      editorWindow.center()
      textarea.focus({ preventScroll: true })
      if (!recovery)
        void draftController()
          .load(draftId)
          .then((draft) => {
            if (!alive || !owner || serial !== editorSerial || epoch !== authEpoch) return
            const found = draft?.status === "ACTIVE" ? validatedMemoryRecovery(draft.record) : null
            if (found) {
              availableRecovery = found
              recoveryOffer.hidden = false
            }
          })
          .catch(() => {})
    }
    const showRecoveries = () => {
      show(null)
      if (previewFrame) cancelAnimationFrame(previewFrame)
      previewFrame = 0
      caption.textContent = "云端恢复稿"
      save.hidden = true
      remove.hidden = true
      host.querySelector('[data-editor-view="preview"]').click()
      preview.replaceChildren()
      for (const draft of cloudRecords.values()) {
        const button = createElement(
          "button",
          "memory-recovery-item",
          draft.title || "记忆卡恢复稿",
        )
        button.type = "button"
        button.dataset.memoryRecoveryId = draft.editorId
        button.title = "恢复未保存内容，原记忆卡保持不变"
        preview.append(button, createElement("br"))
      }
    }
    const submit = () => {
      if (locked) return
      if (!textarea.value.trim()) {
        textarea.focus()
        notify("请输入记忆卡内容。", "error")
        return
      }
      if (!tagControl.commit()) return
      const body = {
        content:
          textarea.value === lastContent.replace(/\r\n?/g, "\n") ? lastContent : textarea.value,
        visibility: visibility.value,
        tags: [
          ...new Set([
            ...tagControl.getTags(),
            ...(() => {
              renderMarkdown(preview, textarea.value, lastAttachments)
              return [...preview.querySelectorAll("[data-memory-tag]")].map(
                (tag) => tag.dataset.memoryTag,
              )
            })(),
          ]),
        ],
        ...(current ? { version: current.version } : { requestId: newRequestId }),
      }
      // Closing and progress are synchronous; the network never blocks dragging,
      // scrolling, navigation or any unrelated control.
      locked = true
      const epoch = authEpoch
      const savedDraftId = draftId
      hide()
      notify(current ? "正在保存记忆卡…" : "正在发布记忆卡…")
      const retry = () => {
        if (!alive || !owner || epoch !== authEpoch) return
        locked = true
        hide()
        notify("正在重试保存记忆卡…")
        void run()
      }
      const run = async () => {
        try {
          const result = await mutate(current, "", body)
          if (!alive || !owner || epoch !== authEpoch) return
          current = result.memory || current
          lastContent = body.content
          recoveryDirty = false
          clearTimeout(recoveryTimer)
          clearRecovery(savedDraftId)
          notify("记忆卡已保存。", "done")
          void load({ quiet: true })
        } catch (error) {
          if (!alive || !owner || epoch !== authEpoch) return
          if (error.status === 409)
            notify("记忆卡已在其他窗口修改。你的文字已保留，重新打开后可合并。", "error", () => {
              if (!alive || !owner || epoch !== authEpoch) return
              void requestJson(`/${encodeURIComponent(current.id)}`)
                .then(({ memory: latest }) => {
                  if (!latest || !alive || !owner || epoch !== authEpoch) return
                  current = latest
                  recoveryDirty = true
                  dirty()
                  const other = createElement("details", "memory-conflict")
                  const summary = createElement(
                    "summary",
                    "",
                    "查看线上最新内容（编辑框仍保留你的修改）",
                  )
                  const source = createElement("pre", "", latest.content)
                  other.append(summary, source)
                  preview.prepend(other)
                  host.hidden = false
                  editorWindow.center()
                  notify("请合并线上内容后再次保存。", "done")
                })
                .catch((readError) => {
                  if (alive && owner && epoch === authEpoch) notify(readError.message, "error")
                })
            })
          else notify(error.message, "error", retry)
        } finally {
          locked = false
        }
      }
      void run()
    }
    on(textarea, "input", () => {
      renderPreview()
      dirty()
    })
    on(visibility, "change", dirty)
    on(host.querySelector(".memory-editor-tag-input"), "input", dirty)
    on(host.querySelector(".memory-editor-tag-input"), "keydown", () => queueMicrotask(dirty))
    on(host.querySelector(".memory-editor-tag-input"), "click", () => queueMicrotask(dirty))
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") void saveRecovery().catch(() => {})
    })
    on(window, "pagehide", () => void saveRecovery().catch(() => {}))
    on(textarea, "keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        submit()
      }
    })
    on(host, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        hide()
      }
    })
    on(host, "click", (event) => {
      const format = event.target.closest("[data-memory-format]")
      if (format) {
        let extra = ""
        if (format.dataset.memoryFormat === "link") {
          extra = window.prompt("链接地址", "https://")
          if (!extra) return
        }
        try {
          const next = formatSelection(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
            format.dataset.memoryFormat,
            extra,
          )
          textarea.value = next.text
          textarea.focus()
          textarea.setSelectionRange(next.start, next.end)
          renderPreview()
          dirty()
        } catch (error) {
          notify(error.message, "error")
        }
      }
      const view = event.target.closest("button[data-editor-view]")
      if (view) {
        host.querySelector(".memory-editor-content").dataset.editorView = view.dataset.editorView
        for (const button of host.querySelectorAll("button[data-editor-view]"))
          button.setAttribute("aria-pressed", String(button === view))
      }
      if (event.target.closest('[data-editor-window="close"]')) hide()
      if (event.target.closest(".memory-recovery-offer") && availableRecovery)
        show(availableRecovery.baseline, availableRecovery, draftId)
      const picked = event.target.closest("[data-memory-recovery-id]")
      if (picked) {
        const epoch = authEpoch,
          serial = editorSerial,
          id = picked.dataset.memoryRecoveryId
        void draftController()
          .load(id)
          .then((draft) => {
            if (!alive || !owner || epoch !== authEpoch || serial !== editorSerial) return
            const recovery =
              draft?.status === "ACTIVE" ? validatedMemoryRecovery(draft.record) : null
            if (recovery) show(recovery.baseline, recovery, id)
          })
          .catch((error) => {
            if (alive && owner && epoch === authEpoch) notify(error.message, "error")
          })
      }
      if (event.target.closest(".memory-recovery-state") && draftId) {
        const id = draftId,
          epoch = authEpoch,
          serial = editorSerial
        void draftController()
          .load(id)
          .then((draft) => {
            if (!alive || !owner || epoch !== authEpoch || serial !== editorSerial) return
            const other = createElement("details", "memory-conflict")
            other.open = true
            other.append(
              createElement("summary", "", "云端恢复稿与当前编辑"),
              createElement("pre", "", draft?.record?.content || "暂无云端恢复稿"),
            )
            const keep = createElement("button", "", "比较后保存当前编辑")
            keep.type = "button"
            on(keep, "click", () => {
              if (!alive || !owner || epoch !== authEpoch || serial !== editorSerial) return
              void draftController()
                .acceptRemoteVersion(id, draft?.version || 0, draft?.status || "ACTIVE")
                .then(() => {
                  recoveryDirty = true
                  return saveRecovery()
                })
                .catch((error) => {
                  if (alive && owner && epoch === authEpoch) notify(error.message, "error")
                })
            })
            other.append(keep)
            preview.prepend(other)
            host.querySelector('[data-editor-view="split"]').click()
          })
          .catch((error) => {
            if (alive && owner && epoch === authEpoch) notify(error.message, "error")
          })
      }
      if (event.target.closest(".memory-editor-save")) submit()
      if (event.target.closest(".memory-editor-delete") && current) {
        hide()
        act(current, "delete")
      }
    })
    document.body.append(host)
    editorWindow = createPanelWindow({
      host,
      heading,
      caption,
      toggle: host.querySelector('[data-editor-window="maximize"]'),
      onChange: () => {},
    })
    return {
      show,
      showRecoveries,
      hide,
      flush: saveRecovery,
      recoveryState(value) {
        if (value.editorId !== draftId) return
        recoveryStatus.textContent =
          {
            loading: "云恢复稿",
            saving: "暂存中…",
            saved: "已云暂存",
            deleted: "已保存",
            conflict: "恢复稿有冲突",
            error: "暂存失败",
          }[value.state] || "云恢复稿"
      },
      destroy() {
        editorSerial++
        clearTimeout(recoveryTimer)
        if (previewFrame) cancelAnimationFrame(previewFrame)
        for (const remove of editorListeners) remove()
        tagControl.destroy()
        textarea.value = ""
        preview.replaceChildren()
        lastContent = ""
        lastAttachments = []
        current = null
        editorWindow.destroy?.()
        editorWindow.detach()
        host.remove()
      },
    }
  }

  on(hub, "click", (event) => {
    const tag = event.target.closest("[data-memory-tag]")
    if (tag) {
      event.preventDefault()
      chooseTag(tag.dataset.memoryTag)
      return
    }
    const view = event.target.closest("button[data-memory-view]")
    if (view) {
      state.view = view.dataset.memoryView
      state.page = 1
      writeUrl()
      updateControls()
      void load()
      return
    }
    const period = event.target.closest("[data-memory-period]")
    if (period) {
      const target = hub.querySelector(`#memory-month-${CSS.escape(period.dataset.memoryPeriod)}`)
      if (target) {
        if (!matchMedia("(min-width: 1001px)").matches) sidebar.open = false
        target.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        })
        for (const button of timeNavigation.querySelectorAll("[data-memory-period]"))
          button.setAttribute("aria-current", button === period ? "location" : "false")
      }
      return
    }
    const action = event.target.closest("[data-memory-action]")
    if (!action) return
    if (action.dataset.memoryAction === "expand") {
      const card = action.closest(".memory-card")
      const expanded = card.classList.toggle("is-collapsed") === false
      action.textContent = expanded ? "收起" : "展开全文"
      action.setAttribute("aria-expanded", String(expanded))
      return
    }
    if (!owner) return
    if (action.dataset.memoryAction === "recoveries") {
      editor ||= createEditor()
      editor.showRecoveries()
      return
    }
    const memory = records.get(action.dataset.memoryId)
    if (action.dataset.memoryAction === "new" || action.dataset.memoryAction === "edit") {
      editor ||= createEditor()
      editor.show(action.dataset.memoryAction === "edit" ? memory : null)
    } else if (["delete", "restore"].includes(action.dataset.memoryAction))
      act(memory, action.dataset.memoryAction)
  })
  on(search, "input", () => {
    clearTimeout(searchTimer)
    state.q = search.value
    state.page = 1
    writeUrl()
    searchTimer = setTimeout(() => void load(), 160)
  })
  on(sort, "change", () => {
    state.sort = sort.value
    state.page = 1
    writeUrl()
    void load()
  })
  on(statusControl, "change", () => {
    state.status = statusControl.value
    state.page = 1
    void load()
  })
  const responsiveSidebar = () => {
    sidebar.open = matchMedia("(min-width: 1001px)").matches
  }
  const measureHeader = () => {
    const header = document.querySelector(".blog-header")
    const bottom = `${Math.max(100, Math.ceil(header?.getBoundingClientRect().bottom || 110) + 32)}px`
    const summaryHeight = `${Math.ceil(sidebar.querySelector("summary").getBoundingClientRect().height)}px`
    const start = `${Math.ceil(get(".memory-layout").getBoundingClientRect().top + window.scrollY)}px`
    if (sidebar.style.getPropertyValue("--memory-header-bottom") !== bottom)
      sidebar.style.setProperty("--memory-header-bottom", bottom)
    if (sidebar.style.getPropertyValue("--memory-sidebar-summary-height") !== summaryHeight)
      sidebar.style.setProperty("--memory-sidebar-summary-height", summaryHeight)
    if (sidebar.style.getPropertyValue("--memory-sidebar-start") !== start)
      sidebar.style.setProperty("--memory-sidebar-start", start)
  }
  const headerObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureHeader) : null
  if (document.querySelector(".blog-header"))
    headerObserver?.observe(document.querySelector(".blog-header"))
  headerObserver?.observe(sidebar.querySelector("summary"))
  headerObserver?.observe(get(".memory-layout"))
  on(window, "resize", () => {
    responsiveSidebar()
    measureHeader()
  })
  on(
    document,
    "pointerdown",
    (event) => {
      if (!matchMedia("(min-width: 1001px)").matches && !sidebar.contains(event.target))
        sidebar.open = false
    },
    { passive: true },
  )
  on(document, "keydown", (event) => {
    if (event.key === "Escape" && !matchMedia("(min-width: 1001px)").matches && sidebar.open) {
      sidebar.open = false
      sidebar.querySelector("summary").focus()
    }
  })
  on(document, "howard:content-updated", () => void load({ quiet: true }))
  on(window, "focus", () => void load({ quiet: true }))
  on(document, "howard-owner-statechange", (event) => {
    // A logout removes private DOM and pending replies immediately, before a
    // guest request is issued. Only the service decides the subsequent scope.
    forcePublic = event.detail?.loggedIn === false
    request++
    pendingFetch?.abort()
    if (forcePublic) {
      owner = false
      purgePrivateState()
    }
    updateControls()
    void load()
  })
  search.value = state.q
  sort.value = state.sort
  responsiveSidebar()
  measureHeader()
  updateControls()
  void (async () => {
    try {
      const response = await fetch(new URL("runtime-config.json", siteBase), { cache: "no-store" })
      if (!response.ok) throw new Error("记忆卡服务暂时无法连接。")
      const config = await response.json()
      if (!config.enabled || !/^https?:$/.test(new URL(config.apiBase, siteBase).protocol))
        throw new Error("记忆卡服务尚未配置。")
      apiBase = `${new URL(config.apiBase, siteBase).href.replace(/\/$/, "")}/memories`
      if (alive) await load()
    } catch (error) {
      message.textContent = error.message
    }
  })()
  return {
    destroy() {
      const pendingRecovery = editor?.flush()
      if (pendingRecovery)
        void pendingRecovery.catch(() => {}).finally(() => cloudController?.dispose())
      else cloudController?.dispose()
      alive = false
      request++
      pendingFetch?.abort()
      clearTimeout(searchTimer)
      clearTimeout(noticeTimer)
      headerObserver?.disconnect()
      pager.destroy()
      for (const remove of listeners) remove()
      editor?.destroy()
      releaseResources()
      records.clear()
      progress.remove()
      recoveryLauncher.remove()
      list.replaceChildren()
      timeline.replaceChildren()
    },
  }
}
