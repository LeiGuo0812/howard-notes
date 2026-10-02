import styles from "./article-share.css"
import runtimeConfig from "../runtime/config.json" with { type: "json" }
import {
  exportFilename,
  markdownBytes,
  canShareFile,
  shareFile,
  downloadFile,
  usesMobileShare,
  sourceLink,
} from "./article-share-core.mjs"

let dialog,
  task,
  installed = false
const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}
const button = (text, action, cls = "") => {
  const node = el("button", cls, text)
  node.type = "button"
  node.addEventListener("click", action)
  return node
}
function closeDialog() {
  dialog?.close()
  dialog = null
}
function cancelTask() {
  task?.dispose()
  task = null
}
function ensureStyles() {
  let style = document.getElementById("howard-article-share-styles")
  if (!style) {
    style = el("style")
    style.id = "howard-article-share-styles"
    style.textContent = styles
    document.head.append(style)
  }
  // Quartz reconciles the head on SPA navigation. Keep the lazy-loaded UI
  // stylesheet, and recover it if another head update removes it.
  style.setAttribute("data-persist", "")
}
function install() {
  ensureStyles()
  if (installed) return
  installed = true
  document.addEventListener("nav", ensureStyles)
  const leave = () => {
    closeDialog()
    cancelTask()
  }
  document.addEventListener("prenav", leave)
  window.addEventListener("pagehide", leave)
  document.addEventListener("howard-owner-statechange", () => {
    if (dialog?.context.private && !dialog.context.isCurrent()) closeDialog()
    if (task?.context?.private && !task.context.isCurrent()) cancelTask()
  })
}

function readingContext(button, siteBase) {
  const id = button.dataset.articleShare
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || "")) throw new Error("文章不可用")
  if (button.dataset.articleSharePrivate === "true") {
    const root = button.closest("#private-notes-app")
    let reading
    document.dispatchEvent(
      new CustomEvent("howard-article-export-request", {
        detail: {
          root,
          id,
          reply: (value) => {
            reading = value
          },
        },
      }),
    )
    if (!reading?.isCurrent() || reading.signal?.aborted) throw new Error("请重新打开私密文章")
    return { ...reading, private: true, siteBase }
  }
  const root = button.closest("main.center")
  const body = root?.querySelector(":scope > article.popover-hint")
  if (!body || root.dataset.maintenanceArticle !== id) throw new Error("请在文章阅读页分享")
  return {
    id,
    title: root.querySelector(".article-title")?.textContent || document.title.split(" | ")[0],
    body,
    url: sourceLink(new URL(`notes/${id}`, siteBase).href),
    siteBase,
    revision: document.body.dataset.runtimeRevision || "",
    private: false,
    isCurrent: () =>
      body.isConnected &&
      root.isConnected &&
      document.querySelector("main.center") === root &&
      root.dataset.maintenanceArticle === id,
  }
}

async function publicSource(context, signal) {
  const base = new URL(context.siteBase)
  const configResponse = await fetch(new URL("runtime-config.json", base), {
    signal,
    cache: "no-store",
    credentials: "omit",
  })
  if (!configResponse.ok) throw new Error("无法读取文章原文配置")
  const config = await configResponse.json()
  if (!config.enabled) throw new Error("文章原文服务尚未启用")
  const api = new URL(config.apiBase, base)
  if (api.username || api.password || api.search || api.hash)
    throw new Error("文章原文服务地址不正确")
  if (
    !(
      api.origin === base.origin &&
      api.pathname.replace(/\/$/, "") === new URL("api/content", base).pathname
    ) &&
    api.href.replace(/\/$/, "") !== runtimeConfig.apiBase.replace(/\/$/, "")
  )
    throw new Error("文章原文服务地址不正确")
  const response = await fetch(`${api.href.replace(/\/$/, "")}/source/${context.id}`, {
    signal,
    cache: "no-cache",
    credentials: "omit",
  })
  if (!response.ok)
    throw new Error(response.status === 404 ? "文章已撤下或原文不可用" : "无法读取原文，请重试")
  const value = await response.json()
  if (value.id !== context.id || typeof value.source !== "string")
    throw new Error("文章原文返回不正确")
  if (
    /^\d+$/.test(context.revision) &&
    api.origin === base.origin &&
    String(value.revision) !== context.revision
  )
    throw new Error("文章已更新，请刷新阅读页后导出 Markdown")
  return value.source
}

