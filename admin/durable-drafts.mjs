// This controller persists recovery originals only through the authenticated
// private API. It never stores credentials or treats browser storage as backup.
export function createDurableDraftController({ request, onState = () => {} }) {
  const entries = new Map()
  let disposed = false
  const aborted = () => new DOMException("恢复稿控制器已关闭。", "AbortError")
  const ensureAlive = () => {
    if (disposed) throw aborted()
  }
  const emit = (editorId, state, entry, extra = {}) => {
    if (!disposed) onState({ editorId, state, version: entry.version, ...extra })
  }
  const entryOf = (id) => {
    ensureAlive()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(id)) throw new Error("恢复稿编号不正确。")
    if (!entries.has(id))
      entries.set(id, {
        version: null,
        status: "ACTIVE",
        tail: Promise.resolve(),
        failed: null,
        blocked: null,
      })
    return entries.get(id)
  }
  const pathOf = (id) => `drafts/${encodeURIComponent(id)}`
  const conflictOf = (entry) => {
    const error = new Error("恢复稿已在另一端修改。你的编辑完整保留，请先比较或合并后再保存。")
    error.status = 409
    error.cause = entry.blocked
    return error
  }
  const enqueue = (entry, work) => {
    const result = entry.tail.then(() => {
      ensureAlive()
      return work()
    })
    entry.tail = result.catch(() => {})
    return result
  }
  const fetchDraft = async (id, entry) => {
    emit(id, "loading", entry)
    try {
      const value = await request(pathOf(id), "GET")
      ensureAlive()
      if (!entry.blocked && !entry.failed) {
        entry.version = value.version
        entry.status = value.status
      }
      return value
    } catch (error) {
      ensureAlive()
      if (error.status === 404) {
        if (!entry.blocked && !entry.failed) {
          entry.version = 0
          entry.status = "ACTIVE"
        }
        return null
      }
      emit(id, "error", entry, { error })
      throw error
    }
  }
  const perform = async (id, entry, operation) => {
    if (entry.blocked) throw conflictOf(entry)
    emit(id, "saving", entry)
    try {
      const value = await request(
        pathOf(id) + (operation.action ? `/${operation.action}` : ""),
        "POST",
        operation.body,
      )
      ensureAlive()
      entry.version = value.version
      entry.status = value.status
      entry.failed = null
      emit(id, operation.action === "delete" ? "deleted" : "saved", entry)
      return value
    } catch (error) {
      ensureAlive()
      entry.failed = operation
      if (error.status === 409) entry.blocked = error
      emit(id, error.status === 409 ? "conflict" : "error", entry, { error })
      throw error
    }
  }
  const prepare = async (id, entry) => {
    if (entry.blocked) throw conflictOf(entry)
    // Reuse the exact UUID and version after an interrupted acknowledgement.
    // Reading latest and blindly rebasing would silently overwrite another tab.
    if (entry.failed) await perform(id, entry, entry.failed)
    if (entry.version == null) await fetchDraft(id, entry)
  }
  return {
    load(id) {
      const entry = entryOf(id)
      return enqueue(entry, () => fetchDraft(id, entry))
    },
    save(id, record) {
      const entry = entryOf(id)
      const original = structuredClone(record)
      return enqueue(entry, async () => {
        await prepare(id, entry)
        if (entry.status === "TRASH") {
          await perform(id, entry, {
            action: "restore",
            body: { version: entry.version, requestId: crypto.randomUUID() },
          })
        }
        return perform(id, entry, {
          body: { record: original, version: entry.version, requestId: crypto.randomUUID() },
        })
      })
    },
    remove(id) {
      const entry = entryOf(id)
      return enqueue(entry, async () => {
        await prepare(id, entry)
        if (!entry.version || entry.status === "TRASH")
          return { editorId: id, version: entry.version, deleted: true }
        return perform(id, entry, {
          action: "delete",
          body: { version: entry.version, requestId: crypto.randomUUID() },
        })
      })
    },
    retry(id) {
      const entry = entryOf(id)
      return enqueue(entry, async () => {
        if (entry.blocked) throw conflictOf(entry)
        return entry.failed ? perform(id, entry, entry.failed) : fetchDraft(id, entry)
      })
    },
    acceptRemoteVersion(id, version, status = "ACTIVE") {
      const entry = entryOf(id)
      if (!Number.isSafeInteger(version) || version < 0 || !["ACTIVE", "TRASH"].includes(status))
        throw new Error("恢复稿版本不正确。")
      return enqueue(entry, () => {
        entry.version = version
        entry.status = status
        entry.failed = null
        entry.blocked = null
      })
    },
    dispose() {
      disposed = true
      for (const entry of entries.values()) {
        entry.failed = null
        entry.blocked = null
      }
      entries.clear()
    },
  }
}
