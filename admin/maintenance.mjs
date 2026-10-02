import { restoreSession } from "./session.mjs"
import { createWorkspace } from "./workspace.mjs"
import { signIn, resumeSignIn } from "./auth.mjs"
import { mountFrostedSpotlight } from "../scripts/lib/frosted-spotlight.mjs"
import { trackDeployment } from "./deployment.mjs"
import { createPanelWindow } from "./panel-window.mjs"
import { setupPrivateNotes } from "./private-notes.mjs"

const INTENT_KEY = "howard-maintenance-return"

export async function createMaintenance({ siteBase, version }) {
  const base = new URL(siteBase)
  const configUrl = new URL("admin/auth-config.json", base).href
  const template = await fetch(new URL("maintenance-assets/workspace.txt", base), {
    cache: "no-store",
  })
  if (!template.ok) throw new Error("无法加载维护界面，请稍后重试。")
  const host = document.createElement("section")
  host.id = "maintenance-host"
  host.className = "maintenance-host"
  host.hidden = true
  host.setAttribute("aria-label", "网站维护")
  const shadow = host.attachShadow({ mode: "open" })
  for (const file of ["workspace.css", "../admin/katex/katex.min.css"]) {
    const style = document.createElement("link")
    style.rel = "stylesheet"
    const url = new URL(file, new URL("maintenance-assets/", base))
    url.searchParams.set("v", version)
    style.href = url.href
    shadow.append(style)
  }
  const container = document.createElement("div")
  container.className = "workspace-body"
  container.innerHTML = await template.text()
  shadow.append(container)
  const heading = document.createElement("div")
  heading.className = "maintenance-heading"
  const caption = document.createElement("strong")
  caption.className = "maintenance-caption"
  caption.textContent = "文章管理"
  const maximize = document.createElement("button")
  maximize.type = "button"
  maximize.className = "maintenance-window-button maintenance-window-toggle"
  const minimize = document.createElement("button")
  minimize.type = "button"
  minimize.className = "maintenance-window-button maintenance-minimize"
  minimize.title = "收起窗口"
  minimize.dataset.tooltip = minimize.title
  minimize.dataset.windowAction = "hide"
  minimize.setAttribute("aria-label", minimize.title)
  minimize.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>'
  const menu = document.createElement("details")
  menu.className = "maintenance-menu"
  const summary = document.createElement("summary")
  summary.className = "maintenance-window-button"
  summary.title = "维护操作"
  summary.dataset.tooltip = summary.title
  summary.setAttribute("aria-label", summary.title)
  summary.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
  const menuItems = document.createElement("nav")
  menuItems.setAttribute("aria-label", "维护操作")
  for (const [action, label] of [
    ["new", "新建"],
    ["drafts", "草稿箱"],
    ["trash", "回收站"],
    ["articles", "文章管理"],
    ["settings", "页面设置"],
    ["reconnect", "重新登录"],
    ["logout", "退出"],
  ]) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.title = label
    button.dataset.workspaceAction = action
    menuItems.append(button)
  }
  menu.append(summary, menuItems)
  heading.append(caption, menu, maximize, minimize)
  container.prepend(heading)
  let menuFrame = 0
  function fitMenu() {
    if (menuFrame || !menu.open) return
    menuFrame = requestAnimationFrame(() => {
      menuFrame = 0
      if (!menu.open || !host.isConnected || host.hidden) return
      const viewportBottom = Math.min(
        window.innerHeight,
        window.visualViewport
          ? window.visualViewport.height + window.visualViewport.offsetTop
          : window.innerHeight,
      )
      const bottom = Math.min(viewportBottom, host.getBoundingClientRect().bottom) - 10
      menuItems.style.setProperty(
        "--maintenance-menu-height",
        `${Math.max(44, bottom - menuItems.getBoundingClientRect().top)}px`,
      )
    })
  }
  menu.addEventListener("toggle", fitMenu)
  host.addEventListener("scroll", fitMenu)
  heading.addEventListener("pointermove", fitMenu)
  window.addEventListener("resize", fitMenu)
  window.visualViewport?.addEventListener("resize", fitMenu)
  const deployment = document.createElement("div")
  deployment.className = "maintenance-progress"
  deployment.hidden = true
  deployment.setAttribute("role", "status")
  deployment.setAttribute("aria-live", "polite")
  let account = null,
    sessionDeadline = 0,
    mode = "panel",
    activeAction = "articles",
    visible = false,
    authenticating = false,
    stopDeployment = () => {},
    noticeTimer,
    pendingSynchronization = null
  const operationLabels = {
    article: "正在发布文章…",
    draft: "正在保存草稿…",
    delete: "正在移入回收站…",
    unpublish: "正在撤下文章…",
    settings: "正在保存页面设置…",
    restore: "正在恢复文章…",
    purge: "正在清理回收站…",
  }
  function showProgress(text, state = "working", { retry = false, reopen = true } = {}) {
    clearTimeout(noticeTimer)
    if (state === "pending") pendingSynchronization = { text, retry, reopen }
    deployment.dataset.state = state
    deployment.hidden = false
    deployment.replaceChildren(document.createTextNode(text))
    function appendRetry(target) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = "重试同步"
      button.title = "将 GitHub 中的最新内容同步到网站"
      button.onclick = () => {
        if (workspace.isBusy()) return showCurrentWindow()
        showProgress("正在重新同步网站…")
        void workspace.retrySynchronization()
      }
      target.append(button)
    }
    if (retry) appendRetry(deployment)
    if (reopen) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = state === "error" ? "重新打开" : "查看进度"
      button.title = "打开当前维护窗口"
      button.onclick = showCurrentWindow
      deployment.append(button)
    }
    if (pendingSynchronization && state !== "pending") {
      const pending = document.createElement("div")
      pending.className = "maintenance-pending-sync"
      pending.append(document.createTextNode(pendingSynchronization.text))
      appendRetry(pending)
      deployment.append(pending)
    }
    document.body.append(deployment)
    if (state === "done")
      noticeTimer = setTimeout(() => {
        if (pendingSynchronization)
          showProgress(pendingSynchronization.text, "pending", pendingSynchronization)
        else deployment.hidden = true
      }, 6000)
  }
  const removedArticles = new Set()
  const workspace = createWorkspace(container, {
    siteBase: base.href,
    onSession(session) {
      account = session?.account || null
      sessionDeadline = session
        ? performance.now() + Math.max(0, session.expiresAt - session.serverTime)
        : 0
      if (!account) {
        pendingSynchronization = null
        clearTimeout(noticeTimer)
        hide()
        stopDeployment()
        deployment.hidden = true
        deployment.remove()
      }
      updateControls()
      document.dispatchEvent(
        new CustomEvent("howard-owner-statechange", {
          detail: { loggedIn: !!account },
        }),
      )
      setupPrivateNotes({ siteBase: base.href })
    },
    onReauthenticate: () => (account ? reconnect() : login()),
    onClose: hide,
    onStarted(result) {
      if (!result.completion) showProgress(result.label)
    },
    onProgress(text, detail) {
      if (detail?.state) showProgress(text, detail.state, { reopen: false })
      else if (deployment.dataset.state === "working") showProgress(text)
    },
    onSettled(result) {
      if (!result.completion && !result.failed && deployment.dataset.state === "working")
        showProgress("操作已完成。", "done", { reopen: false })
    },
    onAccepted(result) {
      stopDeployment()
      hide()
      showProgress(
        result?.scope === "local"
          ? "正在删除未保存的文章…"
          : operationLabels[result?.kind] || "正在处理…",
      )
    },
    onActionError(result) {
      stopDeployment()
      showProgress(result.error || "操作未完成，请重新打开窗口重试。", "error")
    },
    onCompleted(result) {
      if (result?.scope === "local")
        showProgress("已移入本地回收站，保留 30 天。", "done", { reopen: false })
    },
    onSaved(result) {
      document.dispatchEvent(new CustomEvent("howard-private-notes-changed"))
      stopDeployment()
      if (
        result?.kind === "delete" ||
        (result?.kind === "unpublish" && result.sync?.status === "synchronized")
      ) {
        for (const id of result.removedIds || [result.articleId]) if (id) removedArticles.add(id)
        if (removedArticles.has(currentRouteId()) || mode === "inline") {
          mode = "panel"
          activeAction = result.scope === "draft" ? "drafts" : "articles"
        }
        updateControls()
        attach()
      } else if (["article", "restore"].includes(result?.kind)) {
        for (const id of result.restoredIds || [result.articleId]) removedArticles.delete(id)
        updateControls()
      }
      if (result.sync?.status === "synchronized" && Array.isArray(result.sync.publishedIds)) {
        const published = new Set(result.sync.publishedIds)
        for (const id of removedArticles) if (published.has(id)) removedArticles.delete(id)
        updateControls()
      }
      const publicOperation =
        ["article", "settings", "unpublish", "delete", "restore"].includes(result?.kind) &&
        !["draft", "local", "private"].includes(result.scope)
      if (publicOperation && result.sync?.status !== "static") {
        const state = result.sync?.status
        if (state === "synchronized") pendingSynchronization = null
        showProgress(
          state === "synchronized"
            ? "已上线。"
            : state === "pending"
              ? result.job
                ? "原文已保存，正在后台处理，可关闭网页。"
                : `已保存到 GitHub；线上同步待重试${result.sync.error ? `：${result.sync.error}` : "。"}`
              : "已保存到 GitHub，正在同步网站…",
          state === "synchronized"
            ? "done"
            : state === "pending" && !result.job
              ? "pending"
              : "working",
          { retry: state === "pending" && !result.job, reopen: state !== "synchronized" },
        )
      } else if (!publicOperation) {
        const completed = {
          draft:
            result.scope === "private" && !result.draft ? "私密原文已保存。" : "已存入草稿箱。",
          delete: "已移入回收站，保留 30 天。",
          restore: "已恢复文章。",
          purge: "已清理回收站。",
        }
        showProgress(completed[result.kind] || "已保存。", "done", { reopen: false })
      }
      if (publicOperation && result.commit && result.sync?.status === "static") {
        document.body.append(deployment)
        stopDeployment = trackDeployment(deployment, result.commit)
      }
    },
  })
  const windowState = createPanelWindow({
    host,
    heading,
    caption,
    toggle: maximize,
    onChange: attach,
  })
  mountFrostedSpotlight(container)
  const theme = () =>
    host.setAttribute(
      "saved-theme",
      document.documentElement.getAttribute("saved-theme") || "light",
    )
  new MutationObserver(theme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["saved-theme"],
  })
  theme()
  function updateControls() {
    for (const button of document.querySelectorAll("[data-maintenance-login]")) {
      const label = button.querySelector(".maintenance-login-label")
      if (label) label.textContent = "登录"
      button.hidden = !!account
      button.removeAttribute("aria-expanded")
    }
    for (const status of document.querySelectorAll("[data-maintenance-status]")) {
      status.hidden = !account
      status.title = account ? `已登录 · ${account}` : ""
    }
    const toolbar = document.querySelector(".maintenance-toolbar")
    if (toolbar) toolbar.hidden = !account
    for (const link of document.querySelectorAll("[data-private-nav]")) link.hidden = !account
    const label = document.querySelector(".maintenance-account")
    if (label) label.textContent = account || ""
    for (const button of document.querySelectorAll(".maintenance-edit"))
      button.hidden = !account || removedArticles.has(currentRouteId())
  }
  function currentRouteId() {
    return document.querySelector("[data-maintenance-article]")?.dataset.maintenanceArticle
  }
  function resetReading() {
    document.querySelector(".center.maintenance-editing")?.classList.remove("maintenance-editing")
    const slot = document.querySelector("[data-maintenance-slot]")
    if (slot) slot.hidden = true
  }
  function attach() {
    resetReading()
    if (!account || !visible) {
      workspace.setVisible(false)
      host.hidden = true
      host.remove()
      return
    }
    const article = workspace.currentArticle()
    const articleId = article?.draftOf || article?.id
    const slot = document.querySelector("[data-maintenance-slot]")
    const inline = mode === "inline" && articleId === currentRouteId() && slot
    host.classList.toggle("is-inline", !!inline)
    host.classList.toggle("is-panel", !inline)
    host.dataset.mode = inline ? "inline" : "panel"
    host.hidden = false
    const captions = {
      edit: "编辑文章",
      new: "新建文章",
      drafts: "草稿箱",
      private: "私密文库",
      trash: "回收站",
      articles: "文章管理",
      settings: "页面设置",
    }
    caption.textContent = inline ? "编辑文章" : captions[activeAction] || "文章管理"
    if (inline) {
      slot.hidden = windowState.isFullscreen()
      slot.closest(".center").classList.add("maintenance-editing")
      const parent = windowState.isFullscreen() ? document.body : slot
      if (host.parentNode !== parent) parent.append(host)
    } else if (host.parentNode !== document.body) document.body.append(host)
    workspace.setVisible(true)
    windowState.sync(inline)
    fitMenu()
  }
  function hide() {
    windowState.detach()
    visible = false
    workspace.setVisible(false)
    resetReading()
    host.hidden = true
    host.remove()
  }
  function showCurrentWindow() {
    const opening = !visible || host.classList.contains("is-inline")
    visible = true
    if (opening && mode !== "inline") windowState.center()
    else attach()
  }
  function showPanel(action) {
    mode = "panel"
    activeAction = action
    showCurrentWindow()
  }
  minimize.onclick = hide
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !visible) return
    if (menu.open) {
      menu.open = false
      return
    }
    if (
      !shadow.querySelector(".expanded") &&
      !document.querySelector(".search-container.active,.global-graph-outer.active")
    ) {
      if (windowState.isFullscreen()) windowState.restore()
      else hide()
    }
  })
  async function login() {
    if (authenticating) return
    if (account && performance.now() < sessionDeadline) {
      updateControls()
      return
    }
    authenticating = true
    try {
      if (!account) {
        try {
          sessionStorage.setItem(
            INTENT_KEY,
            JSON.stringify({
              url: location.href,
              scroll: window.scrollY,
              expires: Date.now() + 300000,
            }),
          )
        } catch {
          // signIn reports when its required short-lived proof cannot be stored.
        }
      }
      await workspace.connect(
        await signIn({
          preservePage: !!account,
          configUrl,
          returnTo: location.href,
        }),
      )
    } finally {
      authenticating = false
    }
  }
  async function reconnect() {
    if (authenticating) return
    authenticating = true
    try {
      await workspace.connect(
        await signIn({ preservePage: true, configUrl, returnTo: location.href }),
      )
    } finally {
      authenticating = false
    }
  }
  async function resume() {
    let intent
    try {
      intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) || "null")
    } catch {}
    try {
      await workspace.connect(
        (await resumeSignIn({ configUrl })) || (await restoreSession(new URL("../", configUrl))),
      )
      if (account && intent?.url === location.href && Number.isFinite(intent.scroll))
        requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, intent.scroll) }))
    } finally {
      try {
        sessionStorage.removeItem(INTENT_KEY)
      } catch {}
    }
  }
  // New commands can be registered without coupling public page components to editor internals.
  const commands = new Map([
    [
      "edit",
      async () => {
        const id = currentRouteId()
        if (!id) return
        await workspace.openArticle(id)
        const article = workspace.currentArticle()
        if ((article?.draftOf || article?.id) === id) mode = "inline"
        activeAction = "edit"
        defaultMobileView()
        visible = true
        attach()
        if (!host.hidden) host.scrollIntoView({ block: "start" })
      },
    ],
    [
      "new",
      () => {
        if (!workspace.newArticle()) return
        defaultMobileView()
        showPanel("new")
      },
    ],
    [
      "articles",
      () => {
        if (workspace.showMode("articles") === false) return
        showPanel("articles")
      },
    ],
    [
      "private",
      () => {
        if (workspace.showMode("private") === false) return
        showPanel("private")
      },
    ],
    [
      "drafts",
      () => {
        if (workspace.showMode("drafts") === false) return
        showPanel("drafts")
      },
    ],
    [
      "trash",
      () => {
        if (workspace.showMode("trash") === false) return
        showPanel("trash")
      },
    ],
    [
      "settings",
      () => {
        if (workspace.showMode("settings") === false) return
        showPanel("settings")
      },
    ],
    ["reconnect", reconnect],
    ["logout", () => workspace.logout()],
  ])
  function defaultMobileView() {
    if (matchMedia("(max-width: 800px)").matches)
      container.querySelector('button[data-view="edit"]')?.click()
  }
  async function perform(action) {
    if (!account) return login()
    if (workspace.isBusy()) {
      showCurrentWindow()
      showProgress("操作正在后台进行，可以收起窗口继续阅读。")
      return
    }
    await commands.get(action)?.()
  }
  menuItems.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workspace-action]")
    if (!button) return
    menu.open = false
    void perform(button.dataset.workspaceAction).catch((error) => {
      const status = container.querySelector("#status")
      status.hidden = false
      status.className = "error"
      status.textContent = error.message || "操作失败，请重试。"
    })
  })
  container.addEventListener("click", (event) => {
    const control = event.target.closest(
      "#tab-articles,#tab-private,#tab-drafts,#tab-trash,#tab-settings,#new-article",
    )
    if (!control) return
    queueMicrotask(() => {
      if (control.id === "new-article" && !container.querySelector("#editor-form").hidden)
        activeAction = "new"
      else {
        const selected = container.querySelector('.admin-tabs [aria-current="page"]')
        if (selected) activeAction = selected.id.replace("tab-", "")
      }
      attach()
    })
  })
  return {
    login,
    resume,
    perform,
    getOwnerAccess() {
      return account && performance.now() < sessionDeadline ? workspace.getOwnerAccess() : null
    },
    beforeNavigation() {
      // micromorph replaces body children. Keep the same ShadowRoot, editor and listeners alive.
      windowState.detach()
      workspace.setVisible(false)
      host.remove()
      deployment.remove()
      resetReading()
    },
    afterNavigation() {
      updateControls()
      setupPrivateNotes({ siteBase: base.href })
      attach()
      if (!deployment.hidden) document.body.append(deployment)
    },
    registerCommand(name, callback) {
      if (commands.has(name)) throw new Error(`维护操作已存在：${name}`)
      commands.set(name, callback)
      return () => commands.delete(name)
    },
  }
}
