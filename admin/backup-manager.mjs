/** Backup controls keep their work independent of the editor/window lock. */
export async function backupRequest(client, path, method = "GET", body) {
  if (!client?.token) throw new Error("请先登录。")
  if (!["status", "run", "download", "storage"].includes(path)) throw new Error("备份操作不正确。")
  const base = new URL(await client.endpoint())
  const site = new URL(client.siteBase)
  if (base.origin !== site.origin || !base.pathname.endsWith("/api/content"))
    throw new Error("请在主站执行备份；未向其他地址发送登录凭据。")
  const response = await client.fetcher(`${base.href}/backups/${path}`, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${client.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.error || `备份操作失败（${response.status}）。`)
  }
  return path === "download" ? response : response.json()
}

export function backupMetrics(value, storage) {
  const size = (bytes) => {
    if (!Number.isFinite(bytes)) return "待统计"
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  const rows = []
  const health = value?.health
  if (health) {
    rows.push(["备份状态", health.stale ? "需要检查：最近 48 小时无完整备份" : "正常"])
    rows.push(["本轮重新开始", `${health.restartCount || 0} 次`])
    if (health.durationMs != null)
      rows.push(["最近完成耗时", `${Math.max(1, Math.ceil(health.durationMs / 1000))} 秒`])
  }
  if (storage?.files) {
    rows.push([
      "私密原附件",
      `${storage.files.uniqueObjectCount} 个 · ${size(storage.files.uniqueObjectBytes)}`,
    ])
    if (storage.files.uncataloguedCount)
      rows.push(["未直接关联的登记项", `${storage.files.uncataloguedCount} 个，继续保留`])
  }
  if (storage?.queue) {
    rows.push([
      "后台发布",
      `${storage.queue.activeCount} 个待处理 · ${storage.queue.awaitingAuthCount} 个需登录`,
    ])
    if (storage.queue.oldestPendingAgeMs > 15 * 60_000)
      rows.push([
        "最长等待",
        `${Math.ceil(storage.queue.oldestPendingAgeMs / 60_000)} 分钟，请检查待处理任务`,
      ])
  }
  return rows
}

export function createBackupManager({ root, getClient, notify = () => {} }) {
  let disposed = false,
    timer,
    pending = false,
    downloading = false,
    active = false,
    latest,
    previousId,
    statusValue,
    storageValue,
    storagePending = false,
    statusPending = false,
    statusReady = false,
    startAttempts = 0,
    lastStartAt = 0
  const controller = new AbortController()
  const node = (tag, text, className) => {
    const value = document.createElement(tag)
    if (text) value.textContent = text
    if (className) value.className = className
    return value
  }
  root.classList.add("backup-manager")
  const heading = node("h3", "备份与恢复"),
    status = node("p", "尚未读取备份状态。")
  status.setAttribute("aria-live", "polite")
  const controls = node("div", "", "backup-controls")
  const run = node("button", "立即备份"),
    download = node("button", "下载加密备份"),
    refresh = node("button", "刷新状态")
  for (const button of [run, download, refresh]) button.type = "button"
  run.disabled = true
  download.disabled = true
  controls.append(run, download, refresh)
  const metrics = node("dl", "", "backup-metrics")
  root.replaceChildren(
    heading,
    status,
    controls,
    metrics,
    node("p", "恢复密钥需单独保存；请定期将加密备份复制到其他设备。", "backup-hint"),
  )
  const connected = (client) => !disposed && getClient() === client
  const renderMetrics = () => {
    metrics.replaceChildren(
      ...backupMetrics(statusValue, storageValue).flatMap(([label, value]) => [
        node("dt", label),
        node("dd", value),
      ]),
    )
  }
  async function loadStorage() {
    const client = getClient()
    if (!client || disposed || storagePending) return
    storagePending = true
    try {
      const value = await backupRequest(client, "storage")
      if (!connected(client)) return
      storageValue = value
      renderMetrics()
    } catch {
      // Capacity inspection never prevents downloading an existing good backup.
      if (connected(client)) metrics.setAttribute("aria-label", "容量暂不可用，请刷新重试")
    } finally {
      storagePending = false
    }
  }
  const announce = (text, error = false) => {
    status.textContent = text
    notify(text, error)
  }
  const schedule = () => {
    clearTimeout(timer)
    if (!disposed && active) timer = setTimeout(() => void load(), 5000)
  }
  async function load() {
    const client = getClient()
    if (!client || pending || disposed || statusPending) return
    statusPending = true
    try {
      const value = await backupRequest(client, "status")
      if (!connected(client)) return
      latest = value.latest
      statusReady = true
      run.disabled = pending
      statusValue = value
      renderMetrics()
      if (!storageValue) void loadStorage()
      download.disabled = !latest || downloading
      if (active && latest && latest.id !== previousId) {
        active = false
        announce("加密备份已完成。")
      } else if (value.error) {
        active = false
        announce("备份未完成，请重试。", true)
      } else if (value.progress) {
        const progress = value.progress
        status.textContent = `正在备份 ${progress.copiedTables}/${progress.totalTables} 个数据表，已保存 ${progress.rows} 条记录。`
        if (active) {
          notify(status.textContent)
          await continueBackup(client)
        }
      } else if (active) {
        if (startAttempts >= 12) {
          active = false
          announce("备份暂时无法启动，请稍后点击“立即备份”重试；已有备份仍可下载。", true)
        } else {
          announce("正在等待备份任务启动，系统会自动重试；编辑与阅读可继续。")
          // A Cron lease can acknowledge start without starting any work.
          // Retrying the same expected latest ID cannot force another backup
          // if the first accepted request already completed in the meantime.
          if (Date.now() - lastStartAt >= 5000) {
            await continueBackup(client, "start")
          }
        }
      } else if (latest) {
        status.textContent = `${value.health?.stale ? "备份已过期，请检查。" : ""}最近备份：${new Date(latest.completedAt).toLocaleString()} · ${latest.rows} 条记录`
      } else status.textContent = "暂无完整备份。"
      schedule()
    } catch (error) {
      if (connected(client)) {
        active = false
        announce(error.message, true)
      }
    } finally {
      statusPending = false
    }
  }
  refresh.addEventListener(
    "click",
    () => {
      status.textContent = "正在刷新…"
      void load()
      void loadStorage()
    },
    { signal: controller.signal },
  )
  async function continueBackup(client, action = "continue") {
    if (pending) return
    pending = true
    run.disabled = true
    try {
      if (action === "start") {
        lastStartAt = Date.now()
        startAttempts++
      }
      await backupRequest(client, "run", "POST", {
        action,
        ...(action === "start" ? { expectedLatestId: previousId } : {}),
      })
    } finally {
      pending = false
      if (connected(client)) run.disabled = !statusReady
    }
  }
  run.addEventListener(
    "click",
    async () => {
      const client = getClient()
      if (!client || pending || !statusReady) return
      active = true
      previousId = latest?.id ?? null
      startAttempts = 0
      announce("正在请求备份，编辑与阅读可继续。")
      try {
        await continueBackup(client, "start")
        if (connected(client)) schedule()
      } catch (error) {
        if (connected(client)) {
          active = false
          announce(error.message, true)
        }
      }
    },
    { signal: controller.signal },
  )
  download.addEventListener(
    "click",
    async () => {
      const client = getClient()
      if (!client || !latest || downloading) return
      downloading = true
      download.disabled = true
      announce("正在下载加密备份…")
      try {
        const response = await backupRequest(client, "download")
        const blob = await response.blob()
        if (!connected(client)) return
        const link = node("a")
        const url = URL.createObjectURL(blob)
        link.href = url
        link.download = `notes-backup-${latest.id.replace(/[^a-zA-Z0-9_-]/g, "")}.hnbackup`
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        announce("加密备份已下载。")
      } catch (error) {
        if (connected(client)) announce(error.message, true)
      } finally {
        downloading = false
        if (connected(client)) download.disabled = !latest
      }
    },
    { signal: controller.signal },
  )
  return {
    load,
    dispose() {
      disposed = true
      clearTimeout(timer)
      controller.abort()
      root.replaceChildren()
    },
  }
}
