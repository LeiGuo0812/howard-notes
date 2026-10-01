// The reader loads only this launcher. Editor/preview dependencies arrive on demand.
let runtimePromise
let runtime
let mounted = false
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
async function invoke(callback) {
  notice("正在加载…")
  try {
    const controller = await loadRuntime()
    notice("")
    await callback(controller)
  } catch (error) {
    notice(error.message || "维护操作失败，请重试。")
  }
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
    // Capture delegation survives Quartz's DOM replacements without duplicate bindings.
    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-maintenance-login],[data-maintenance-action]")
      if (!target || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      const action = target.dataset.maintenanceAction
      void invoke((controller) => (action ? controller.perform(action) : controller.login()))
    })
    document.addEventListener("prenav", () => runtime?.beforeNavigation())
    document.addEventListener("nav", () => runtime?.afterNavigation())
  }
  runtime?.afterNavigation()
  if (!runtimePromise && hasReturn()) void invoke((controller) => controller.resume())
}
