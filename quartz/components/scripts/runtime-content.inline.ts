import { invalidatePageCache } from "./util"

let contentPromise: Promise<ContentIndex> | undefined
let revision = document.body.dataset.runtimeRevision || ""

function invalidate(next = revision) {
  revision = next
  contentPromise = undefined
  invalidatePageCache()
  document.dispatchEvent(new CustomEvent("howard:index-invalidated", { detail: { revision } }))
}

window.__howardContentIndex = () => {
  const base = document.body.dataset.basepath || ""
  contentPromise ??= fetch(
    `${base}/static/contentIndex.json${revision ? `?v=${encodeURIComponent(revision)}` : ""}`,
    { cache: "no-cache" },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("无法加载笔记索引，请稍后重试。")
      const data = await response.json()
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("笔记索引格式不正确。")
      return data
    })
    .catch((error) => {
      contentPromise = undefined
      throw error
    })
  return contentPromise
}

document.addEventListener("nav", () => {
  const next = document.body.dataset.runtimeRevision || ""
  if (next !== revision) invalidate(next)
})

document.addEventListener("howard:content-updated", (event) => {
  const next = event.detail?.revision
  if (!["string", "number"].includes(typeof next) || next === "") return
  invalidate(String(next))
  // The editor survives the same-page refresh; public content and navigation
  // are updated only after the backend confirms the complete revision.
  void window.spaRefresh?.()
})
