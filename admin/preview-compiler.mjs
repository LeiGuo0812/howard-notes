/** At most one running compilation plus the newest edit; stale originals/results are released. */
export function createPreviewCompiler({
  siteBase,
  WorkerClass = globalThis.Worker,
  timeoutMs = 60000,
} = {}) {
  let worker,
    running,
    queued,
    serial = 0,
    timer
  function reset(error = null) {
    clearTimeout(timer)
    worker?.terminate()
    worker = null
    for (const request of [running, queued]) {
      if (error) request?.reject(error)
      else request?.resolve(null)
    }
    running = queued = null
  }
  function send(request) {
    if (!worker) {
      if (!WorkerClass) throw new Error("当前浏览器不支持后台预览。")
      const entry =
        typeof __HOWARD_PREVIEW_WORKER__ !== "undefined"
          ? __HOWARD_PREVIEW_WORKER__
          : "maintenance-assets/preview-worker.js"
      worker = new WorkerClass(new URL(entry, siteBase), {
        type: "module",
        name: "howard-editor-preview",
      })
      worker.onmessage = ({ data }) => {
        if (!running || data.id !== running.id) return
        clearTimeout(timer)
        if (data.error) running.reject(new Error(data.error))
        else running.resolve(data.result)
        running = null
        if (queued) {
          const next = queued
          queued = null
          try {
            send(next)
          } catch (error) {
            reset(error)
            next.reject(error)
          }
        }
      }
      worker.onerror = () => reset(new Error("后台预览加载失败，请重试。"))
    }
    running = request
    timer = setTimeout(() => reset(new Error("预览处理超时，请稍后重试。")), timeoutMs)
    worker.postMessage({ id: request.id, input: request.input })
    request.input = null
  }
  return {
    render(input) {
      return new Promise((resolve, reject) => {
        const request = { id: ++serial, input, resolve, reject }
        if (running) {
          running.resolve(null)
          queued?.resolve(null)
          queued = request
        } else {
          try {
            send(request)
          } catch (error) {
            reset()
            reject(error)
          }
        }
      })
    },
    clear: () => reset(),
    destroy: () => reset(),
  }
}
