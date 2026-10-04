import { MAX_IMAGE_BYTES, prepareImage } from "./images.mjs"
import { decodeBase64, gitBlobSha } from "./github.mjs"
import { SITE_PATH, validateSite } from "../scripts/lib/site-settings.mjs"
import { imageHostSettings } from "../scripts/lib/image-host.mjs"

export const MAX_MEMORY_IMAGE_FILES = 20
export const MAX_MEMORY_IMAGE_BATCH_BYTES = 50 * 1024 * 1024

export async function loadMemoryImageHostSettings(client) {
  const ref = await client.repo(`git/ref/heads/${client.branch}`)
  const commit = ref?.object?.sha
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("图片设置版本不正确，请重试。")
  const file = await client.repo(`contents/${SITE_PATH}?ref=${commit}`)
  if (
    file?.type !== "file" ||
    file.path !== SITE_PATH ||
    !/^[a-f0-9]{40}$/.test(file.sha || "") ||
    !["base64", "none"].includes(file.encoding)
  )
    throw new Error("图片设置文件不完整，请重试。")
  const text =
    file.encoding === "base64" && typeof file.content === "string" && file.content
      ? decodeBase64(file.content)
      : await client.blobText(file.sha)
  if ((await gitBlobSha(text)) !== file.sha) throw new Error("图片设置版本不匹配，请重试。")
  return structuredClone(imageHostSettings(validateSite(JSON.parse(text))))
}

// A text-only or mixed text/image clipboard follows the browser's normal paste
// path. Screenshot/file-only clipboards are uploaded instead of embedding data.
export function clipboardMemoryImages(clipboard) {
  if (!clipboard || clipboard.getData?.("text/plain") || clipboard.getData?.("text/html")) return []
  return Array.from(clipboard.items || [])
    .filter((item) => item.kind === "file" && item.type?.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean)
}

export function validateMemoryImageBatch(files) {
  if (!files.length || files.length > MAX_MEMORY_IMAGE_FILES)
    throw new Error("每次请选择 1–20 张图片。")
  let bytes = 0
  for (const file of files) {
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error("图片需非空且不超过 10 MiB。")
    bytes += file.size
  }
  if (bytes > MAX_MEMORY_IMAGE_BATCH_BYTES) throw new Error("每批图片合计不超过 50 MiB。")
  return files
}

// Transform an insertion anchor through subsequent typing/formatting/undo. It
// never replaces a selection captured before a network request: edits made
// during upload remain intact. Insertion at the same point stays after the image.
export function moveMemoryImageAnchor(position, before, after) {
  position = Math.max(0, Math.min(before.length, position))
  if (before === after) return position
  let start = 0
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++
  let oldEnd = before.length,
    newEnd = after.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  if (position <= start) return position
  if (position >= oldEnd) return position + newEnd - oldEnd
  return newEnd
}

export function createMemoryImageUploader({
  textarea,
  getHost,
  isCurrent,
  scope = () => null,
  notify,
  onChange = () => {},
  onPending = () => {},
  prepare = prepareImage,
}) {
  let generation = 0,
    disposed = false,
    previous = textarea.value,
    tail = Promise.resolve()
  const pending = new Set()
  const current = (job) =>
    !disposed &&
    job.generation === generation &&
    job.scope === scope() &&
    !job.controller.signal.aborted &&
    isCurrent()
  const observe = () => {
    const next = textarea.value
    for (const job of pending) job.position = moveMemoryImageAnchor(job.position, previous, next)
    previous = next
  }
  const pendingChanged = () => onPending(pending.size)
  const reset = () => {
    generation++
    for (const job of pending) job.controller.abort()
    pending.clear()
    previous = textarea.value
    // A new editor must not wait for an old network response to settle.
    tail = Promise.resolve()
    pendingChanged()
  }
  const enqueue = (incoming, position = textarea.selectionStart) => {
    if (disposed || !isCurrent()) return Promise.resolve(false)
    const files = Array.from(incoming || [])
    try {
      validateMemoryImageBatch(files)
      if (pending.size >= 3) throw new Error("已有 3 批图片正在上传，请稍后再添加。")
    } catch (error) {
      notify(error.message, "error")
      return Promise.resolve(false)
    }
    observe()
    const job = {
      position: Math.max(0, Math.min(textarea.value.length, position || 0)),
      generation,
      scope: scope(),
      controller: new AbortController(),
    }
    pending.add(job)
    pendingChanged()
    notify("正在准备图片…")
    const run = async () => {
      try {
        if (!current(job)) return false
        const host = await getHost(job.controller.signal)
        if (!current(job)) return false
        const prepared = []
        for (const file of files) {
          prepared.push(await prepare(file))
          if (!current(job)) return false
          // Yield between files so dragging, typing and closing stay responsive.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        const uploaded = await host.upload(prepared, (index, total) => {
          if (current(job)) notify(`正在上传图片 ${index} / ${total}…`)
        })
        if (!current(job)) return false
        observe()
        const markdown =
          "\n" + uploaded.map((image) => `![${image.alt}](${image.url})`).join("\n") + "\n"
        textarea.setRangeText(markdown, job.position, job.position, "preserve")
        // Queued batches at the same caret retain their submission order.
        // User typing at that caret keeps the opposite affinity (observe).
        for (const other of pending)
          if (other !== job && other.position >= job.position) other.position += markdown.length
        previous = textarea.value
        onChange()
        notify(
          uploaded.length === 1 ? "图片已上传并插入。" : `${uploaded.length} 张图片已上传并插入。`,
          "done",
        )
        return true
      } catch (error) {
        if (current(job)) notify(error.message || "图片上传未完成，请重试。", "error")
        return false
      } finally {
        if (pending.delete(job)) pendingChanged()
      }
    }
    const result = tail.then(run, run)
    tail = result.then(() => {})
    return result
  }
  return {
    enqueue,
    observe,
    reset,
    get pending() {
      return pending.size
    },
    destroy() {
      disposed = true
      reset()
    },
  }
}
