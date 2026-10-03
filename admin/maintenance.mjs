import { restoreSession, rememberSession, clearSession } from "./session.mjs"
import { signIn, resumeSignIn } from "./auth.mjs"
import { createMaintenanceOpening } from "./maintenance-opening.mjs"

const INTENT_KEY = "howard-maintenance-return"
const WINDOW_ACTIONS = new Set(["settings", "articles", "new", "drafts", "trash", "private"])

// Session restoration is independent of Markdown, the editor and its catalogue.
export async function createMaintenance({
  siteBase,
  version,
  loadWorkspace = () => import("./maintenance-workspace.mjs"),
  createOpeningView = createMaintenanceOpening,
}) {
  const base = new URL(siteBase)
  const configUrl = new URL("admin/auth-config.json", base).href
  let credentials = null,
    deadline = 0,
    panel = null,
    panelPromise = null,
    connectionPromise = null,
    authenticating = false,
    privateReader = null,
    opening = null,
    openSerial = 0,
    sessionGeneration = 0,
    expiryTimer
  const commands = new Map()
  const commandHandles = new Map()
  const invalidatedTokens = new Set()
  function cancelOpening() {
    openSerial++
    opening?.destroy()
    opening = null
  }
  function expireSession() {
    cancelOpening()
    clearTimeout(expiryTimer)
    sessionGeneration++
    if (credentials?.token) invalidatedTokens.add(credentials.token)
    credentials = null
    deadline = 0
    panel?.expireSession()
    changed()
  }
  function scheduleExpiry() {
    clearTimeout(expiryTimer)
    if (credentials)
      expiryTimer = setTimeout(expireSession, Math.max(0, deadline - performance.now()))
    expiryTimer?.unref?.()
  }
  function updateControls() {
    const account = credentials?.login || ""
    for (const button of document.querySelectorAll("[data-maintenance-login]")) {
      button.hidden = !!account
      button.removeAttribute("aria-expanded")
    }
    for (const status of document.querySelectorAll("[data-maintenance-status]")) {
      status.hidden = !account
      status.title = account ? `已登录 · ${account}` : ""
    }
    for (const element of document.querySelectorAll(
      ".maintenance-toolbar,[data-private-nav],.maintenance-edit",
    ))
      element.hidden = !account
    for (const element of document.querySelectorAll(".maintenance-account"))
      element.textContent = account
  }
  async function setupReader() {
    if (!document.getElementById("private-notes-app")) {
      privateReader?.setupPrivateNotes({ siteBase: base.href })
      return
    }
    privateReader ||= await import("./private-notes.mjs")
    privateReader.setupPrivateNotes({ siteBase: base.href })
  }
  function changed() {
    updateControls()
    document.dispatchEvent(
      new CustomEvent("howard-owner-statechange", {
        detail: { loggedIn: !!credentials },
      }),
    )
    void setupReader().catch(() => {})
  }
  async function accept(value) {
    if (!value?.token) return
    const generation = ++sessionGeneration
    const receivedAt = performance.now()
    let login = value.login
    if (!login) {
      // The session endpoint has already checked fixed owner and repository access.
      const response = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${value.token}`, Accept: "application/vnd.github+json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      })
      if (!response.ok) throw new Error("暂时无法读取登录账号，请重试。")
      login = (await response.json()).login
    }
    if (generation !== sessionGeneration) return
    if (!login || !(value.expiresAt > value.serverTime))
      throw new Error("登录状态已过期，请重新登录。")
    credentials = { ...value, login }
    invalidatedTokens.delete(credentials.token)
    deadline = receivedAt + value.expiresAt - value.serverTime
    scheduleExpiry()
    void rememberSession(base, credentials)
    changed()
    if (panel) await openWorkspace("settings")
  }
  async function openWorkspace(action = "articles") {
    if (!panelPromise) {
      panelPromise = loadWorkspace()
        .then(async (module) => {
          const instance = await module.createMaintenanceWorkspace({
            siteBase: base.href,
            version,
            onSession(session, access) {
              // A slow catalogue request must not restore a session that
              // expired or was logged out while the editor was connecting.
              if (session && invalidatedTokens.has(access?.token)) return false
              if (!session && credentials?.token) invalidatedTokens.add(credentials.token)
              const previousDeadline =
                credentials?.token === access?.token &&
                credentials?.expiresAt === session?.expiresAt
                  ? deadline
                  : Infinity
              sessionGeneration++
              credentials =
                session && access
                  ? { ...session, login: session.account, token: access.token }
                  : null
              deadline = session
                ? Math.min(
                    previousDeadline,
                    performance.now() + Math.max(0, session.expiresAt - session.serverTime),
                  )
                : 0
              scheduleExpiry()
              changed()
            },
          })
          panel = instance
          for (const [name, callback] of commands)
            commandHandles.set(name, instance.registerCommand(name, callback))
          return instance
        })
        .catch((error) => {
          panelPromise = null
          throw new Error(
            "维护窗口未能加载，请再次点击重试；若仍失败，请先保存当前草稿再刷新页面。",
            { cause: error },
          )
        })
    }
    const instance = await panelPromise
    while (credentials && instance.getOwnerAccess()?.token !== credentials.token) {
      if (!connectionPromise) {
        const access = credentials
        connectionPromise = instance.connect(access, { mode: action }).finally(() => {
          connectionPromise = null
        })
      }
      await connectionPromise
    }
    if (credentials) await instance.prepare?.(action)
    return instance
  }
  async function login(reconnect = false) {
    if (authenticating) return
    if (!reconnect && credentials && performance.now() < deadline) return
    authenticating = true
    try {
      if (!credentials) {
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
          /* The login broker reports unavailable required storage. */
        }
      }
      await accept(
        await signIn({ preservePage: !!credentials, configUrl, returnTo: location.href }),
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
      await accept((await resumeSignIn({ configUrl })) || (await restoreSession(base)))
      if (credentials && intent?.url === location.href && Number.isFinite(intent.scroll))
        requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, intent.scroll) }))
    } finally {
      try {
        sessionStorage.removeItem(INTENT_KEY)
      } catch {}
    }
  }
  const currentOpening = (serial, token) =>
    serial === openSerial && credentials?.token === token && performance.now() < deadline
  const hiddenOpening = (view, token) =>
    opening === view &&
    !view.isVisible() &&
    credentials?.token === token &&
    performance.now() < deadline
  async function perform(action) {
    if (action === "reconnect") return login(true)
    if (action === "logout") {
      expireSession()
      panel?.logout?.()
      void clearSession(base)
      return
    }
    if (!credentials || performance.now() >= deadline) return login()
    const token = credentials.token
    const serial = ++openSerial
    const loading =
      WINDOW_ACTIONS.has(action) &&
      (!panel || panel.getOwnerAccess()?.token !== token || panel.isReady?.(action) === false)
    if (!loading) {
      opening?.destroy()
      opening = null
      const instance = await openWorkspace(action)
      if (currentOpening(serial, token)) return instance.perform(action)
      return
    }
    opening ||= createOpeningView({
      onHide() {
        openSerial++
      },
      onRetry(requested) {
        void perform(requested).catch(() => {})
      },
    })
    const view = opening
    // The first visual response does not depend on module, template or API requests.
    view.show(action)
    await view.afterPaint()
    if (!currentOpening(serial, token) || !view.isVisible()) {
      if (hiddenOpening(view, token)) view.setStatus("窗口已收起，可重新打开。")
      return
    }
    try {
      view.setStatus("正在加载维护界面和设置…")
      const instance = await openWorkspace(action)
      if (!currentOpening(serial, token) || !view.isVisible()) {
        if (hiddenOpening(view, token)) view.setStatus("维护界面已就绪，可重新打开。")
        return
      }
      await instance.perform(action, { openingLayout: view.capture() })
      if (currentOpening(serial, token)) {
        view.destroy()
        if (opening === view) opening = null
      }
    } catch (error) {
      if (!currentOpening(serial, token)) {
        if (hiddenOpening(view, token)) view.fail(error)
        return
      }
      view.fail(error)
      throw error
    }
  }
  return {
    login,
    resume,
    perform,
    getOwnerAccess() {
      if (credentials && performance.now() >= deadline) expireSession()
      return credentials && performance.now() < deadline
        ? { account: credentials.login, token: credentials.token }
        : null
    },
    beforeNavigation() {
      cancelOpening()
      panel?.beforeNavigation()
    },
    afterNavigation() {
      if (credentials && performance.now() >= deadline) expireSession()
      if (panel) panel.afterNavigation()
      updateControls()
      void setupReader().catch(() => {})
    },
    registerCommand(name, callback) {
      if (commands.has(name)) throw new Error(`维护操作已存在：${name}`)
      commands.set(name, callback)
      if (panel) commandHandles.set(name, panel.registerCommand(name, callback))
      return () => {
        commands.delete(name)
        commandHandles.get(name)?.()
        commandHandles.delete(name)
      }
    },
  }
}