export function openArticleShare({ button: trigger, siteBase }) {
  install()
  closeDialog()
  let context
  try {
    context = readingContext(trigger, siteBase)
  } catch (error) {
    const notice = el("p", "article-export-launch-notice", error.message)
    notice.setAttribute("role", "status")
    document.body.append(notice)
    setTimeout(() => notice.remove(), 4500)
    return
  }
  const overlay = el("div", "article-share-overlay")
  const panel = el("section", "article-share-dialog")
  panel.setAttribute("role", "dialog")
  panel.setAttribute("aria-modal", "true")
  panel.setAttribute("aria-labelledby", "article-share-title")
  const heading = el("div", "article-share-heading")
  const title = el("h2", "", "分享文章")
  title.id = "article-share-title"
  const close = button("×", closeDialog, "article-share-close")
  close.title = "关闭分享"
  close.setAttribute("aria-label", "关闭分享")
  heading.append(title, close)
  panel.append(heading, el("p", "article-share-article-title", context.title))
  if (context.private) panel.append(el("span", "article-share-private", "私密文章"))
  const formats = el("fieldset", "article-share-formats")
  formats.append(el("legend", "article-share-sr-only", "导出格式"))
  for (const [value, label, sub] of [
    ["pdf", "PDF", "可选中文本"],
    ["png", "长图", "PNG 图片"],
    ["md", "Markdown", "原始笔记"],
  ]) {
    const option = el("label", "article-share-format")
    const input = el("input")
    input.type = "radio"
    input.name = "article-share-format"
    input.value = value
    input.checked = value === "pdf"
    const text = el("span")
    text.append(el("strong", "", label), el("small", "", sub))
    option.append(input, text)
    formats.append(option)
  }
  const linkOption = el("label", "article-share-link-option")
  const include = el("input")
  include.type = "checkbox"
  include.id = "article-share-include-link"
  linkOption.append(include, el("span", "", "附上原文链接"))
  const qualityOption = el("label", "article-share-quality")
  qualityOption.append(el("span", "", "长图清晰度"))
  const quality = el("select")
  quality.setAttribute("aria-label", "长图清晰度")
  for (const [value, text] of [
    ["high", "高清"],
    ["standard", "标准"],
  ]) {
    const option = el("option", "", text)
    option.value = value
    quality.append(option)
  }
  qualityOption.append(quality)
  qualityOption.hidden = true
  formats.addEventListener("change", () => {
    qualityOption.hidden = formats.querySelector("input:checked").value !== "png"
  })
  const generate = button(
    usesMobileShare() ? "生成分享文件" : "导出并下载",
    () => {
      if (!context.isCurrent()) {
        closeDialog()
        return
      }
      const format = formats.querySelector("input:checked").value
      const withLink = include.checked
      const imageQuality = quality.value
      closeDialog()
      startExport(context, format, withLink, imageQuality)
    },
    "article-share-primary",
  )
  panel.append(formats, qualityOption, linkOption, generate)
  overlay.append(panel)
  document.body.append(overlay)
  const controller = new AbortController()
  const remove = () => {
    controller.abort()
    context.signal?.removeEventListener("abort", closeDialog)
    overlay.remove()
    if (trigger.isConnected) trigger.focus({ preventScroll: true })
  }
  dialog = { context, close: remove }
  context.signal?.addEventListener("abort", closeDialog, { once: true })
  overlay.addEventListener(
    "click",
    (event) => {
      if (event.target === overlay) closeDialog()
    },
    { signal: controller.signal },
  )
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeDialog()
      } else if (event.key === "Tab") {
        const controls = [...panel.querySelectorAll("button,input,select")].filter(
          (n) => !n.disabled && n.getClientRects().length,
        )
        const first = controls[0],
          last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    },
    { signal: controller.signal },
  )
  close.focus()
}

