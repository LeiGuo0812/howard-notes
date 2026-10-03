import { restoreSession, rememberSession, clearSession } from "./session.mjs"
import { signIn, resumeSignIn } from "./auth.mjs"

const INTENT_KEY = "howard-maintenance-return"

// Session restoration is independent of Markdown, the editor and its catalogue.
export async function createMaintenance({
  siteBase,
  version,
  loadWorkspace = () => import("./maintenance-workspace.mjs"),
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
    sessionGeneration = 0,
    expiryTimer
  const commands = new Map()
  const commandHandles = new Map()
  const invalidatedTokens = new Set()
  function expireSession() {
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
    if (panel) await panel.connect(credentials)
    changed()
  }
  async function openWorkspace() {
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
    if (credentials && instance.getOwnerAccess()?.token !== credentials.token) {
      if (!connectionPromise)
        connectionPromise = instance.connect(credentials).finally(() => {
          connectionPromise = null
        })
      await connectionPromise
    }
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
  return {
    login,
    resume,
    async perform(action) {
      if (action === "reconnect") return login(true)
      if (action === "logout" && !panel) {
        expireSession()
        void clearSession(base)
        return
      }
      if (!credentials || performance.now() >= deadline) return login()
      const token = credentials.token
      const instance = await openWorkspace()
      if (credentials?.token === token) return instance.perform(action)
    },
    getOwnerAccess() {
      if (credentials && performance.now() >= deadline) expireSession()
      return credentials && performance.now() < deadline
        ? { account: credentials.login, token: credentials.token }
        : null
    },
    beforeNavigation() {
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
