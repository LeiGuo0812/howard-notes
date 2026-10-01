// Only public source data crosses this boundary; GitHub credentials stay on the UI thread.
export function createPublicationWorker(siteBase) {
  let idleTimer
  let worker = null
  let sequence = 0
  const pending = new Map()
  function close(error = new Error("后台准备已停止，请重试同步。")) {
    clearTimeout(idleTimer)
    worker?.terminate()
    worker = null
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  function start() {
    if (worker) return
    worker = new Worker(new URL("maintenance-assets/publication-worker.js", siteBase), {
      type: "module",
      name: "howard-publication",
    })
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.result)
      if (!pending.size) idleTimer = setTimeout(() => close(), 60000)
    }
    worker.onerror = (event) =>
      close(new Error(`后台渲染无法启动：${event.message || "请刷新后重试同步。"}`))
    idleTimer = setTimeout(() => close(), 60000)
  }
  return {
    // Load the lazy parser/render bundle while canonical Git/D1 checks are in flight.
    // Failure is retried by preparePublication and must not prevent an already-live acknowledgement.
    warm() {
      try {
        start()
      } catch {}
    },
    preparePublication(input) {
      start()
      clearTimeout(idleTimer)
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => close(new Error("后台准备超时，请重试同步。")), 120000)
        pending.set(id, { resolve, reject, timer })
        try {
          worker.postMessage({ id, input })
        } catch (error) {
          close(error)
        }
      })
    },
    dispose: close,
  }
}
