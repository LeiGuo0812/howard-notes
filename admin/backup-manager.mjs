/** Backup controls keep their work independent of the editor/window lock. */
export async function backupRequest(client, path, method = "GET", body) {
  if (!client?.token) throw new Error("请先登录。")
  if (!["status", "run", "download"].includes(path)) throw new Error("备份操作不正确。")
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

export function createBackupManager({ root, getClient, notify = () => {} }) {
  let disposed = false,
    timer,
    pending = false,
    downloading = false,
    active = false,
    latest,
    previousId
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
    download = node("button", "下载加密备份")
  for (const button of [run, download]) button.type = "button"
  download.disabled = true
  controls.append(run, download)
  root.replaceChildren(
    heading,
    status,
    controls,
    node("p", "恢复密钥需单独保存；请定期将加密备份复制到其他设备。", "backup-hint"),
  )
  const connected = (client) => !disposed && getClient() === client
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
    if (!client || pending || disposed) return
    try {
      const value = await backupRequest(client, "status")
      if (!connected(client)) return
      latest = value.latest
      download.disabled = !latest || downloading
      if (value.error) {
        active = false
        announce("备份未完成，请重试。", true)
      } else if (value.progress) {
        const progress = value.progress
        status.textContent = `正在备份 ${progress.copiedTables}/${progress.totalTables} 个数据表，已保存 ${progress.rows} 条记录。`
        if (active) {
          notify(status.textContent)
          await continueBackup(client)
        }
      } else if (latest) {
        status.textContent = `最近备份：${new Date(latest.completedAt).toLocaleString()} · ${latest.rows} 条记录`
        if (active && latest.id !== previousId) {
          active = false
          notify("加密备份已完成。")
        }
      } else status.textContent = "暂无完整备份。"
      schedule()
    } catch (error) {
      if (connected(client)) {
        active = false
        announce(error.message, true)
      }
    }
  }
  async function continueBackup(client, action = "continue") {
    if (pending) return
    pending = true
    run.disabled = true
    try {
      await backupRequest(client, "run", "POST", { action })
    } finally {
      pending = false
      if (connected(client)) run.disabled = false
    }
  }
  run.addEventListener(
    "click",
    async () => {
      const client = getClient()
      if (!client || pending) return
      active = true
      previousId = latest?.id
      announce("备份已开始，编辑与阅读可继续。")
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
