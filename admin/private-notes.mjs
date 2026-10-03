import { PersonalLibrary } from "./personal-library.mjs"
import { requestOwnerAccess } from "./owner-access.mjs"
import {
  createPrivateReadingGate,
  privateReadingRows,
  privateReadingPage,
  privateNoteUrl,
  privateApiBase,
  privateReadingAnchor,
} from "./private-notes-core.mjs"
import { loadMermaidViewer } from "./mermaid-loader.mjs"
import { createPagination, mountPagination } from "../scripts/lib/pagination.mjs"
import runtimeConfig from "../runtime/config.json" with { type: "json" }

let mountedRoot, mounted
const node = (tag, className, text) => {
  const result = document.createElement(tag)
  if (className) result.className = className
  if (text !== undefined) result.textContent = text
  return result
}
const button = (text, action, value) => {
  const result = node("button", "private-button", text)
  result.type = "button"
  result.dataset.privateAction = action
  if (value !== undefined) result.dataset.privateValue = value
  return result
}
const date = (value) => (/^\d{4}-\d{2}-\d{2}/.test(value || "") ? value.slice(0, 10) : "日期未记录")
const validId = (id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || "")
let diagramSerial = 0

function sourceFor(code) {
  try {
    const source = JSON.parse(code.getAttribute("data-clipboard"))
    if (typeof source === "string") return source
  } catch {}
  return code.textContent || ""
}

// This controller belongs to one authenticated reading epoch. It keeps only
// the current article's diagram sources in memory, and never requests its body
// again when the site theme changes.
export function mountPrivateDiagrams(body, { viewer, isCurrent }) {
  const controller = new AbortController()
  let disposed = false,
    theme = viewer.diagramThemeKey(body)
  const active = () => !disposed && !controller.signal.aborted && body.isConnected && isCurrent()
  const records = [...body.querySelectorAll("code.mermaid, code.language-mermaid")].map((code) => ({
    code,
    source: sourceFor(code),
    serial: 0,
    host: null,
    view: null,
    error: null,
  }))
  async function render(record) {
    const serial = ++record.serial
    const valid = () => active() && record.serial === serial
    if (!valid()) return
    record.error?.remove()
    record.error = null
    try {
      const svg = await viewer.renderDiagram(record.source, {
        element: body,
        isCurrent: valid,
        signal: controller.signal,
        idPrefix: `private-reading-diagram-${++diagramSerial}`,
      })
      if (!svg || !valid()) return
      if (record.view) {
        record.view.update(svg)
      } else {
        const host = node("div", "private-mermaid")
        record.code.parentElement.replaceWith(host)
        record.host = host
        record.view = viewer.mountDiagram(host, {
          source: record.source,
          svg,
          isCurrent: active,
          onRetry: () => render(record),
        })
      }
    } catch {
      if (!valid()) return
      const error = node("small", "private-reading-error", "流程图暂时无法显示")
      error.setAttribute("role", "status")
      ;(record.host || record.code.parentElement).after(error)
      record.error = error
    }
  }
  const stopObserving = viewer.observeDiagramTheme(body, () => {
    if (!active()) return
    const next = viewer.diagramThemeKey(body)
    if (next === theme) return
    theme = next
    for (const record of records) void render(record)
  })
  const ready = Promise.all(records.map(render))
  return {
    ready,
    destroy() {
      if (disposed) return
      disposed = true
      controller.abort()
      stopObserving()
      for (const record of records) {
        record.serial++
        record.view?.destroy()
        record.error?.remove()
        record.code.textContent = ""
        record.code.removeAttribute("data-clipboard")
        record.host?.replaceChildren()
        record.source = ""
        record.code = record.host = record.view = record.error = null
      }
      records.length = 0
    },
  }
}

