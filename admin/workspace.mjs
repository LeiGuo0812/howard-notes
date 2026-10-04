import { listLocalTrash, trashLocalRecovery, removeLocalTrash } from "./local-trash.mjs"
import { rememberSession, clearSession } from "./session.mjs"
import { PersonalLibrary } from "./personal-library.mjs"
import { createDurableDraftController } from "./durable-drafts.mjs"
import { validateCatalog } from "../scripts/lib/catalog.mjs"
import { topicList } from "../scripts/lib/site-settings.mjs"
import { formatSelection, TextHistory } from "./formatting.mjs"
import { createPreview } from "./preview.mjs"
import { createSettings } from "./settings.mjs"
import { createBackupManager } from "./backup-manager.mjs"
import { createArticleHistory } from "./article-history.mjs"
import { publicLibrarySnapshot } from "./public-library.mjs"
import { prepareImage } from "./images.mjs"
import { createTagSuggestions } from "./tag-input.mjs"
import { createRuntimePublisher, publicChange } from "./runtime-publish.mjs"
import {
  RECOVERY_FIELDS,
  listArticleRecoveries,
  readArticleRecovery,
  writeArticleRecovery,
  clearArticleRecovery,
  recoveredBaseline,
  editorSourceText,
} from "./article-recovery.mjs"

