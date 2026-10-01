import { hasSessionHint } from "./session.mjs"
// The reader loads only this launcher. Editor/preview dependencies arrive on demand.
let runtimePromise
let runtime
let mounted = false
let invocation = 0
let explicitlySignedOut = false
const INTENT_KEY = "howard-maintenance-return"

function siteBase() {
  const link = document.querySelector("[data-maintenance-login]")
  return new URL("../", link.href)
}
function notice(text) {
  let status = document.getElementById("maintenance-notice")
  if (!status) {
    status = document.createElement("p")
    status.id = "maintenance-notice"
    status.className = "maintenance-notice"
    status.setAttribute("role", "status")
    document.querySelector(".blog-header")?.after(status)
  }
  status.textContent = text
  status.hidden = !text
}
async function loadRuntime() {
  if (!runtimePromise) {
    const base = siteBase()
    runtimePromise = (async () => {
      const response = await fetch(new URL("maintenance-assets/manifest.json", base), {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("维护组件暂时无法加载，请稍后重试。")
      const manifest = await response.json()
      if (!/^maintenance-[A-Z0-9]+\.js$/.test(manifest.entry))
        throw new Error("维护组件版本不正确，请刷新后重试。")
      const module = await import(new URL(`maintenance-assets/${manifest.entry}`, base).href)
      runtime = await module.createMaintenance({ siteBase: base.href, version: manifest.version })
      return runtime
    })().catch((error) => {
      runtimePromise = null
      throw error
    })
  }
  return runtimePromise
}
async function invoke(callback, control) {
  const request = ++invocation
  control?.setAttribute("aria-busy", "true")
  if (!runtime) notice("正在打开维护窗口…")
  try {
    const controller = await loadRuntime()
    if (request === invocation) notice("")
    await callback(controller)
  } catch (error) {
    if (request === invocation) notice(error.message || "维护操作失败，请重试。")
  } finally {
    control?.removeAttribute("aria-busy")
  }
}
function warmRuntime(event) {
  if (runtimePromise || navigator.connection?.saveData) return
  const target = event.target.closest?.("[data-maintenance-login],[data-maintenance-action]")
  if (target) void loadRuntime().catch(() => {})
}
function hasReturn() {
  if (new URL(location.href).searchParams.has("login")) return true
  try {
    const intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) || "null")
    return intent?.expires > Date.now() && intent?.url === location.href
  } catch {
    return false
  }
}
export function setupMaintenance() {
  if (window.parent !== window) return
  if (!mounted) {
    mounted = true
    document.addEventListener("howard-owner-access-request", (event) => {
      if (typeof event.detail?.reply === "function")
        event.detail.reply(
          runtime?.getOwnerAccess() || (explicitlySignedOut ? { loggedOut: true } : null),
        )
    })
    document.addEventListener("howard-owner-statechange", (event) => {
      explicitlySignedOut = event.detail?.loggedIn === false
    })
    // Capture delegation survives Quartz's DOM replacements without duplicate bindings.
    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-maintenance-login],[data-maintenance-action]")
      if (!target || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      const action = target.dataset.maintenanceAction
      void invoke(
        (controller) => (action ? controller.perform(action) : controller.login()),
        target,
      )
    })
    // Pointer intent and keyboard focus warm the shared editor before the click;
    // credentials stay on demand and data-saving browsers keep the lazy path.
    document.addEventListener("pointerover", warmRuntime, { passive: true })
    document.addEventListener("focusin", warmRuntime)
    document.addEventListener("prenav", () => runtime?.beforeNavigation())
    document.addEventListener("nav", () => runtime?.afterNavigation())
  }
  runtime?.afterNavigation()
  if (!runtimePromise && (hasReturn() || hasSessionHint()))
    void invoke((controller) => controller.resume())
}