function startExport(context, format, includeSource, quality = "high") {
  cancelTask()
  const controller = new AbortController()
  const toast = el("section", "article-export-progress")
  toast.setAttribute("aria-label", "文章导出")
  const status = el("p", "", "正在生成文件…")
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  const controls = el("div", "article-export-actions")
  toast.append(status, controls)
  document.body.append(toast)
  let timer,
    cleanupDownload,
    disposed = false
  const job = {
    context,
    controller,
    file: null,
    text: null,
    dispose() {
      if (disposed) return
      disposed = true
      context.signal?.removeEventListener("abort", cancel)
      controller.abort()
      clearTimeout(timer)
      cleanupDownload?.()
      toast.remove()
      job.file = job.text = job.context = null
    },
  }
  const cancel = () => {
    if (task === job) cancelTask()
    else job.dispose()
  }
  const valid = () => !disposed && !controller.signal.aborted && context.isCurrent()
  context.signal?.addEventListener("abort", cancel, { once: true })
  task = job
  controls.append(button("取消", cancel))
  const progress = (text) => {
    if (valid()) status.textContent = text
  }
  const done = (message) => {
    progress(message)
    controls.replaceChildren(button("关闭", cancel))
    timer = setTimeout(cancel, 6000)
  }
  const download = () => {
    if (!valid() || !job.file) return cancel()
    cleanupDownload?.()
    cleanupDownload = downloadFile(job.file)
    done("已下载")
  }
  const ready = () => {
    if (!valid()) return cancel()
    controls.replaceChildren()
    if (canShareFile(job.file)) {
      controls.append(
        button(
          "分享文件",
          () => {
            if (!valid()) return cancel()
            let sharing
            try {
              sharing = shareFile(job.file, {
                title: context.title,
                includeSource,
                url: context.url,
              })
            } catch (error) {
              return shareFailure(error)
            }
            for (const control of controls.querySelectorAll("button")) control.disabled = true
            progress("正在分享…")
            void Promise.resolve(sharing).then(() => {
              if (valid()) done("已交给系统分享")
            }, shareFailure)
          },
          "article-share-primary",
        ),
      )
    } else {
      progress(`${job.warning || "文件已生成"}；此浏览器不支持分享该文件类型`)
      if (job.text && job.text.length <= 100000 && typeof navigator.share === "function")
        controls.append(
          button(
            "分享文本",
            () => {
              if (!valid()) return cancel()
              let sharing
              try {
                sharing = navigator.share({
                  title: context.title,
                  text: job.text,
                  ...(includeSource ? { url: context.url } : {}),
                })
              } catch (error) {
                return shareFailure(error)
              }
              for (const control of controls.querySelectorAll("button")) control.disabled = true
              void Promise.resolve(sharing).then(() => {
                if (valid()) done("已交给系统分享")
              }, shareFailure)
            },
            "article-share-primary",
          ),
        )
    }
    controls.append(button("下载", download), button("关闭", cancel))
  }
  const shareFailure = (error) => {
    if (!valid()) return cancel()
    ready()
    progress(
      error.name === "AbortError"
        ? "已取消分享，文件仍可分享或下载"
        : "系统分享未完成，可重试或下载",
    )
  }
  void (async () => {
    // Let the dialog close and progress paint before loading capture dependencies.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!valid()) return cancel()
    let result
    if (format === "md") {
      const source = context.private ? context.raw : await publicSource(context, controller.signal)
      if (!valid()) return cancel()
      const bytes = markdownBytes(source, { includeSource, url: context.url })
      job.text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
      result = {
        blob: new Blob([bytes], { type: "text/markdown;charset=utf-8" }),
        mime: "text/markdown",
        extension: "md",
        warnings: [],
      }
    } else {
      const renderer = await import("./article-export-renderer.mjs")
      if (!valid()) return cancel()
      result = await renderer.exportArticle({
        article: {
          id: context.id,
          private: context.private,
          revision: context.revision,
          title: context.title,
          body: context.body,
          sourceUrl: context.url,
          siteBase: context.siteBase,
        },
        format,
        quality,
        mobile: usesMobileShare(),
        includeSource,
        signal: controller.signal,
        onProgress: progress,
      })
    }
    if (!valid()) return cancel()
    job.file = new File([result.blob], exportFilename(context.title, result.extension), {
      type: result.mime,
    })
    const completed = result.dimensions
      ? `文件已生成（${result.dimensions.width} × ${result.dimensions.height}）`
      : "文件已生成"
    job.warning = result.warnings?.length
      ? `${completed}；${result.warnings.join("；")}`
      : completed
    if (!usesMobileShare()) {
      if (result.warnings?.length) {
        progress(job.warning)
        controls.replaceChildren(
          button("下载文件", download, "article-share-primary"),
          button("关闭", cancel),
        )
      } else download()
    } else {
      progress(job.warning)
      ready()
    }
  })().catch((error) => {
    if (!valid() || error.name === "AbortError") return cancel()
    status.textContent = error.message || "导出失败，请重试"
    controls.replaceChildren(button("关闭", cancel))
    if (error.code === "IMAGE_TOO_LONG")
      controls.prepend(
        button(
          "改为 PDF",
          () => startExport(context, "pdf", includeSource, quality),
          "article-share-primary",
        ),
      )
  })
}
