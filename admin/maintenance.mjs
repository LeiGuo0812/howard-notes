import { createWorkspace } from "./workspace.mjs"
import { signIn, resumeSignIn } from "./auth.mjs"
import { mountFrostedSpotlight } from "../scripts/lib/frosted-spotlight.mjs"
import { trackDeployment } from "./deployment.mjs"
import { createPanelWindow } from "./panel-window.mjs"

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
  deployment.className = "maintenance-deployment"
  deployment.hidden = true
  deployment.setAttribute("role", "status")
  heading.after(deployment)
  let account = null,
    sessionDeadline = 0,
    mode = "panel",
    activeAction = "articles",
    visible = false,
    authenticating = false,
    stopDeployment = () => {}
  const workspace = createWorkspace(container, {
    siteBase: base.href,
    onSession(session) {
      account = session?.account || null
      sessionDeadline = session
        ? performance.now() + Math.max(0, session.expiresAt - session.serverTime)
        : 0
      if (!account) {
        hide()
        stopDeployment()
        deployment.hidden = true
      }
      updateControls()
    },
    onReauthenticate: () => (account ? reconnect() : login()),
    onClose: hide,
    onSaved(result) {
      stopDeployment()
      if (["article", "settings", "unpublish"].includes(result?.kind) && result.commit)
        stopDeployment = trackDeployment(deployment, result.commit)
    },
  })
  const windowState = createPanelWindow({
    host,
    heading,
    caption,
    toggle: maximize,
    onChange: attach,
    getTop: updatePanelTop,
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
    const label = document.querySelector(".maintenance-account")
    if (label) label.textContent = account || ""
    for (const button of document.querySelectorAll(".maintenance-edit")) button.hidden = !account
  }
  function currentRouteId() {
    return document.querySelector("[data-maintenance-article]")?.dataset.maintenanceArticle
  }
  function resetReading() {
    document.querySelector(".center.maintenance-editing")?.classList.remove("maintenance-editing")
    const slot = document.querySelector("[data-maintenance-slot]")
    if (slot) slot.hidden = true
  }
  function updatePanelTop() {
    const toolbar = document.querySelector(".maintenance-toolbar")
    const toolbarBottom =
      toolbar && !toolbar.classList.contains("is-reading")
        ? toolbar.getBoundingClientRect().bottom
        : 0
    const headerBottom =
      document.querySelector(".blog-header")?.getBoundingClientRect().bottom || 96
    const top = Math.max(toolbarBottom, headerBottom) + 12
    host.style.setProperty("--maintenance-panel-top", `${top}px`)
    return top
  }
  function attach() {
    resetReading()
    if (!account || !visible) {
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
    updatePanelTop()
    const captions = {
      edit: "编辑文章",
      new: "新建文章",
      drafts: "草稿箱",
      articles: "文章管理",
      settings: "页面设置",
    }
    caption.textContent = inline ? "编辑文章" : captions[activeAction] || "文章管理"
    if (inline) {
      slot.hidden = windowState.isFullscreen()
      slot.closest(".center").classList.add("maintenance-editing")
      if (!windowState.isFullscreen()) slot.append(host)
      else document.body.append(host)
    } else document.body.append(host)
    windowState.sync(inline)
    fitMenu()
  }
  function hide() {
    if (workspace.isBusy()) return
    windowState.detach()
    visible = false
    resetReading()
    host.hidden = true
    host.remove()
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
      await workspace.connect(await resumeSignIn({ configUrl }))
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
        mode = "panel"
        activeAction = "new"
        visible = true
        attach()
      },
    ],
    [
      "articles",
      () => {
        workspace.showMode("articles")
        mode = "panel"
        activeAction = "articles"
        visible = true
        attach()
      },
    ],
    [
      "drafts",
      () => {
        workspace.showMode("drafts")
        mode = "panel"
        activeAction = "drafts"
        visible = true
        attach()
      },
    ],
    [
      "settings",
      () => {
        workspace.showMode("settings")
        mode = "panel"
        activeAction = "settings"
        visible = true
        attach()
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
    if (workspace.isBusy()) return
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
    const control = event.target.closest("#tab-articles,#tab-drafts,#tab-settings,#new-article")
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
    beforeNavigation() {
      // micromorph replaces body children. Keep the same ShadowRoot, editor and listeners alive.
      windowState.detach()
      host.remove()
      resetReading()
    },
    afterNavigation() {
      updateControls()
      attach()
    },
    registerCommand(name, callback) {
      if (commands.has(name)) throw new Error(`维护操作已存在：${name}`)
      commands.set(name, callback)
      return () => commands.delete(name)
    },
  }
}