// Both the standalone administration page and the public site's maintenance panel mount this instance.
// DOM state, credentials, listeners and conflict baselines belong to this root, never to global IDs.
export function createWorkspace(root, options = {}) {
  const $ = (id) => root.querySelector(`[data-admin-id="${id}"]`) || root.querySelector(`#${id}`)
  const siteBase = new URL(options.siteBase || "../", location.href)
  const listeners = new AbortController()
  const listen = (target, type, handler, options = {}) =>
    target.addEventListener(type, handler, { ...options, signal: listeners.signal })
  let storage = options.storage
  if (storage === undefined) {
    try {
      storage = localStorage
    } catch {}
  }
  let session = null,
    disposed = false,
    visible = true,
    recoveryError = false,
    recoveryTimer,
    cloudTimer,
    cloudDrafts,
    backups,
    jobTimer
  let connectionEpoch = 0,
    connecting = false,
    libraryPromise = null
  const cloudKnown = new Set()
  let client,
    snapshot,
    current = null,
    openedSha = null,
    publishedDeletion = null,
    localRecoveryOnly = false,
    trashRecords = [],
    raw = "",
    savedForm = "",
    images = [],
    busy = false,
    articleScope = "published",
    previewTimer,
    previewVersion = 0,
    linkSelection = [0, 0],
    imageSelection = null
  const history = new TextHistory()
  const tagSuggestions = createTagSuggestions($("tags"), {
    multiple: true,
    preventSubmit: true,
    getSuggestions: () =>
      !disposed && visible && client?.token && client.personalReady && !snapshot?.settingsOnly
        ? (snapshot?.catalog.articles || []).flatMap((article) => article.tags || [])
        : [],
  })
  const date = () =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())
  const formKeys = RECOVERY_FIELDS
  const formValue = () =>
    JSON.stringify(
      formKeys.map((key) => ($(key).type === "checkbox" ? $(key).checked : $(key).value)),
    )
  const readForm = () =>
    Object.fromEntries(
      formKeys.map((key) => [key, $(key).type === "checkbox" ? $(key).checked : $(key).value]),
    )
  const articleDirty = () => !!savedForm && formValue() !== savedForm
  const publication = document.createElement("div")
  publication.className = "publication-status small"
  publication.hidden = true
  publication.setAttribute("role", "status")
  const publicationText = document.createElement("span")
  const retryPublication = document.createElement("button")
  retryPublication.type = "button"
  retryPublication.textContent = "重试同步"
  retryPublication.title = "将 GitHub 中的最新内容同步到网站"
  const dismissPublication = document.createElement("button")
  dismissPublication.type = "button"
  dismissPublication.textContent = "结束跟踪"
  dismissPublication.title = "结束跟踪冲突任务；私密原文和恢复稿保留"
  dismissPublication.hidden = true
  publication.append(publicationText, retryPublication, dismissPublication)
  $("status").before(publication)
  const publisher = createRuntimePublisher({
    siteBase,
    storage,
    getClient: () => client,
    onState(state) {
      publication.hidden = state.status === "static"
      retryPublication.hidden = state.status !== "pending"
      publicationText.textContent =
        state.status === "syncing"
          ? `已保存到 GitHub，正在同步网站${state.progress ? ` ${state.progress}` : ""}… `
          : state.status === "synchronized"
            ? "已上线。"
            : `已保存到 GitHub；线上同步未完成${state.error ? `：${state.error}` : ""} `
      if (state.status === "syncing") options.onProgress?.(publicationText.textContent)
      if (state.code === 401) $("reconnect").hidden = false
    },
    onSynchronized(state) {
      document.dispatchEvent(new CustomEvent("howard:content-updated", { detail: state }))
    },
  })
  const retrySynchronization = () =>
    action(
      async () => {
        for (const job of client?.jobs || [])
          if (job.status === "awaiting_auth")
            await client.personalRequest(`jobs/${job.id}/resume`, "POST", {
              tokenExpiresAt: session?.expiresAt,
            })
        monitorJobs()
        const state = await publisher.retry()
        if (state) options.onSaved?.({ ...state, sync: state })
      },
      { editable: true },
    )
  retryPublication.onclick = retrySynchronization
  const synchronizedJobs = new Set()
  const completedJobs = new Set()
  const queuedJobs = new Set()
  const dismissedJobs = new Set()
  try {
    for (const id of JSON.parse(storage?.getItem("howard-notes:dismissed-jobs:v1") || "[]"))
      if (typeof id === "string") dismissedJobs.add(id)
  } catch {}
  dismissPublication.onclick = () => {
    for (const job of client?.jobs || []) if (job.status === "conflict") dismissedJobs.add(job.id)
    try {
      storage?.setItem(
        "howard-notes:dismissed-jobs:v1",
        JSON.stringify([...dismissedJobs].slice(-100)),
      )
    } catch {}
    monitorJobs()
  }
  function monitorJobs() {
    clearTimeout(jobTimer)
    if (!client || disposed) return
    if (!client.personalReady) {
      void prepareLibrary().catch((error) => message(error.message, true))
      return
    }
    const connection = client,
      epoch = connectionEpoch
    const isCurrent = () =>
      !disposed && client === connection && connectionEpoch === epoch && !!connection.token
    void connection
      .personalRequest("jobs")
      .then(async ({ jobs }) => {
        if (!isCurrent()) return
        client.jobs = jobs
        const targetOf = (job) => job.publicArticleId || job.checkpoint?.articleId || job.articleId
        const pending = jobs.filter(
          (job) =>
            !["completed", "cancelled"].includes(job.status) &&
            !dismissedJobs.has(job.id) &&
            !(
              job.status === "conflict" &&
              jobs.some(
                (newer) =>
                  newer.status === "completed" &&
                  targetOf(newer) === targetOf(job) &&
                  newer.createdAt > job.createdAt,
              )
            ),
        )
        dismissPublication.hidden = !pending.some((job) => job.status === "conflict")
        if (pending.length) {
          publication.hidden = false
          publicationText.textContent = `${pending.length} 个后台任务${pending.some((job) => job.status === "conflict") ? "需要核对版本" : pending.some((job) => job.status === "awaiting_auth") ? "需要重新登录" : "正在处理，可关闭网页"}。`
          retryPublication.hidden = !pending.some((job) =>
            ["retry", "awaiting_auth"].includes(job.status),
          )
          options.onProgress?.(publicationText.textContent)
        } else if (!publisher.pending?.()) {
          dismissPublication.hidden = true
          publicationText.textContent = "后台任务已完成。"
          retryPublication.hidden = true
          options.onProgress?.(publicationText.textContent)
        }
        for (const job of jobs) {
          if (
            job.checkpoint?.commit &&
            !synchronizedJobs.has(job.id) &&
            !["conflict", "awaiting_auth"].includes(job.status)
          ) {
            synchronizedJobs.add(job.id)
            // This is a speed-up only; the durable server task and GitHub Actions
            // continue publication when the browser closes at any point.
            if (job.status !== "completed")
              void connection
                .publicSnapshot()
                .then((publicSnapshot) =>
                  publisher.publish(
                    {
                      kind: "article",
                      commit: job.checkpoint.commit,
                      articleId: job.checkpoint.articleId,
                    },
                    publicSnapshot,
                  ),
                )
                .catch(() => synchronizedJobs.delete(job.id))
          }
          if (job.status === "completed" && !completedJobs.has(job.id)) {
            const epoch = connectionEpoch
            const loaded = await connection.snapshot()
            if (client !== connection || disposed || connectionEpoch !== epoch || !connection.token)
              return
            snapshot = loaded
            completedJobs.add(job.id)
            const published = snapshot.publicSnapshot.catalog.articles.find(
              (article) => article.id === job.checkpoint.articleId,
            )
            // Advance only our exact acknowledged publication, keeping edits
            // typed while its server task ran. An unrelated newer Git version
            // must still trigger the usual conflict/recovery path.
            if (
              job.kind === "publish-private" &&
              current?.id === job.articleId &&
              openedSha === `pv:${job.privateVersion}` &&
              published &&
              snapshot.publicSnapshot.entries.get(`library/${published.file}`)?.sha ===
                job.checkpoint.sourceSha
            ) {
              const baseline = JSON.parse(savedForm)
              const continuation = {
                submitted: Object.fromEntries(formKeys.map((key, index) => [key, baseline[index]])),
                form: readForm(),
                selection: bodyState(),
                scrollTop: $("body").scrollTop,
              }
              const publishedFiles = new Set(
                (current.attachments || []).map((file) => file.fileId).filter(Boolean),
              )
              images = images.filter((image) => {
                if (!publishedFiles.has(image.attachment?.fileId)) return true
                if (image.preview) URL.revokeObjectURL(image.preview)
                return false
              })
              setScope("published")
              await loadArticle(published.id, false, snapshot, continuation)
              if (!isCurrent()) return
              persistRecovery()
            }
            renderList()
            document.dispatchEvent(
              new CustomEvent("howard:content-updated", {
                detail: { commit: job.checkpoint.commit, jobId: job.id },
              }),
            )
            options.onSaved?.({
              kind:
                job.kind === "privatize-public"
                  ? "unpublish"
                  : job.kind === "sync-public"
                    ? "settings"
                    : "article",
              articleId: job.checkpoint.articleId,
              commit: job.checkpoint.commit,
              sync: { status: "synchronized" },
            })
          }
        }
        if (
          isCurrent() &&
          pending.some((job) => !["conflict", "awaiting_auth"].includes(job.status))
        )
          jobTimer = setTimeout(monitorJobs, 4000)
      })
      .catch((error) => {
        if (isCurrent()) {
          if (error.status === 401) $("reconnect").hidden = false
          jobTimer = setTimeout(monitorJobs, 15000)
        }
      })
  }
  async function reportSaved(info, result) {
    if (result?.private) {
      options.onSaved?.({
        ...info,
        scope: "private",
        draft: !!result.snapshot?.catalog.articles.find((article) => article.id === info.articleId)
          ?.draft,
        sync: { status: "private" },
      })
      return { status: "private" }
    }
    if (result?.job) {
      queuedJobs.add(result.job.id)
      const value = { ...info, job: result.job, sync: { status: "pending", jobId: result.job.id } }
      options.onSaved?.(value)
      monitorJobs()
      return value.sync
    }
    const value = { ...info, commit: result?.sha }
    options.onSaved?.({ ...value, sync: { status: publicChange(value) ? "syncing" : "draft" } })
    const sync = await publisher.publish(
      value,
      result?.publicSnapshot || result?.snapshot?.publicSnapshot || result?.snapshot,
    )
    if (publicChange(value)) options.onSaved?.({ ...value, sync })
    return sync
  }
  const settings = createSettings({
    root,
    siteBase,
    getSnapshot: () => ({ ...publicLibrarySnapshot(snapshot), client }),
    action: (callback, detail) => action(callback, { label: "正在处理页面设置…", ...detail }),
    message,
    refresh: async () => {
      snapshot = await client.snapshot()
      return publicLibrarySnapshot(snapshot)
    },
    onSaved: async (_snapshot, result) => {
      snapshot =
        client?.currentSnapshot?.publicSnapshot?.commit === _snapshot?.publicSnapshot?.commit
          ? client.currentSnapshot
          : _snapshot
      if (client?.personalReady) renderList()
      renderCategories($("category").value)
      renderImageDestination()
      return reportSaved({ kind: "settings" }, result)
    },
  })
  const dirty = () => !!client && (articleDirty() || settings.dirty())
  const viewer = createPreview($("preview"), () => ({
    client,
    snapshot,
    siteBase,
    articles: snapshot?.catalog.articles || [],
    images,
    attachments: editorAttachments(),
    openArticle: requestArticle,
    articleFile:
      current?.draftBaseline?.article.file ||
      current?.file ||
      `notes/网页新建/${$("slug").value}.md`,
  }))
  const articleVersions = createArticleHistory({
    root: $("article-history"),
    getContext: () => ({
      client,
      snapshot,
      current,
      openedSha,
      dirty: articleDirty(),
      siteBase,
      openArticle: requestArticle,
    }),
    run: action,
    notify: message,
    async onRestored(result) {
      const id = recoveryId()
      clearImages()
      discardRecovery(id)
      snapshot = result.snapshot
      setScope(result.note.article.draft || result.note.article.draftOf ? "draft" : "private")
      await loadArticle(result.articleId, false, result.snapshot)
      await reportSaved({ kind: "restore", scope: "private", articleId: result.articleId }, result)
    },
  })
  function message(text, error = false, href) {
    const el = $("status")
    el.hidden = false
    el.className = error ? "error" : ""
    el.textContent = text
    if (busy && text.startsWith("正在")) options.onProgress?.(text)
    if (href) {
      const link = document.createElement("a")
      link.href = href
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      link.textContent = "部署进度 ↗"
      el.append(link)
    }
  }
  function lock(value, editable = false) {
    busy = value
    for (const el of root.querySelectorAll("button,input,select,textarea")) {
      const withinEditor = $("editor-form").contains(el)
      const mayEdit =
        editable &&
        withinEditor &&
        (el.matches(
          "input:not(#slug):not(#image),select,textarea,[data-format],button[data-view]",
        ) ||
          [
            "undo",
            "redo",
            "insert-link",
            "apply-link",
            "cancel-link",
            "download",
            "focus-mode",
          ].includes(el.id))
      const windowControl = el.classList.contains("maintenance-window-button")
      el.disabled = (value && !mayEdit && !windowControl) || el.dataset.boundary === "true"
    }
  }
  async function action(callback, { editable = false, completion, label = "正在处理…" } = {}) {
    if (busy) return
    lock(true, editable)
    let failed = false
    options.onStarted?.({ label, completion: !!completion })
    try {
      if (completion) options.onAccepted?.(completion)
      const result = await callback()
      if (completion) options.onCompleted?.(completion)
      return result
    } catch (error) {
      failed = true
      message(error.message || "操作失败。", true)
      options.onActionError?.({ ...completion, error: error.message || "操作失败。" })
      if (client && error.status === 401) $("reconnect").hidden = false
    } finally {
      lock(false)
      options.onSettled?.({ completion: !!completion, failed })
    }
  }
  const recoveryId = () => current?.id || $("slug").value
  function editorAttachments() {
    return [
      ...(current?.attachments || []),
      ...images.filter((image) => image.attachment).map((image) => image.attachment),
    ].filter(
      (item, index, all) =>
        all.findIndex(
          (other) => (other.fileId || other.source) === (item.fileId || item.source),
        ) === index,
    )
  }
  function discardRecovery(id = recoveryId()) {
    clearTimeout(recoveryTimer)
    clearTimeout(cloudTimer)
    if (!id) return
    if (cloudDrafts && cloudKnown.has(id)) {
      cloudKnown.delete(id)
      void cloudDrafts.remove(`article:${id}`).catch((error) => message(error.message, true))
    }
    if (!storage) return
    try {
      clearArticleRecovery(storage, id)
    } catch {}
  }
  function persistRecovery() {
    clearTimeout(recoveryTimer)
    if (!savedForm || disposed) return
    const value = {
      id: recoveryId(),
      article: current,
      openedSha,
      raw,
      savedForm,
      form: readForm(),
      attachments: editorAttachments(),
      kind: "article",
    }
    if (!articleDirty()) {
      discardRecovery()
      return
    }
    try {
      if (storage) writeArticleRecovery(storage, value)
      recoveryError = false
    } catch (error) {
      if (!recoveryError) message(error.message || "无法在当前浏览器暂存，请下载当前编辑。", true)
      recoveryError = true
    }
    clearTimeout(cloudTimer)
    if (cloudDrafts && client)
      cloudTimer = setTimeout(() => {
        cloudKnown.add(value.id)
        void cloudDrafts
          .save(`article:${value.id}`, value)
          .catch((error) => message(error.message, true))
      }, 1000)
  }
  function mayLeaveArticle() {
    if (!articleDirty()) return true
    if (!confirm("放弃未保存的文章修改？")) return false
    discardRecovery()
    return true
  }
  function renderCategories(value) {
    const select = $("category")
    select.replaceChildren(new Option("选择专题", ""))
    for (const topic of topicList(snapshot.settings, snapshot.catalog.articles))
      select.add(new Option(topic.title, topic.category))
    select.value = value || ""
  }
  function renderList() {
    const query = $("search").value.trim().toLocaleLowerCase()
    const topics = topicList(snapshot.settings, snapshot.catalog.articles),
      label = (category) => topics.find((topic) => topic.category === category)?.title || category
    const list = snapshot.catalog.articles
      .filter(
        (article) =>
          (articleScope === "published"
            ? article.published
            : articleScope === "private"
              ? !article.published && !article.draft && !article.draftOf
              : !article.published && (article.draft || article.draftOf)) &&
          [article.title, label(article.category), ...(article.tags || [])]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
    $("article-count").textContent = `${list.length} / ${snapshot.catalog.articles.length} 篇`
    $("article-list").replaceChildren()
    for (const article of list) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "article-item"
      button.setAttribute(
        "aria-current",
        String(current?.id === article.id || current?.draftOf === article.id),
      )
      const title = document.createElement("strong"),
        meta = document.createElement("span")
      title.textContent = article.title
      const hasDraft = snapshot.catalog.articles.some((item) => item.draftOf === article.id)
      meta.textContent = `${label(article.category)} · ${article.published ? (hasDraft ? "已发布 · 有草稿" : "已发布") : article.draftOf ? "修改草稿" : article.draft ? "草稿" : "私密"}`
      button.append(title, meta)
      button.onclick = () => {
        void requestArticle(article.id)
      }
      $("article-list").append(button)
    }
    const cloud =
      articleScope === "draft"
        ? (snapshot.cloudRecoveries || []).filter(
            (row) => row.kind === "article" && row.editorId.startsWith("article:"),
          )
        : []
    for (const entry of cloud) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "article-item cloud-recovery"
      const title = document.createElement("strong"),
        meta = document.createElement("span")
      title.textContent = entry.title || "未命名文章"
      meta.textContent = "云端恢复稿"
      button.append(title, meta)
      button.onclick = () => {
        if (!mayLeaveArticle()) return
        action(async () => {
          const draft = await cloudDrafts.load(entry.editorId)
          if (!draft || draft.status !== "ACTIVE")
            throw new Error("恢复稿已在另一端移除，请刷新文库。")
          const article = snapshot.catalog.articles.find((row) => row.id === draft.record.id)
          const loaded = article ? await client.read(article, snapshot) : null
          restoreRecovery(draft.record, article || null, loaded?.sha || null)
          cloudKnown.add(draft.record.id)
        })
      }
      $("article-list").append(button)
    }
    const local =
      articleScope === "draft" && storage
        ? listArticleRecoveries(storage).filter(
            (entry) => !snapshot.catalog.articles.some((article) => article.id === entry.id),
          )
        : []
    for (const entry of local) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "article-item local-recovery"
      const title = document.createElement("strong"),
        meta = document.createElement("span")
      title.textContent = entry.form.title || "未命名文章"
      meta.textContent = "本地恢复"
      button.append(title, meta)
      button.onclick = () => {
        if (!mayLeaveArticle()) return
        action(async () => restoreRecovery(entry, null, null))
      }
      $("article-list").append(button)
    }
    if (!list.length && !local.length && !cloud.length) {
      const empty = document.createElement("p")
      empty.className = "small list-empty"
      empty.textContent = query
        ? "没有匹配的文章"
        : articleScope === "draft"
          ? "暂无草稿"
          : "暂无文章"
      $("article-list").append(empty)
    }
  }
  function renderTrash() {
    const list = $("trash-list")
    list.replaceChildren()
    const records = [...trashRecords, ...listLocalTrash(storage)]
      .filter((record) => new Date(record.expiresAt).getTime() > Date.now())
      .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime())
    for (const record of records) {
      const row = document.createElement("div")
      row.className = "trash-item"
      const info = document.createElement("div"),
        title = document.createElement("strong"),
        meta = document.createElement("span")
      title.textContent = record.title
      const days = Math.max(
        1,
        Math.ceil((new Date(record.expiresAt).getTime() - Date.now()) / 86400000),
      )
      meta.className = "small"
      meta.textContent = `${record.local ? "本地草稿" : record.cloudDraft ? "云端恢复稿" : record.published ? "已发布文章" : record.private && !record.articles[0].article.draft ? "私密文章" : "草稿"} · ${new Date(record.deletedAt).toLocaleDateString("zh-CN")} · 剩余 ${days} 天`
      info.append(title, meta)
      const controls = document.createElement("div"),
        restore = document.createElement("button"),
        purge = document.createElement("button")
      restore.type = purge.type = "button"
      restore.textContent = "恢复"
      restore.title = "恢复文章及一起删除的修改草稿"
      purge.textContent = "永久删除"
      purge.title = "永久清除这份回收站存档"
      purge.className = "danger"
      restore.onclick = () =>
        action(
          async () => {
            if (record.local) {
              if (savedForm && recoveryId() === record.recovery.id)
                throw new Error("当前编辑器正在使用这篇文章，请先关闭编辑器后再恢复。")
              if (listArticleRecoveries(storage).some((entry) => entry.id === record.recovery.id))
                throw new Error("已有同名本地恢复记录，请先保存或处理后再恢复。")
              writeArticleRecovery(storage, record.recovery)
              removeLocalTrash(storage, record.id)
              renderTrash()
              message("已恢复到草稿箱。")
              await reportSaved({ kind: "draft", articleId: record.recovery.id })
              return
            }
            const result = await client.restoreTrash(record, snapshot)
            snapshot = result.snapshot
            trashRecords = trashRecords.filter((item) => item.id !== record.id)
            renderTrash()
            renderList()
            const primary = snapshot.catalog.articles.find(
              (article) => article.id === result.articleId,
            )
            const sync = await reportSaved(
              {
                kind: result.published ? "article" : "draft",
                articleId: result.articleId,
                restoredIds: result.restoredIds,
              },
              result,
            )
            message(
              sync.status === "pending"
                ? "已恢复到 GitHub，等待同步。"
                : primary?.published
                  ? "文章已恢复。"
                  : "已恢复到草稿箱。",
            )
          },
          {
            completion: {
              kind: "restore",
              panel: "trash",
              articleId: record.articleId,
              scope: record.published ? "published" : "draft",
            },
          },
        )
      purge.onclick = () => {
        if (!confirm(`永久删除“${record.title}”？此操作将清除回收站中的恢复存档。`)) return
        action(
          async () => {
            if (record.local) removeLocalTrash(storage, record.id)
            else {
              const result = await client.purgeTrash(record, snapshot)
              snapshot = result.snapshot
              trashRecords = trashRecords.filter((item) => item.id !== record.id)
            }
            renderTrash()
            message("回收站存档已永久删除。")
            await reportSaved({ kind: "purge", scope: "draft" })
          },
          { completion: { kind: "purge", panel: "trash", scope: "draft" } },
        )
      }
      restore.disabled = purge.disabled = busy
      controls.append(restore, purge)
      row.append(info, controls)
      list.append(row)
    }
    if (!records.length) {
      const empty = document.createElement("p")
      empty.className = "small"
      empty.textContent = "回收站为空"
      list.append(empty)
    }
  }
  async function refreshTrash() {
    message("正在读取回收站…")
    const activeClient = client
    const epoch = connectionEpoch
    const isCurrent = () =>
      !disposed && activeClient === client && epoch === connectionEpoch && !!activeClient.token
    // The bin has its own private/draft queries. Refresh only the Git metadata
    // it needs instead of also reloading all active notes, recoveries and jobs.
    const publicSnapshot = await activeClient.publicSnapshot()
    if (!isCurrent()) return
    const records = await activeClient.listTrash(publicSnapshot)
    if (!isCurrent()) return
    trashRecords = records
    renderTrash()
    $("status").hidden = true
  }
  function clearImages() {
    for (const image of images) if (image.preview) URL.revokeObjectURL(image.preview)
    images = []
    viewer.clear()
  }
  function showEditor(article, text, continuation) {
    tagSuggestions.hide()
    const sameArticle =
      article &&
      current &&
      (article.id === current.id ||
        article.draftOf === current.id ||
        article.id === current.draftOf)
    if (!continuation) {
      if (sameArticle) viewer.clear()
      else clearImages()
    }
    current = article ? structuredClone(article) : null
    localRecoveryOnly = false
    raw = text
    $("empty").hidden = true
    $("editor-form").hidden = false
    $("editor-heading").textContent = article
      ? article.published
        ? "编辑文章"
        : article.draft || article.draftOf
          ? "编辑草稿"
          : "私密文章"
      : "新建文章"
    $("cancel-edit").hidden = !article
    $("save-draft").hidden = false
    $("delete-draft").hidden = !!article?.published
    $("delete-draft").textContent =
      article && !article.draft && !article.draftOf ? "删除文章" : "删除草稿"
    $("delete-article").hidden = !article?.published && !article?.draftOf
    $("delete-article").textContent = article?.draftOf ? "删除已发布文章" : "删除文章"
    if (!article) publishedDeletion = null
    $("unpublish").hidden = !article?.published && !article?.draftOf
    $("publication-state").textContent = article?.published
      ? "已发布"
      : article?.draftOf
        ? "修改草稿"
        : article
          ? article.draft
            ? "草稿"
            : "私密"
          : "未发布"
    for (const key of ["title", "description"]) $(key).value = article?.[key] || ""
    renderCategories(article?.category)
    $("slug").value = article?.id || `note-${crypto.randomUUID()}`
    $("slug").readOnly = !!article
    $("date").value = article?.created || article?.date || date()
    $("published").value = String(article?.published ?? false)
    $("tags").value = (article?.tags || []).join(", ")
    $("featured").checked = article?.featured || false
    $("body").value = text
    $("view-live").hidden = !article?.published && !article?.draftOf
    $("view-live").href = new URL("notes/" + (article?.draftOf || article?.id || ""), siteBase).href
    $("reload").hidden = !article
    $("link-fields").hidden = true
    if (!continuation) history.reset($("body").value)
    savedForm = formValue()
    if (continuation) {
      for (const key of formKeys) {
        if (["slug", "published"].includes(key)) continue
        if (continuation.form[key] === continuation.submitted[key]) continue
        const input = $(key)
        if (input.type === "checkbox") input.checked = continuation.form[key]
        else input.value = continuation.form[key]
      }
      $("body").setSelectionRange(continuation.selection.start, continuation.selection.end)
      $("body").scrollTop = continuation.scrollTop
    }
    updateState()
    preview()
    articleVersions.reset()
    renderList()
    renderImageDestination()
  }
  function renderImageDestination() {
    $("image-destination").textContent = "私密附件"
    $("insert-image").title = "上传为私密附件，公开文章时再确认附件公开"
  }
  async function loadArticle(id, restore = true, committed, continuation) {
    if (!committed) message("正在载入…")
    snapshot = committed || (await client.snapshot())
    const draft = snapshot.catalog.articles.find((item) => item.draftOf === id)
    const article = draft || snapshot.catalog.articles.find((item) => item.id === id)
    let recovery =
      restore &&
      storage &&
      (readArticleRecovery(storage, id) || (article && readArticleRecovery(storage, article.id)))
    const cloudId = article?.id || id
    if (
      restore &&
      !recovery &&
      cloudDrafts &&
      snapshot.cloudRecoveries?.some((row) => row.editorId === `article:${cloudId}`)
    ) {
      const loaded = await cloudDrafts.load(`article:${cloudId}`)
      if (loaded?.status === "ACTIVE") {
        recovery = loaded.record
        cloudKnown.add(cloudId)
      }
    }
    if (!article) {
      if (recovery) {
        restoreRecovery(recovery, null, null)
        return
      }
      throw new Error("文章已移除，请重新载入。")
    }
    const loaded = await client.read(article, snapshot)
    openedSha = loaded.sha
    if (recovery) restoreRecovery(recovery, article, loaded.sha)
    else {
      showEditor(article, loaded.text, continuation)
      const published = article.published
        ? article
        : snapshot.catalog.articles.find((item) => item.id === article.draftOf && item.published)
      publishedDeletion = published
        ? {
            opened: structuredClone(published),
            openedSha: snapshot.entries.get(`library/${published.file}`)?.sha,
            openedDrafts: snapshot.catalog.articles
              .filter((item) => item.draftOf === published.id)
              .map((item) => ({
                article: structuredClone(item),
                sha: snapshot.entries.get(`library/${item.file}`)?.sha,
              })),
          }
        : null
      $("status").hidden = true
    }
  }
  function restoreRecovery(recovery, latestArticle, latestSha) {
    const restored = recoveredBaseline(recovery, latestArticle, latestSha)
    // A recovery lacks the original linked-draft set. Never infer one from a newer remote read.
    publishedDeletion = null
    openedSha = restored.openedSha
    showEditor(restored.article, restored.raw)
    localRecoveryOnly = !latestArticle
    if (localRecoveryOnly) {
      // This recovery has no remote entry. Deleting it must never touch the old source version.
      $("delete-draft").hidden = false
      $("delete-draft").textContent = "删除本地草稿"
      $("delete-article").hidden = true
      $("unpublish").hidden = true
    }
    // Never swap a restored edit's baseline for the freshly read remote version.
    current = restored.article
    images = (restored.attachments || [])
      .filter(
        (attachment) => !current?.attachments?.some((item) => item.fileId === attachment.fileId),
      )
      .map((attachment) => ({ url: attachment.source, attachment }))
    raw = restored.raw
    savedForm = restored.savedForm
    for (const key of formKeys) {
      const input = $(key)
      if (
        key === "category" &&
        ![...input.options].some((option) => option.value === restored.form[key])
      )
        input.add(new Option(restored.form[key], restored.form[key]))
      if (input.type === "checkbox") input.checked = restored.form[key]
      else input.value = restored.form[key]
    }
    history.reset($("body").value)
    updateState()
    preview()
    message(
      restored.stale
        ? "已恢复修改；远端文章已有更新，请先下载当前编辑再重新载入。"
        : "已恢复未保存的文章修改。",
      restored.stale,
    )
  }
  function sourceText() {
    return editorSourceText(raw, $("body").value)
  }
  function updateState() {
    $("save-state").textContent = !current || articleDirty() ? "未保存" : "已保存"
    $("word-count").textContent = `${Array.from($("body").value).length.toLocaleString()} 字符`
    clearTimeout(recoveryTimer)
    recoveryTimer = setTimeout(persistRecovery, 250)
  }
  async function preview() {
    const version = ++previewVersion
    if ($("writing-area").dataset.view === "edit") return
    $("preview-state").textContent = "预览中"
    try {
      await viewer.render($("body").value)
      if (version === previewVersion) $("preview-state").textContent = ""
    } catch {
      if (version === previewVersion) $("preview-state").textContent = "预览失败"
    }
  }
  function schedulePreview() {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(preview, 160)
  }
  function bodyState() {
    const input = $("body")
    return { text: input.value, start: input.selectionStart, end: input.selectionEnd }
  }
  function applyState(state, record = true) {
    const input = $("body")
    input.value = state.text
    input.focus()
    input.setSelectionRange(state.start, state.end)
    if (record) history.record(state, "format")
    updateState()
    preview()
  }
  function format(command, extra = "", selection) {
    try {
      const input = $("body")
      const [start, end] = selection || [input.selectionStart, input.selectionEnd]
      applyState(formatSelection(input.value, start, end, command, extra))
      return true
    } catch (error) {
      message(error.message, true)
      return false
    }
  }
  function closeEditor(discard = false) {
    tagSuggestions.hide()
    if (discard) {
      if (savedForm) discardRecovery()
    } else persistRecovery()
    clearImages()
    current = null
    openedSha = null
    publishedDeletion = null
    localRecoveryOnly = false
    raw = ""
    savedForm = ""
    articleVersions.reset()
    $("editor-form").hidden = true
    $("empty").hidden = false
    $("status").hidden = true
    root.classList.remove("focus-editor")
    if (snapshot) renderList()
  }
  function setScope(scope) {
    articleScope = scope
    $("list-title").textContent =
      scope === "draft" ? "草稿箱" : scope === "private" ? "私密文库" : "文章"
    $("tab-articles").setAttribute("aria-current", scope === "published" ? "page" : "false")
    $("tab-drafts").setAttribute("aria-current", scope === "draft" ? "page" : "false")
    $("tab-private").setAttribute("aria-current", scope === "private" ? "page" : "false")
    $("tab-settings").setAttribute("aria-current", "false")
    $("tab-trash").setAttribute("aria-current", "false")
    renderList()
  }
  function showMode(mode) {
    tagSuggestions.hide()
    const scope = mode === "drafts" ? "draft" : mode === "private" ? "private" : "published"
    if (mode !== "settings" && scope !== articleScope) {
      if (!mayLeaveArticle()) return false
      closeEditor(true)
    }
    $("trash-workspace").hidden = mode !== "trash"
    $("tab-trash").setAttribute("aria-current", mode === "trash" ? "page" : "false")
    $("workspace").hidden = mode === "settings" || mode === "trash"
    $("settings-workspace").hidden = mode !== "settings"
    settings.setVisible(visible && mode === "settings")
    if (mode === "settings" && backups)
      void backups.load().catch((error) => message(error.message, true))
    if (mode === "trash") {
      for (const tab of ["tab-articles", "tab-private", "tab-drafts", "tab-settings"])
        $(tab).setAttribute("aria-current", "false")
      renderTrash()
      return action(refreshTrash, { label: "正在读取回收站…" })
    }
    if (mode !== "settings") setScope(scope)
    else {
      $("tab-articles").setAttribute("aria-current", "false")
      $("tab-drafts").setAttribute("aria-current", "false")
      $("tab-private").setAttribute("aria-current", "false")
    }
    $("tab-settings").setAttribute("aria-current", mode === "settings" ? "page" : "false")
    root.classList.remove("focus-editor")
    $("focus-mode").setAttribute("aria-pressed", "false")
    $("focus-mode").textContent = "专注"
  }
  function cancelLibraryPreparation() {
    libraryPromise = null
  }
  function trackReadyLibrary() {
    publisher.restore()
    for (const job of client.jobs || [])
      if (job.status === "completed" && !queuedJobs.has(job.id)) completedJobs.add(job.id)
    monitorJobs()
  }
  async function prepareLibrary() {
    if (!client || disposed) throw new Error("请登录后再打开文章文库。")
    if (client.personalReady) {
      if (snapshot !== client.currentSnapshot) {
        snapshot = client.currentSnapshot
        if (!$("workspace").hidden) renderList()
        trackReadyLibrary()
      }
      return
    }
    if (!libraryPromise) {
      const connection = client,
        epoch = connectionEpoch
      const pending = (async () => {
        const loaded = await connection.ensureSnapshot()
        if (disposed || client !== connection || connectionEpoch !== epoch || !connection.token)
          throw new Error("登录状态已变化，已取消文库载入。")
        snapshot = loaded
        // Completing owner metadata must never reset the working layout or its
        // original SHA. Hidden article lists need no eager DOM rebuild.
        if (!$("workspace").hidden) renderList()
        if (current) renderCategories($("category").value)
        trackReadyLibrary()
      })()
      libraryPromise = pending
      void pending
        .finally(() => {
          if (libraryPromise === pending) libraryPromise = null
        })
        .catch(() => {})
    }
    await libraryPromise
  }
  async function prepare(mode) {
    if (mode !== "settings") await prepareLibrary()
  }
  async function connect(credentials, { mode = "articles" } = {}) {
    if (!credentials) return
    if (busy || disposed) throw new Error("操作正在进行，请稍后重新登录。")
    const epoch = ++connectionEpoch
    cancelLibraryPreparation()
    connecting = true
    const assertCurrent = () => {
      if (disposed || connectionEpoch !== epoch) throw new Error("登录状态已变化，已取消载入。")
    }
    lock(true)
    const connection = new PersonalLibrary(credentials.token, undefined, {
      siteBase,
      tokenExpiresAt: credentials.expiresAt,
    })
    try {
      const [account, loaded] = await Promise.all([
        connection.authenticate(),
        client ? null : mode === "settings" ? connection.settingsSnapshot() : connection.snapshot(),
      ])
      assertCurrent()
      if (credentials.login && credentials.login !== account) {
        connection.token = ""
        throw new Error("登录账号与授权返回不一致，请重新登录。")
      }
      if (!client) {
        snapshot = loaded
        client = connection
        backups = createBackupManager({
          root: $("backup-manager"),
          getClient: () => client,
          notify: (text, error) => {
            message(text, error)
            options.onProgress?.(text, {
              state: error ? "error" : /已(?:完成|下载)/.test(text) ? "done" : "working",
            })
          },
        })
        cloudDrafts = createDurableDraftController({
          request: (...args) => client.personalRequest(...args),
          onState(state) {
            if (disposed || !state.editorId.endsWith(`:${recoveryId()}`)) return
            $("save-state").textContent =
              state.state === "saved"
                ? "云端已暂存"
                : state.state === "saving"
                  ? "正在云端暂存"
                  : state.state === "conflict"
                    ? "暂存冲突，请保留当前编辑"
                    : state.state === "error"
                      ? "云端未暂存，浏览器副本已保留"
                      : state.state === "deleted"
                        ? articleDirty()
                          ? "未保存"
                          : "已保存"
                        : $("save-state").textContent
          },
        })
        settings.load(snapshot)
        showMode(mode === "settings" ? "settings" : "articles")
      } else {
        // Reauthentication preserves unsaved text/settings and their original conflict baselines.
        connection.currentSnapshot = client.currentSnapshot || snapshot
        connection.personalReady = client.personalReady
        connection.recoveries = client.recoveries
        connection.jobs = client.jobs
        if (snapshot.settingsOnly && connection.personalReady) snapshot = connection.currentSnapshot
        client.token = ""
        client = connection
      }
      void rememberSession(siteBase, credentials)
      session = { account, expiresAt: credentials.expiresAt, serverTime: credentials.serverTime }
      options.onSession?.({ ...session })
      $("account").textContent = account
      $("logout").hidden = false
      $("reconnect").hidden = false
      $("login-panel").hidden = true
      $("admin-tabs").hidden = false
      $("status").hidden = true
      if (client.personalReady) trackReadyLibrary()
    } catch (error) {
      connection.token = ""
      throw error
    } finally {
      connecting = false
      lock(false)
    }
  }
  function login() {
    options.onReauthenticate?.()
  }
  function logout() {
    connectionEpoch++
    cancelLibraryPreparation()
    queuedJobs.clear()
    void clearSession(siteBase)
    persistRecovery()
    clearTimeout(cloudTimer)
    clearTimeout(jobTimer)
    cloudDrafts?.dispose()
    cloudDrafts = null
    backups?.dispose()
    backups = null
    cloudKnown.clear()
    if (client) client.token = ""
    client = null
    session = null
    clearImages()
    closeEditor()
    $("login-panel").hidden = false
    $("workspace").hidden = true
    $("settings-workspace").hidden = true
    settings.setVisible(false)
    $("trash-workspace").hidden = true
    $("admin-tabs").hidden = true
    $("logout").hidden = true
    $("reconnect").hidden = true
    $("account").textContent = ""
    publication.hidden = true
    options.onSession?.(null)
  }
  $("login-button").onclick = login
  $("reconnect").onclick = login
  $("logout").onclick = () => {
    if (canClose()) {
      logout()
      options.onLogout?.()
    }
  }
  let modeSerial = 0
  const selectMode = (mode) => {
    const serial = ++modeSerial
    if (!client || busy) return
    if (mode === "settings" || client.personalReady) return showMode(mode)
    const connection = client,
      epoch = connectionEpoch
    return action(() => prepareLibrary(), { label: "正在读取文章文库…" }).then(() => {
      if (
        serial === modeSerial &&
        client === connection &&
        epoch === connectionEpoch &&
        client?.personalReady &&
        !busy
      )
        return showMode(mode)
    })
  }
  $("tab-articles").onclick = () => selectMode("articles")
  $("tab-drafts").onclick = () => selectMode("drafts")
  $("tab-private").onclick = () => selectMode("private")
  $("tab-settings").onclick = () => selectMode("settings")
  $("tab-trash").onclick = () => selectMode("trash")
  $("reload-trash").onclick = () => action(refreshTrash, { label: "正在读取回收站…" })
  $("search").oninput = renderList
  function newArticle() {
    if (!client?.personalReady || busy || !mayLeaveArticle()) return false
    closeEditor(true)
    showMode("articles")
    openedSha = null
    showEditor(null, "")
    $("title").focus()
    return true
  }
  $("new-article").onclick = newArticle
  $("reload").onclick = () => {
    if (current && mayLeaveArticle()) action(() => loadArticle(current.id, false))
  }
  $("download").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([sourceText()], { type: "text/markdown;charset=utf-8" }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = `${$("title").value || "未命名"}.md`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  for (const button of root.querySelectorAll("[data-view]")) {
    if (button.tagName !== "BUTTON") continue
    button.onclick = () => {
      const view = button.dataset.view
      $("writing-area").dataset.view = view
      $("format-toolbar").hidden = view === "preview"
      for (const other of root.querySelectorAll("button[data-view]"))
        other.setAttribute("aria-pressed", String(other === button))
      preview()
    }
  }
  $("focus-mode").onclick = () => {
    const enabled = root.classList.toggle("focus-editor")
    $("focus-mode").setAttribute("aria-pressed", String(enabled))
    $("focus-mode").textContent = enabled ? "退出专注" : "专注"
  }
  for (const button of root.querySelectorAll("[data-format]"))
    button.onclick = () => format(button.dataset.format)
  $("heading-format").onchange = () => {
    if ($("heading-format").value) format($("heading-format").value)
    $("heading-format").value = ""
  }
  $("undo").onclick = () => applyState(history.undo(), false)
  $("redo").onclick = () => applyState(history.redo(), false)
  $("insert-link").onclick = () => {
    linkSelection = [$("body").selectionStart, $("body").selectionEnd]
    $("link-fields").hidden = false
    $("link-url").focus()
  }
  $("cancel-link").onclick = () => {
    $("link-fields").hidden = true
    $("link-url").value = ""
    $("body").focus()
  }
  $("apply-link").onclick = () => {
    if (format("link", $("link-url").value.trim(), linkSelection)) {
      $("link-fields").hidden = true
      $("link-url").value = ""
    }
  }
  $("link-url").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      $("apply-link").click()
    } else if (event.key === "Escape") $("cancel-link").click()
  }
  $("body").oninput = () => {
    history.record(bodyState())
    updateState()
    schedulePreview()
  }
  listen($("editor-form"), "input", updateState)
  $("body").onkeydown = (event) => {
    if (event.isComposing) return
    if (event.key === "Tab") {
      event.preventDefault()
      format(event.shiftKey ? "outdent" : "indent")
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (["b", "i", "k", "z", "y"].includes(key)) event.preventDefault()
    if (key === "b") format("bold")
    if (key === "i") format("italic")
    if (key === "k") $("insert-link").click()
    if (key === "z") applyState(event.shiftKey ? history.redo() : history.undo(), false)
    if (key === "y") applyState(history.redo(), false)
  }
  listen(window, "keydown", (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s" &&
      client &&
      root.isConnected &&
      root.getClientRects().length > 0 &&
      !root.closest("[hidden]")
    ) {
      event.preventDefault()
      if (!busy) {
        if (!$("settings-workspace").hidden) $("site-form").requestSubmit()
        else if (!$("editor-form").hidden) $("editor-form").requestSubmit($("save-draft"))
      }
    }
  })
  let scrolling = false
  for (const [source, target] of [
    [$("body"), $("preview")],
    [$("preview"), $("body")],
  ])
    listen(source, "scroll", () => {
      if (scrolling || !$("sync-scroll").checked || $("writing-area").dataset.view !== "split")
        return
      scrolling = true
      const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight)
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight)
      requestAnimationFrame(() => (scrolling = false))
    })
  $("insert-image").onclick = () => {
    imageSelection = [$("body").selectionStart, $("body").selectionEnd]
    $("image").click()
  }
  $("image").onchange = () => {
    const files = [...$("image").files]
    $("image").value = ""
    const selection = imageSelection
    imageSelection = null
    insertImages(files, selection)
  }
  listen($("body"), "paste", (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean)
    if (!files.length) return
    event.preventDefault()
    if (busy) {
      message("当前操作正在进行，请完成后再粘贴图片。")
      return
    }
    insertImages(files)
  })
  function insertImages(files, selection) {
    if (!files.length || busy) return
    const input = $("body")
    const [start, end] = selection || [input.selectionStart, input.selectionEnd]
    action(async () => {
      message("正在读取图片…")
      const prepared = []
      for (const file of files) prepared.push(await prepareImage(file, { binaryOnly: true }))
      const uploaded = await client.uploadPrivateImages(
        files,
        (index, total) => message(`正在上传图片 ${index} / ${total}…`),
        prepared,
      )
      for (const [index, image] of uploaded.entries()) {
        if (!images.some((item) => item.url === image.url))
          images.push({
            url: image.url,
            preview: URL.createObjectURL(files[index]),
            attachment: image.attachment,
          })
      }
      input.setRangeText(
        "\n" + uploaded.map((image) => `![${image.alt}](${image.url})`).join("\n") + "\n",
        start,
        end,
        "end",
      )
      history.record(bodyState(), "image")
      updateState()
      preview()
      renderImageDestination()
      message(
        uploaded.length === 1 ? "图片已上传并插入。" : `${uploaded.length} 张图片已上传并插入。`,
      )
    })
  }
  $("editor-form").onsubmit = (event) => {
    event.preventDefault()
    if (busy) return
    const draft = event.submitter?.id === "save-draft"
    const published = !draft && event.submitter?.id !== "save-private"
    if (!published) {
      if (!$("title").value.trim()) $("title").value = "未命名文章"
      if (!$("category").value) {
        if (![...$("category").options].some((option) => option.value === "未分类"))
          $("category").add(new Option("未分类", "未分类"))
        $("category").value = "未分类"
      }
    }
    const edited = {
      ...(current || {}),
      id: $("slug").value.trim(),
      file: current?.file || `notes/网页新建/${$("slug").value.trim()}.md`,
      title: $("title").value.trim(),
      category: $("category").value,
      description: $("description").value.trim(),
      date: current?.date || date(),
      created: $("date").value,
      tags: $("tags")
        .value.split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      published,
      ...(draft ? { draft: true } : { draft: false }),
      attachments: editorAttachments(),
      featured: $("featured").checked,
      modified:
        !current || sourceText() !== raw
          ? date()
          : current.modified || current.created || current.date,
    }
    const submitted = {
      form: readForm(),
      text: sourceText(),
      opened: current && structuredClone(current),
      openedSha,
      recoveryId: recoveryId(),
    }
    if (published) {
      delete edited.draftOf
      delete edited.draftBaseline
    }
    const privateAttachments = edited.attachments.some(
      (attachment) => !attachment.publicUrl && attachment.fileId,
    )
    if (
      published &&
      privateAttachments &&
      !confirm("将这些私密附件上传公开图床，任何人可通过链接访问。是否继续公开文章及附件？")
    )
      return
    try {
      validateCatalog({ version: 2, articles: [edited] })
    } catch (error) {
      message(error.message, true)
      return
    }
    persistRecovery()
    action(
      async () => {
        if (published) {
          delete edited.draftOf
          delete edited.draftBaseline
        }
        message(published ? "正在发布文章…" : "正在保存草稿…")
        let nextId = edited.id
        let result
        if (draft && submitted.opened?.published) {
          const id = `draft-${crypto.randomUUID()}`
          const draft = {
            ...edited,
            id,
            file: `notes/网页草稿/${id}.md`,
            draftOf: submitted.opened.id,
            draftBaseline: { article: submitted.opened, sha: submitted.openedSha },
            draft: true,
          }
          result = await client.save({
            opened: null,
            openedSha: null,
            edited: draft,
            text: submitted.text,
            publishAttachments: privateAttachments,
          })
          nextId = id
        } else if (published && submitted.opened?.draftOf) {
          result = await client.publishDraft({
            opened: submitted.opened,
            openedSha: submitted.openedSha,
            edited,
            text: submitted.text,
            publishAttachments: privateAttachments,
          })
          nextId = result.articleId
        } else {
          result = await client.save({
            opened: submitted.opened,
            openedSha: submitted.openedSha,
            edited,
            text: submitted.text,
            publishAttachments: privateAttachments,
          })
        }
        const continuation = {
          submitted: submitted.form,
          form: readForm(),
          selection: bodyState(),
          scrollTop: $("body").scrollTop,
        }
        const editingId = result.privateId || nextId
        setScope(published || draft ? "draft" : "private")
        $("workspace").hidden = false
        $("settings-workspace").hidden = true
        await loadArticle(editingId, false, result.snapshot, continuation)
        discardRecovery(submitted.recoveryId)
        persistRecovery()
        const sync = await reportSaved(
          {
            kind: published ? "article" : "draft",
            scope: !published ? "private" : "published",
            articleId: nextId,
          },
          result,
        )
        const retained = articleDirty() ? "当前后续修改尚未保存。" : ""
        message(
          !published
            ? `${draft ? "草稿" : "私密原文"}已保存。${retained}`
            : sync.status === "synchronized"
              ? `文章已上线。${retained}`
              : sync.status === "pending"
                ? `原文已保存，正在后台发布，可关闭网页。${retained}`
                : `已保存，正在部署。${retained}`,
          false,
          sync.status === "static"
            ? "https://github.com/LeiGuo0812/howard-notes/actions"
            : undefined,
        )
      },
      {
        editable: true,
        completion: { kind: published ? "article" : "draft", articleId: edited.id },
      },
    )
  }
  $("cancel-edit").onclick = () => {
    if (mayLeaveArticle()) {
      closeEditor(true)
      options.onClose?.()
    }
  }
  $("unpublish").onclick = () => {
    if (
      (!current?.published && !current?.draftOf) ||
      !mayLeaveArticle() ||
      !confirm(
        "将这篇文章改为私密？原文会保留在私密文库。已公开的 Git 历史和图片链接无法自动收回。",
      )
    )
      return
    action(
      async () => {
        const id = current.draftOf || current.id
        const result = await client.save({
          opened: current,
          openedSha,
          edited: { ...current, published: false, draft: false },
          text: raw,
        })
        discardRecovery()
        savedForm = ""
        setScope("private")
        await loadArticle(id, false, result.snapshot)
        const sync = await reportSaved({ kind: "unpublish", articleId: id }, result)
        message(sync.status === "pending" ? "已保存撤下操作，等待同步。" : "文章已撤下。")
      },
      { completion: { kind: "unpublish", articleId: current?.id } },
    )
  }
  $("delete-draft").onclick = () => {
    if (!client || busy || (current?.published && !localRecoveryOnly)) return
    if (
      !confirm(
        localRecoveryOnly
          ? "将未保存的修改移入回收站？远端原文不受影响，可在 30 天内恢复。"
          : "将这篇文章移入回收站？可在 30 天内恢复。",
      )
    )
      return
    if (!current || localRecoveryOnly) {
      action(
        async () => {
          const id = recoveryId()
          const recovery = {
            id,
            article: current,
            openedSha,
            raw,
            savedForm,
            form: readForm(),
            attachments: editorAttachments(),
            kind: "article",
          }
          clearTimeout(cloudTimer)
          if (cloudDrafts) {
            await cloudDrafts.save(`article:${id}`, recovery)
            await cloudDrafts.remove(`article:${id}`)
            cloudKnown.delete(id)
            snapshot.cloudRecoveries = (snapshot.cloudRecoveries || []).filter(
              (row) => row.editorId !== `article:${id}`,
            )
          } else trashLocalRecovery(storage, recovery)
          closeEditor(true)
          options.onClose?.()
          await reportSaved({ kind: "delete", scope: "private", articleId: id }, { private: true })
        },
        { completion: { kind: "delete", scope: "private" } },
      )
      return
    }
    action(
      async () => {
        const deletedId = current.id
        const openedDrafts = snapshot.catalog.articles
          .filter((article) => article.draftOf === current.id)
          .map((article) => ({
            article: structuredClone(article),
            sha: snapshot.entries.get(`library/${article.file}`)?.sha,
          }))
        const result = await client.removeDraft({ opened: current, openedSha, openedDrafts })
        if (result.snapshot) snapshot = result.snapshot
        snapshot.catalog.articles = snapshot.catalog.articles.filter(
          (article) => article.id !== deletedId,
        )
        closeEditor(true)
        setScope("draft")
        let refreshed = true
        if (!result.snapshot) {
          try {
            snapshot = await client.snapshot()
          } catch {
            refreshed = false
          }
        }
        renderList()
        await reportSaved(
          {
            kind: "delete",
            scope: "draft",
            articleId: deletedId,
            removedIds: result.removedIds || [deletedId],
          },
          result,
        )
        if (result.record) trashRecords.unshift(result.record)
        message(refreshed ? "草稿已移入回收站。" : "草稿已移入回收站；列表刷新失败，请重新载入。")
      },
      { completion: { kind: "delete", scope: "draft", articleId: current?.id } },
    )
  }
  $("delete-article").onclick = () => {
    if (!client || busy || (!current?.published && !current?.draftOf)) return
    if (!publishedDeletion) {
      persistRecovery()
      message("请先下载当前编辑，再重新载入文章确认最新版本，然后删除。", true)
      return
    }
    const baseline = structuredClone(publishedDeletion)
    const drafts = baseline.openedDrafts.length
      ? `及 ${baseline.openedDrafts.length} 篇修改草稿`
      : ""
    if (
      !confirm(
        `将“${baseline.opened.title}”${drafts}移入回收站？可在 30 天内恢复。\n未保存的修改将被丢弃。`,
      )
    )
      return
    action(
      async () => {
        message("正在删除…")
        const result = await client.removePublishedArticle(baseline)
        if (result.snapshot) snapshot = result.snapshot
        for (const id of result.removedIds) discardRecovery(id)
        // The commit already succeeded. Clear the deleted editor even if a follow-up read fails.
        snapshot.catalog.articles = snapshot.catalog.articles.filter(
          (article) => !result.removedIds.includes(article.id),
        )
        closeEditor(true)
        setScope("published")
        $("workspace").hidden = false
        $("settings-workspace").hidden = true
        let refreshed = true
        if (!result.snapshot) {
          try {
            snapshot = await client.snapshot()
          } catch {
            refreshed = false
          }
        }
        renderList()
        if (result.record) trashRecords.unshift(result.record)
        const sync = await reportSaved(
          {
            kind: "delete",
            scope: "published",
            articleId: baseline.opened.id,
            removedIds: result.removedIds,
          },
          result,
        )
        message(
          sync.status === "synchronized"
            ? "文章已删除并上线。"
            : sync.status === "pending"
              ? "已保存删除操作，等待同步。"
              : refreshed
                ? "文章已删除，正在部署。"
                : "文章已删除，正在部署；列表刷新失败，请重新载入。",
          false,
          sync.status === "static"
            ? "https://github.com/LeiGuo0812/howard-notes/actions"
            : undefined,
        )
      },
      { completion: { kind: "delete", scope: "published", articleId: baseline.opened.id } },
    )
  }
  function canClose() {
    if (busy) {
      message("操作正在进行，请完成后再关闭。", true)
      return false
    }
    if (!dirty()) return true
    persistRecovery()
    return confirm("关闭编辑？未发布的修改会保存在当前浏览器中。")
  }
  async function requestArticle(id) {
    if (!client) return false
    if (busy) {
      message("操作正在后台进行，请稍后切换文章。")
      return false
    }
    if (!client.personalReady) {
      try {
        await prepareLibrary()
      } catch (error) {
        message(error.message, true)
        return false
      }
      return requestArticle(id)
    }
    if (current && (current.id === id || current.draftOf === id)) {
      $("workspace").hidden = false
      $("settings-workspace").hidden = true
      setScope(
        current.published ? "published" : current.draft || current.draftOf ? "draft" : "private",
      )
      return true
    }
    if (!mayLeaveArticle()) return false
    $("workspace").hidden = false
    $("settings-workspace").hidden = true
    $("trash-workspace").hidden = true
    const requested = snapshot.catalog.articles.find((article) => article.id === id)
    setScope(
      requested?.published === false
        ? requested.draft || requested.draftOf
          ? "draft"
          : "private"
        : "published",
    )
    return action(() => loadArticle(id), { label: "正在载入文章…" })
  }
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") persistRecovery()
  })
  listen(window, "beforeunload", (event) => {
    persistRecovery()
    if (dirty()) {
      event.preventDefault()
      event.returnValue = ""
    }
  })
  return {
    connect,
    prepare,
    isLibraryReady: () => !!client?.personalReady && !snapshot?.settingsOnly,
    openArticle: requestArticle,
    showMode: (mode) =>
      !busy && client && (mode === "settings" || client.personalReady) && showMode(mode),
    newArticle,
    dirty,
    isBusy: () => busy,
    canClose,
    closeEditor: () => !busy && closeEditor(),
    logout: () => (!busy || connecting) && logout(),
    cancelConnection() {
      tagSuggestions.hide()
      connectionEpoch++
      cancelLibraryPreparation()
      if (client) client.token = ""
      clearTimeout(jobTimer)
    },
    getSession: () => session && { ...session },
    getOwnerAccess: () =>
      session && client?.token && { account: session.account, token: client.token },
    currentArticle: () => current && structuredClone(current),
    retrySynchronization,
    setVisible(value) {
      if (!value) tagSuggestions.hide()
      if (!value) modeSerial++
      visible = !!value
      settings.setVisible(visible && !$("settings-workspace").hidden)
    },
    dispose() {
      if (disposed) return
      persistRecovery()
      disposed = true
      tagSuggestions.destroy()
      connectionEpoch++
      cancelLibraryPreparation()
      clearTimeout(previewTimer)
      clearTimeout(cloudTimer)
      clearTimeout(jobTimer)
      cloudDrafts?.dispose()
      backups?.dispose()
      clearTimeout(recoveryTimer)
      previewVersion++
      listeners.abort()
      settings.dispose()
      publisher.dispose()
      articleVersions.dispose()
      publication.remove()
      clearImages()
      viewer.destroy()
      if (client) client.token = ""
      client = null
      session = null
      root.classList.remove("focus-editor")
      for (const element of [root, ...root.querySelectorAll("*")]) {
        for (const key of ["onclick", "oninput", "onchange", "onkeydown", "onsubmit"])
          element[key] = null
      }
    },
  }
}
