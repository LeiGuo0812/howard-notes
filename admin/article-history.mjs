import { createPreview } from "./preview.mjs"

/** History reads never rebase the open editor. Restoration is an explicit CAS write. */
export function createArticleHistory({ root, getContext, run, notify, onRestored }) {
  const content = root.querySelector(".article-history-content")
  let epoch = 0,
    selected = 0,
    disposed = false,
    viewer = null
  const clear = () => {
    epoch++
    viewer?.clear()
    viewer = null
    content.replaceChildren()
  }
  const node = (tag, text) => {
    const element = document.createElement(tag)
    if (text) element.textContent = text
    return element
  }
  async function load() {
    const context = getContext(),
      id = context.current?.id
    if (disposed || !id || !/^pv:\d+$/.test(context.openedSha || "")) return
    clear()
    const serial = epoch
    content.append(node("p", "正在读取版本…"))
    try {
      const response = await context.client.articleHistory(id)
      if (disposed || serial !== epoch || getContext().current?.id !== id) return
      content.replaceChildren()
      const list = node("div"),
        detail = node("div")
      list.className = "article-history-list"
      detail.className = "article-history-detail"
      for (const version of response.versions) {
        const row = node("div"),
          label = node(
            "span",
            `v${version.version} · ${new Date(version.savedAt).toLocaleString("zh-CN")} · ${(version.bytes / 1024).toFixed(1)} KiB`,
          ),
          view = node("button", "查看")
        view.type = "button"
        view.title = "查看此版本原文与预览"
        row.append(label, view)
        list.append(row)
        view.onclick = async () => {
          const selection = ++selected
          view.disabled = true
          try {
            const historical = await context.client.articleHistory(id, version.version)
            if (
              disposed ||
              serial !== epoch ||
              selection !== selected ||
              getContext().current?.id !== id
            )
              return
            viewer?.clear()
            detail.replaceChildren()
            const controls = node("div"),
              restore = node("button", "恢复为私密版本"),
              toggle = node("button", "查看原文"),
              raw = node("textarea"),
              preview = node("div")
            controls.className = "article-history-controls"
            restore.type = toggle.type = "button"
            restore.title = "恢复会创建新版本，公开文章保持原状"
            raw.readOnly = true
            raw.value = historical.raw
            raw.hidden = true
            raw.setAttribute("aria-label", `v${version.version} Markdown 原文`)
            preview.className = "markdown-preview article-history-preview"
            controls.append(toggle, restore)
            detail.append(controls, raw, preview)
            viewer = createPreview(preview, () => ({
              ...getContext(),
              articles: getContext().snapshot.catalog.articles,
              images: [],
              attachments: historical.article.attachments || [],
              articleFile: historical.article.file,
            }))
            toggle.onclick = () => {
              raw.hidden = !raw.hidden
              preview.hidden = !raw.hidden
              toggle.textContent = raw.hidden ? "查看原文" : "查看预览"
            }
            restore.onclick = () => {
              const latest = getContext()
              if (latest.current?.id !== id) return
              if (
                !confirm(
                  `${latest.dirty ? "当前未保存的修改将被丢弃。" : ""}恢复 v${version.version}？恢复会创建新的私密版本，不影响已公开文章。`,
                )
              )
                return
              void run(
                async () => {
                  const result = await latest.client.restoreArticleVersion({
                    opened: latest.current,
                    openedSha: latest.openedSha,
                    version: version.version,
                  })
                  await onRestored(result)
                  notify("已恢复为新的私密版本。")
                },
                {
                  completion: { kind: "restore", scope: "private", articleId: id },
                  label: "正在恢复私密版本…",
                },
              )
            }
            await viewer.render(historical.raw)
          } catch (error) {
            if (!disposed && serial === epoch) notify(error.message, true)
          } finally {
            if (view.isConnected) view.disabled = false
          }
        }
      }
      if (!response.versions.length) list.append(node("p", "暂无历史版本"))
      content.append(list, detail)
    } catch (error) {
      if (!disposed && serial === epoch) {
        content.replaceChildren(node("p", error.message))
        notify(error.message, true)
      }
    }
  }
  const toggle = () => {
    if (root.open) void load()
    else clear()
  }
  root.addEventListener("toggle", toggle)
  return {
    reset() {
      clear()
      root.open = false
      root.hidden = !/^pv:\d+$/.test(getContext().openedSha || "")
    },
    dispose() {
      disposed = true
      clear()
      root.removeEventListener("toggle", toggle)
    },
  }
}
