import { mountHomeMemoryPreviews } from "./home-memory-previews.mjs"

let modulePromise
let mountedHub
let controller
let version = 0
let homeController, mountedHome

function setupHomeMemories() {
  const home = document.getElementById("home-memory-previews")
  if (!home || home === mountedHome) return
  mountedHome = home
  homeController?.destroy()
  homeController = mountHomeMemoryPreviews(home, {
    siteBase: new URL(home.dataset.memoryBase, location.href).href,
  })
  window.addCleanup?.(() => {
    homeController?.destroy()
    homeController = null
    mountedHome = null
  })
}

export function setupMemories() {
  setupHomeMemories()
  const hub = document.getElementById("memory-hub")
  if (!hub || hub === mountedHub) return
  const request = ++version
  mountedHub = hub
  const base = new URL(hub.dataset.memoryBase, location.href)
  if (!modulePromise) {
    modulePromise = (async () => {
      const response = await fetch(new URL("memory-assets/manifest.json", base), {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("记忆卡组件暂时无法加载。")
      const manifest = await response.json()
      if (!/^memory-[A-Z0-9]+\.js$/.test(manifest.entry))
        throw new Error("记忆卡版本不正确，请刷新后重试。")
      return import(new URL(`memory-assets/${manifest.entry}`, base).href)
    })().catch((error) => {
      modulePromise = null
      throw error
    })
  }
  void modulePromise
    .then(async ({ mountMemories }) => {
      if (request !== version || !hub.isConnected) return
      controller?.destroy()
      controller = await mountMemories(hub, { siteBase: base.href })
      window.addCleanup?.(() => {
        version++
        controller?.destroy()
        controller = null
        mountedHub = null
      })
    })
    .catch((error) => {
      if (request === version && hub.isConnected) {
        hub.querySelector("#memory-message").textContent = error.message
        mountedHub = null
      }
    })
}