export function mountPrivateNotes(
  root,
  { siteBase, getAccess = requestOwnerAccess, fetcher = (...args) => fetch(...args) } = {},
) {
  const base = new URL(siteBase || root.dataset.siteBase, location.href)
  const gate = createPrivateReadingGate(getAccess)
  const listeners = new AbortController()
  const filters = { query: "", tag: "", category: "", sort: "modified-desc", page: 1 }
  let alive = true,
    rows = [],
    articles = [],
    client,
    worker,
    pendingRender,
    readSerial = 0,
    loaded = false,
    loading = false,
    denied = false,
    currentId = null,
    exportReading = null,
    pager,
    diagrams,
    searchTimer,
    requests = new AbortController()
  const blobs = new Set()
  const on = (target, name, callback) =>
    target.addEventListener(name, callback, { signal: listeners.signal })
  const clearResources = () => {
    pager?.destroy()
    pager = null
    exportReading = null
    readSerial++
    requests.abort()
    requests = new AbortController()
    worker?.terminate()
    worker = null
    pendingRender?.reject(new Error("阅读已取消"))
    pendingRender = null
    diagrams?.destroy()
    diagrams = null
    for (const url of blobs) URL.revokeObjectURL(url)
    blobs.clear()
  }
  const clearPrivate = () => {
    clearResources()
    if (client) client.token = ""
    client = null
    rows = []
    articles = []
    loaded = false
    loading = false
    currentId = null
    filters.query = ""
    filters.tag = ""
    filters.category = ""
    filters.page = 1
    root.removeAttribute("data-maintenance-article")
    document.querySelector(".maintenance-toolbar")?.classList.remove("is-reading")
    root.replaceChildren()
  }
  const message = (text, retry = false) => {
    pager?.destroy()
    pager = null
    root.removeAttribute("data-maintenance-article")
    document.querySelector(".maintenance-toolbar")?.classList.remove("is-reading")
    const panel = node("section", "private-message")
    const paragraph = node("p", "", text)
    paragraph.setAttribute("role", "status")
    panel.append(paragraph)
    if (retry) panel.append(button("重试", "retry"))
    root.replaceChildren(panel)
  }
  const anonymous = (reauth = false) => {
    message(reauth ? "登录状态已失效，请重新登录" : "登录后查看私密文章")
    const login = node(
      reauth ? "button" : "a",
      "private-button private-primary",
      reauth ? "重新登录" : "登录",
    )
    if (reauth) {
      login.type = "button"
      login.dataset.maintenanceAction = "reconnect"
    } else {
      login.href = new URL("admin/", base).href
      login.dataset.maintenanceLogin = ""
    }
    root.firstChild.append(login)
  }
  const routeId = () => new URL(location.href).searchParams.get("note")
  const setRoute = (id) => {
    const url = new URL(location.href)
    if (id) url.searchParams.set("note", id)
    else url.searchParams.delete("note")
    url.hash = ""
    history.pushState(null, "", url)
  }
  const current = (ticket, serial) =>
    alive && root.isConnected && gate.valid(ticket) && serial === readSerial
  function chips(article) {
    const container = node("div", "private-chips")
    if (article.category) {
      const chip = button(article.category, "category", article.category)
      chip.classList.add("private-chip")
      container.append(chip)
    }
    for (const tag of article.tags || []) {
      const chip = button(`#${tag}`, "tag", tag)
      chip.classList.add("private-chip")
      container.append(chip)
    }
    return container
  }
  function renderList() {
    const state = gate.sync()
    if (!alive) return
    if (!state.access || state.changed) {
      clearPrivate()
      return state.access ? void load() : anonymous()
    }
    clearResources()
    currentId = null
    document.querySelector(".maintenance-toolbar")?.classList.remove("is-reading")
    root.removeAttribute("data-maintenance-article")
    const page = privateReadingPage(rows, filters)
    filters.page = page.page
    const header = node("header", "private-list-heading")
    header.append(node("h1", "", "私密文章"), node("span", "private-count", `${page.total} 篇`))
    const tools = node("div", "private-list-tools")
    const search = node("input", "private-search")
    search.type = "search"
    search.placeholder = "搜索文章"
    search.value = filters.query
    search.setAttribute("aria-label", "搜索私密文章")
    search.dataset.privateSearch = ""
    const sort = node("select", "private-sort")
    sort.setAttribute("aria-label", "文章排序")
    sort.dataset.privateSort = ""
    for (const [value, label] of [
      ["modified-desc", "最近修改"],
      ["created-desc", "最新创建"],
      ["created-asc", "最早创建"],
      ["title-asc", "标题排序"],
    ]) {
      const option = node("option", "", label)
      option.value = value
      option.selected = filters.sort === value
      sort.append(option)
    }
    tools.append(search, sort)
    const layout = node("div", "private-list-layout"),
      sidebar = node("aside", "private-filters")
    sidebar.setAttribute("aria-label", "文章筛选")
    for (const [field, heading, action] of [
      ["category", "专题", "category"],
      ["tags", "标签", "tag"],
    ]) {
      const counts = new Map()
      for (const { article } of rows)
        for (const value of field === "tags" ? article.tags || [] : [article.category])
          if (value) counts.set(value, (counts.get(value) || 0) + 1)
      const section = node("section", "private-filter-group")
      section.append(node("h2", "", heading))
      for (const [value, count] of [...counts].sort(([a], [b]) => a.localeCompare(b, "zh-CN"))) {
        const item = button(`${value} · ${count}`, action, value)
        item.className = "private-filter-item"
        item.setAttribute(
          "aria-pressed",
          String(filters[field === "tags" ? "tag" : field] === value),
        )
        section.append(item)
      }
      sidebar.append(section)
    }
    const content = node("div", "private-list-content")
    if (filters.tag || filters.category) {
      const selected = node("div", "private-selected-filters")
      selected.append(
        node(
          "span",
          "",
          [filters.category, filters.tag && `#${filters.tag}`].filter(Boolean).join(" · "),
        ),
        button("清除筛选", "clear"),
      )
      content.append(selected)
    }
    const list = node("div", "private-article-list")
    for (const { article } of page.rows) {
      const row = node("article", "private-article-row")
      const title = node("a", "private-article-title", article.title)
      title.href = privateNoteUrl(base, article.id)
      title.dataset.privateOpen = article.id
      title.dataset.routerIgnore = ""
      row.append(
        title,
        node(
          "time",
          "private-article-date",
          date(article.modified || article.created || article.date),
        ),
      )
      if (article.description)
        row.append(node("p", "private-article-excerpt", article.description.slice(0, 220)))
      row.append(chips(article))
      list.append(row)
    }
    if (!page.rows.length) list.append(node("p", "private-empty", "暂无匹配文章"))
    content.append(list)
    const pagination = createPagination({ prefix: "private", label: "私密文章分页" })
    pager = mountPagination(pagination, {
      onPageChange(value) {
        filters.page = value
        renderList()
        root.querySelector(".private-article-list")?.scrollIntoView({ block: "start" })
      },
    })
    pager.update({ page: page.page, pages: page.pages, hidden: page.pages === 1 })
    content.append(pagination)
    layout.append(sidebar, content)
    root.replaceChildren(header, tools, layout)
  }
  async function apiClient(access) {
    const response = await fetcher(new URL("runtime-config.json", base), {
      cache: "no-store",
      credentials: "omit",
      signal: requests.signal,
    })
    const config = await response.json()
    if (!response.ok || !config.enabled) throw new Error("私密文章服务配置不正确")
    const endpoint = privateApiBase(config.apiBase, base, runtimeConfig.apiBase)
    return new PersonalLibrary(
      access.token,
      (url, options) => fetcher(url, { ...options, signal: requests.signal }),
      { siteBase: base.href, apiBase: endpoint },
    )
  }
  async function load() {
    const { access } = gate.sync()
    if (!access || !alive) return anonymous()
    gate.invalidate()
    clearResources()
    loaded = false
    loading = true
    denied = false
    rows = []
    articles = []
    const ticket = gate.begin(),
      serial = readSerial
    message("正在载入…")
    try {
      const nextClient = await apiClient(access)
      if (!current(ticket, serial)) {
        nextClient.token = ""
        return
      }
      client = nextClient
      const [result, publicResponse] = await Promise.all([
        client.personalList("articles", { isCurrent: () => current(ticket, serial) }),
        fetcher(new URL(`${client.apiBase}/catalog`), {
          cache: "no-store",
          credentials: "omit",
          signal: requests.signal,
        }).catch(() => null),
      ])
      const publicCatalog = publicResponse?.ok ? await publicResponse.json() : null
      if (!current(ticket, serial)) return
      rows = privateReadingRows(result.articles)
      const privateIds = new Set(rows.map((row) => row.article.id))
      articles = [
        ...rows.map((row) => row.article),
        ...(publicCatalog?.articles || publicCatalog?.catalog?.articles || []).filter(
          (article) => article.published && !privateIds.has(article.id),
        ),
      ]
      loaded = true
      loading = false
      if (validId(routeId())) await read(routeId())
      else renderList()
    } catch (error) {
      if (!current(ticket, serial) || error.name === "AbortError") return
      loading = false
      if (error.status === 401 || error.status === 403) {
        clearPrivate()
        denied = true
        anonymous(true)
      } else {
        // Network failures require an explicit retry too; the identity timer is
        // never an API polling loop.
        denied = true
        message("私密文章暂时无法载入", true)
      }
    }
  }
  async function renderInWorker(input) {
    const entry =
      typeof __HOWARD_PRIVATE_NOTES_WORKER__ === "string"
        ? __HOWARD_PRIVATE_NOTES_WORKER__
        : "maintenance-assets/private-notes-worker.js"
    const activeWorker = new Worker(new URL(entry, base), {
      type: "module",
      name: "howard-private-reading",
    })
    worker = activeWorker
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (worker !== activeWorker) return
        activeWorker.terminate()
        worker = null
        pendingRender = null
        reject(new Error("正文渲染超时"))
      }, 120000)
      pendingRender = {
        reject(error) {
          clearTimeout(timer)
          reject(error)
        },
      }
      activeWorker.onmessage = ({ data }) => {
        if (worker !== activeWorker) return
        clearTimeout(timer)
        pendingRender = null
        data.error ? reject(new Error("正文渲染失败")) : resolve(data.result)
      }
      activeWorker.onerror = () => {
        if (worker !== activeWorker) return
        clearTimeout(timer)
        pendingRender = null
        reject(new Error("正文渲染失败"))
      }
      activeWorker.postMessage({ id: 1, input })
    })
  }
  async function renderDiagrams(body, ticket, serial) {
    if (!body.querySelector("code.mermaid, code.language-mermaid")) return
    try {
      const viewer = await loadMermaidViewer(base)
      if (!current(ticket, serial) || !body.isConnected) return
      diagrams = mountPrivateDiagrams(body, {
        viewer,
        isCurrent: () => current(ticket, serial),
      })
      await diagrams.ready
    } catch {
      if (current(ticket, serial))
        body.append(node("small", "private-reading-error", "流程图组件暂时不可用"))
    }
  }
  async function read(id) {
    const state = gate.sync()
    if (!validId(id)) return renderList()
    if (!state.access || state.changed) {
      clearPrivate()
      return state.access ? void load() : anonymous()
    }
    clearResources()
    currentId = id
    const ticket = gate.begin(),
      serial = readSerial
    if (!rows.some((row) => row.article.id === id)) {
      message("文章不存在或已移入回收站")
      root.firstChild.append(button("返回列表", "back"))
      return
    }
    message("正在载入正文…")
    try {
      const note = await client.personalRequest(`articles/${encodeURIComponent(id)}`)
      if (!current(ticket, serial)) return
      if (note.article?.id !== id || note.status !== "ACTIVE" || note.article.published)
        throw new Error("文章已改变")
      const assetURLs = []
      for (const attachment of note.article.attachments || []) {
        if (!current(ticket, serial)) return
        if (attachment.publicUrl) continue
        if (
          !attachment.fileId ||
          (!/^image\//i.test(attachment.mimeType || "") &&
            !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(attachment.name || attachment.source || ""))
        )
          continue
        try {
          const source = await client.privateFileUrl(attachment.fileId)
          const blob = await client.readPrivateFile(source)
          if (!current(ticket, serial)) return
          const url = URL.createObjectURL(blob)
          blobs.add(url)
          for (const value of [
            attachment.source,
            attachment.sourcePath,
            ...(attachment.aliases || []),
          ].filter(Boolean))
            assetURLs.push([value, url])
        } catch (error) {
          if (error.name === "AbortError" || error.status === 401 || error.status === 403)
            throw error
        }
      }
      const result = await renderInWorker({
        article: note.article,
        raw: note.raw,
        articles,
        assetURLs,
        siteBase: base.href,
      })
      if (!current(ticket, serial)) return
      worker?.terminate()
      worker = null
      const header = node("header", "private-reading-heading")
      const controls = node("div", "private-reading-actions")
      const edit = node("button", "maintenance-edit private-edit")
      edit.type = "button"
      edit.dataset.maintenanceAction = "edit"
      edit.title = "编辑文章"
      edit.setAttribute("aria-label", "编辑文章")
      edit.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m15 5 4 4M5 19l4-1 11-11-3-3L6 15l-1 4Z"/></svg>'
      controls.append(button("返回列表", "back"), edit)
      const share = node("button", "article-share-button")
      share.type = "button"
      share.dataset.articleShare = id
      share.dataset.articleSharePrivate = "true"
      share.title = "分享文章"
      share.setAttribute("aria-label", "分享文章")
      share.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 10v10h14V10" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      controls.insertBefore(share, edit)
      header.append(
        controls,
        node("h1", "", note.article.title),
        node(
          "p",
          "private-reading-dates",
          `创建 ${date(note.article.created || note.article.date)}　更新 ${date(note.article.modified || note.article.created || note.article.date)}`,
        ),
        chips(note.article),
      )
      const slot = node("div", "private-maintenance-slot")
      slot.dataset.maintenanceSlot = ""
      slot.hidden = true
      const layout = node("div", "private-reading-layout"),
        toc = node("aside", "private-reading-toc")
      const tocDetails = node("details", "private-toc-details")
      tocDetails.open = matchMedia("(min-width: 801px)").matches
      tocDetails.append(node("summary", "", "目录"))
      const navigation = node("nav", "")
      navigation.setAttribute("aria-label", "私密文章目录")
      for (const entry of result.toc || []) {
        const anchor = node("a", "", entry.text)
        anchor.href = `#${entry.slug}`
        anchor.dataset.routerIgnore = ""
        anchor.dataset.privateAnchor = entry.slug
        anchor.dataset.depth = String(entry.depth)
        navigation.append(anchor)
      }
      tocDetails.append(navigation)
      toc.append(tocDetails)
      const body = node("article", "private-reading-body popover-hint")
      body.innerHTML = result.html
      for (const link of body.querySelectorAll("a")) {
        link.dataset.routerIgnore = ""
        if (link.getAttribute("href")?.startsWith("#")) {
          link.removeAttribute("target")
          link.dataset.privateAnchor = privateReadingAnchor(link.getAttribute("href"))
        } else {
          link.target = "_blank"
          link.rel = "noopener noreferrer"
        }
      }
      for (const image of body.querySelectorAll("img")) {
        image.loading = "lazy"
        image.referrerPolicy = "no-referrer"
      }
      layout.append(toc, body)
      root.dataset.maintenanceArticle = id
      root.replaceChildren(header, slot, layout)
      exportReading = {
        id,
        title: note.article.title,
        raw: note.raw,
        body,
        url: privateNoteUrl(base, id),
        signal: requests.signal,
        isCurrent: () => current(ticket, serial) && body.isConnected && currentId === id,
      }
      document.querySelector(".maintenance-toolbar")?.classList.add("is-reading")
      for (const title of body.querySelectorAll(".callout.is-collapsible .callout-title")) {
        title.tabIndex = 0
        title.setAttribute("role", "button")
        title.setAttribute(
          "aria-expanded",
          String(!title.parentElement.classList.contains("is-collapsed")),
        )
      }
      void renderDiagrams(body, ticket, serial)
      if (location.hash)
        document
          .getElementById(privateReadingAnchor(location.hash))
          ?.scrollIntoView({ block: "start" })
    } catch (error) {
      if (!current(ticket, serial) || error.name === "AbortError") return
      if (error.status === 401 || error.status === 403) {
        clearPrivate()
        denied = true
        anonymous(true)
        return
      }
      clearResources()
      message("正文暂时无法载入", true)
      root.firstChild.append(button("返回列表", "back"))
    }
  }
  function syncAccess() {
    if (!alive) return
    const { access, changed } = gate.sync()
    if (!access) {
      clearPrivate()
      anonymous()
      return
    }
    if (changed) {
      clearPrivate()
      denied = false
    }
    if (!loading && !denied && !loaded) void load()
  }
  on(root, "click", (event) => {
    const link = event.target.closest("[data-private-open]")
    if (
      link &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.button === 0
    ) {
      event.preventDefault()
      setRoute(link.dataset.privateOpen)
      void read(link.dataset.privateOpen)
      return
    }
    const anchor = event.target.closest("[data-private-anchor]")
    if (anchor) {
      event.preventDefault()
      document.getElementById(anchor.dataset.privateAnchor)?.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      })
      const details = anchor.closest("details")
      if (details) details.open = matchMedia("(min-width: 801px)").matches
      return
    }
    const callout = event.target.closest(".private-reading-body .callout-title")
    if (callout && callout.parentElement.classList.contains("is-collapsible")) {
      callout.parentElement.classList.toggle("is-collapsed")
      callout.setAttribute(
        "aria-expanded",
        String(!callout.parentElement.classList.contains("is-collapsed")),
      )
      return
    }
    const control = event.target.closest("[data-private-action]")
    if (!control) return
    const action = control.dataset.privateAction,
      value = control.dataset.privateValue
    if (action === "retry") {
      void load()
      return
    }
    if (action === "back") {
      setRoute(null)
      renderList()
      return
    }
    if (action === "tag" || action === "category") {
      filters[action] = filters[action] === value ? "" : value
      filters.page = 1
      if (currentId) setRoute(null)
    }
    if (action === "clear") {
      filters.tag = ""
      filters.category = ""
      filters.page = 1
    }
    renderList()
  })
  on(root, "input", (event) => {
    if (!event.target.matches("[data-private-search]")) return
    filters.query = event.target.value
    filters.page = 1
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      const selection = event.target.selectionStart
      renderList()
      const input = root.querySelector("[data-private-search]")
      input?.focus()
      try {
        input?.setSelectionRange(selection, selection)
      } catch {}
    }, 120)
  })
  on(root, "keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches(".callout-title[role='button']")
    ) {
      event.preventDefault()
      event.target.click()
    }
  })
  on(root, "change", (event) => {
    if (event.target.matches("[data-private-sort]")) {
      filters.sort = event.target.value
      filters.page = 1
      renderList()
    }
  })
  on(document, "howard-owner-statechange", () => syncAccess())
  on(document, "howard-article-export-request", (event) => {
    if (
      event.detail?.root === root &&
      event.detail.id === currentId &&
      typeof event.detail.reply === "function" &&
      exportReading?.isCurrent()
    )
      event.detail.reply(exportReading)
  })
  on(document, "howard-private-notes-changed", () => {
    if (gate.sync().access) void load()
  })
  on(document, "visibilitychange", () => {
    if (!document.hidden) syncAccess()
  })
  on(window, "popstate", () => {
    if (loaded) validId(routeId()) ? void read(routeId()) : renderList()
  })
  on(window, "pagehide", () => {
    gate.invalidate()
    clearPrivate()
  })
  const timer = setInterval(syncAccess, 1000)
  syncAccess()
  return {
    syncAccess,
    destroy() {
      if (!alive) return
      alive = false
      gate.dispose()
      listeners.abort()
      clearInterval(timer)
      clearTimeout(searchTimer)
      clearPrivate()
    },
  }
}

export function setupPrivateNotes({ siteBase } = {}) {
  const root = document.getElementById("private-notes-app")
  if (root && root === mountedRoot) {
    mounted.syncAccess()
    return
  }
  mounted?.destroy()
  mounted = null
  mountedRoot = root
  if (!root) return
  const controller = mountPrivateNotes(root, { siteBase: siteBase || root.dataset.siteBase })
  mounted = controller
  window.addCleanup?.(() => {
    controller.destroy()
    if (mounted === controller) {
      mounted = null
      mountedRoot = null
    }
  })
}
