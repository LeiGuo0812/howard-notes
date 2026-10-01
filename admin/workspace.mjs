import { GitHubLibrary } from "./github.mjs"
import { validateCatalog } from "../scripts/lib/catalog.mjs"
import { topicList } from "../scripts/lib/site-settings.mjs"
import { formatSelection, TextHistory } from "./formatting.mjs"
import { createPreview } from "./preview.mjs"
import { createSettings } from "./settings.mjs"
import { GitHubImageHost, prepareImage } from "./images.mjs"
import { imageHostSettings } from "../scripts/lib/image-host.mjs"
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
    recoveryError = false,
    recoveryTimer
  let client,
    snapshot,
    current = null,
    openedSha = null,
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
  const date = () =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())
  const formKeys = RECOVERY_FIELDS
  const formValue = () =>
    JSON.stringify(
      formKeys.map((key) => ($(key).type === "checkbox" ? $(key).checked : $(key).value)),
    )
  const articleDirty = () => !!savedForm && formValue() !== savedForm
  const settings = createSettings({
    root,
    siteBase,
    getSnapshot: () => ({ ...snapshot, client }),
    action,
    message,
    refresh: async () => (snapshot = await client.snapshot()),
    onSaved: (_snapshot, result) => {
      renderList()
      renderCategories($("category").value)
      renderImageDestination()
      options.onSaved?.({ kind: "settings", commit: result?.sha })
    },
  })
  const dirty = () => !!client && (articleDirty() || settings.dirty())
  const viewer = createPreview($("preview"), () => ({
    client,
    snapshot,
    siteBase,
    articles: snapshot?.catalog.articles || [],
    images,
    articleFile:
      current?.draftBaseline?.article.file ||
      current?.file ||
      `notes/网页新建/${$("slug").value}.md`,
  }))
  function message(text, error = false, href) {
    const el = $("status")
    el.hidden = false
    el.className = error ? "error" : ""
    el.textContent = text
    if (href) {
      const link = document.createElement("a")
      link.href = href
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      link.textContent = "部署进度 ↗"
      el.append(link)
    }
  }
  function lock(value) {
    busy = value
    for (const el of root.querySelectorAll("button,input,select,textarea"))
      el.disabled = value || el.dataset.boundary === "true"
  }
  async function action(callback) {
    if (busy) return
    lock(true)
    try {
      return await callback()
    } catch (error) {
      message(error.message || "操作失败。", true)
      if (client && error.status === 401) $("reconnect").hidden = false
    } finally {
      lock(false)
    }
  }
  const recoveryId = () => current?.id || $("slug").value
  function discardRecovery(id = recoveryId()) {
    clearTimeout(recoveryTimer)
    if (!storage || !id) return
    try {
      clearArticleRecovery(storage, id)
    } catch {}
  }
  function persistRecovery() {
    clearTimeout(recoveryTimer)
    if (!savedForm || disposed || !storage) return
    try {
      if (!articleDirty()) {
        discardRecovery()
        return
      }
      writeArticleRecovery(storage, {
        id: recoveryId(),
        article: current,
        openedSha,
        raw,
        savedForm,
        form: Object.fromEntries(
          formKeys.map((key) => [key, $(key).type === "checkbox" ? $(key).checked : $(key).value]),
        ),
      })
      recoveryError = false
    } catch (error) {
      if (!recoveryError) message(error.message || "无法在当前浏览器暂存，请下载当前编辑。", true)
      recoveryError = true
    }
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
          (articleScope === "published") === article.published &&
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
      meta.textContent = `${label(article.category)} · ${article.published ? (hasDraft ? "已发布 · 有草稿" : "已发布") : article.draftOf ? "修改草稿" : "草稿"}`
      button.append(title, meta)
      button.onclick = () => {
        void requestArticle(article.id)
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
    if (!list.length && !local.length) {
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
  function clearImages() {
    for (const image of images) URL.revokeObjectURL(image.preview)
    images = []
    viewer.clear()
  }
  function showEditor(article, text) {
    const sameArticle =
      article &&
      current &&
      (article.id === current.id ||
        article.draftOf === current.id ||
        article.id === current.draftOf)
    if (sameArticle) viewer.clear()
    else clearImages()
    current = article ? structuredClone(article) : null
    raw = text
    $("empty").hidden = true
    $("editor-form").hidden = false
    $("editor-heading").textContent = article
      ? article.published
        ? "编辑文章"
        : "编辑草稿"
      : "新建文章"
    $("cancel-edit").hidden = !article
    $("save-draft").hidden = false
    $("delete-draft").hidden = !!article?.published
    $("unpublish").hidden = !article?.published
    $("publication-state").textContent = article?.published
      ? "已发布"
      : article?.draftOf
        ? "修改草稿"
        : article
          ? "草稿"
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
    history.reset($("body").value)
    savedForm = formValue()
    updateState()
    preview()
    renderList()
    renderImageDestination()
  }
  function renderImageDestination() {
    const host = imageHostSettings(snapshot.settings)
    $("image-destination").textContent =
      host.repository.split("/")[1] + (host.directory ? "/" + host.directory : "")
    $("insert-image").title = `上传到 ${host.repository}/${host.directory}`
  }
  async function loadArticle(id, restore = true) {
    message("正在载入…")
    snapshot = await client.snapshot()
    const draft = snapshot.catalog.articles.find((item) => item.draftOf === id)
    const article = draft || snapshot.catalog.articles.find((item) => item.id === id)
    const recovery =
      restore &&
      storage &&
      (readArticleRecovery(storage, id) || (article && readArticleRecovery(storage, article.id)))
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
      showEditor(article, loaded.text)
      $("status").hidden = true
    }
  }
  function restoreRecovery(recovery, latestArticle, latestSha) {
    const restored = recoveredBaseline(recovery, latestArticle, latestSha)
    openedSha = restored.openedSha
    showEditor(restored.article, restored.raw)
    // Never swap a restored edit's baseline for the freshly read remote version.
    current = restored.article
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
        ? "已恢复本地修改；远端文章已有更新，请先下载当前编辑再重新载入。"
        : "已恢复当前浏览器中未保存的文章修改。",
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
    if (discard) discardRecovery()
    else persistRecovery()
    clearImages()
    current = null
    openedSha = null
    raw = ""
    savedForm = ""
    $("editor-form").hidden = true
    $("empty").hidden = false
    $("status").hidden = true
    root.classList.remove("focus-editor")
    if (snapshot) renderList()
  }
  function setScope(scope) {
    articleScope = scope
    $("list-title").textContent = scope === "draft" ? "草稿箱" : "文章"
    $("tab-articles").setAttribute("aria-current", scope === "published" ? "page" : "false")
    $("tab-drafts").setAttribute("aria-current", scope === "draft" ? "page" : "false")
    $("tab-settings").setAttribute("aria-current", "false")
    renderList()
  }
  function showMode(mode) {
    const scope = mode === "drafts" ? "draft" : "published"
    if (mode !== "settings" && scope !== articleScope) {
      if (!mayLeaveArticle()) return
      closeEditor(true)
    }
    $("workspace").hidden = mode === "settings"
    $("settings-workspace").hidden = mode !== "settings"
    if (mode !== "settings") setScope(scope)
    else {
      $("tab-articles").setAttribute("aria-current", "false")
      $("tab-drafts").setAttribute("aria-current", "false")
    }
    $("tab-settings").setAttribute("aria-current", mode === "settings" ? "page" : "false")
    root.classList.remove("focus-editor")
    $("focus-mode").setAttribute("aria-pressed", "false")
    $("focus-mode").textContent = "专注"
  }
  async function connect(credentials) {
    if (!credentials) return
    if (busy || disposed) throw new Error("操作正在进行，请稍后重新登录。")
    lock(true)
    const connection = new GitHubLibrary(credentials.token)
    try {
      const account = await connection.authenticate()
      if (credentials.login && credentials.login !== account) {
        connection.token = ""
        throw new Error("登录账号与授权返回不一致，请重新登录。")
      }
      if (!client) {
        snapshot = await connection.snapshot()
        client = connection
        showMode("articles")
        renderList()
        settings.load(snapshot)
      } else {
        // Reauthentication preserves unsaved text/settings and their original conflict baselines.
        client.token = ""
        client = connection
      }
      session = { account, expiresAt: credentials.expiresAt, serverTime: credentials.serverTime }
      options.onSession?.({ ...session })
      $("account").textContent = account
      $("logout").hidden = false
      $("reconnect").hidden = false
      $("login-panel").hidden = true
      $("admin-tabs").hidden = false
      $("status").hidden = true
    } catch (error) {
      connection.token = ""
      throw error
    } finally {
      lock(false)
    }
  }
  function login() {
    options.onReauthenticate?.()
  }
  function logout() {
    persistRecovery()
    if (client) client.token = ""
    client = null
    session = null
    clearImages()
    closeEditor()
    $("login-panel").hidden = false
    $("workspace").hidden = true
    $("settings-workspace").hidden = true
    $("admin-tabs").hidden = true
    $("logout").hidden = true
    $("reconnect").hidden = true
    $("account").textContent = ""
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
  $("tab-articles").onclick = () => showMode("articles")
  $("tab-drafts").onclick = () => showMode("drafts")
  $("tab-settings").onclick = () => showMode("settings")
  $("search").oninput = renderList
  function newArticle() {
    if (!client || busy || !mayLeaveArticle()) return false
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
    insertImages(files)
  })
  function insertImages(files, selection) {
    if (!files.length || busy) return
    const input = $("body")
    const [start, end] = selection || [input.selectionStart, input.selectionEnd]
    action(async () => {
      message("正在读取图片…")
      const prepared = []
      for (const file of files) prepared.push(await prepareImage(file))
      // Read the latest saved destination without changing the opened article's conflict baseline.
      const latest = await client.snapshot()
      snapshot.settings = latest.settings
      const host = new GitHubImageHost(client, imageHostSettings(latest.settings))
      const uploaded = await host.upload(prepared, (index, total) =>
        message(`正在上传图片 ${index} / ${total}…`),
      )
      for (const [index, image] of uploaded.entries()) {
        if (!images.some((item) => item.url === image.url))
          images.push({ url: image.url, preview: URL.createObjectURL(files[index]) })
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
    const published = event.submitter?.id !== "save-draft"
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
      featured: $("featured").checked,
      modified:
        !current || sourceText() !== raw
          ? date()
          : current.modified || current.created || current.date,
    }
    persistRecovery()
    action(async () => {
      if (published) {
        delete edited.draftOf
        delete edited.draftBaseline
      }
      validateCatalog({ version: 2, articles: [edited] })
      message("正在保存…")
      let nextId = edited.id
      const previousRecovery = recoveryId()
      let result
      if (!published && current?.published) {
        const id = `draft-${crypto.randomUUID()}`
        const draft = {
          ...edited,
          id,
          file: `notes/网页草稿/${id}.md`,
          draftOf: current.id,
          draftBaseline: { article: current, sha: openedSha },
        }
        result = await client.save({
          opened: null,
          openedSha: null,
          edited: draft,
          text: sourceText(),
        })
        nextId = id
      } else if (published && current?.draftOf) {
        result = await client.publishDraft({
          opened: current,
          openedSha,
          edited,
          text: sourceText(),
        })
        nextId = result.articleId
      } else {
        result = await client.save({ opened: current, openedSha, edited, text: sourceText() })
      }
      discardRecovery(previousRecovery)
      savedForm = formValue()
      setScope(published ? "published" : "draft")
      $("workspace").hidden = false
      $("settings-workspace").hidden = true
      await loadArticle(nextId, false)
      options.onSaved?.({
        kind: published ? "article" : "draft",
        articleId: nextId,
        commit: result?.sha,
      })
      message(
        edited.published ? "已保存，正在部署。" : "草稿已保存。",
        false,
        "https://github.com/LeiGuo0812/howard-notes/actions",
      )
    })
  }
  $("cancel-edit").onclick = () => {
    if (mayLeaveArticle()) {
      closeEditor(true)
      options.onClose?.()
    }
  }
  $("unpublish").onclick = () => {
    if (!current?.published || !mayLeaveArticle() || !confirm("将这篇文章从网站撤下？")) return
    action(async () => {
      const id = current.id
      const result = await client.save({
        opened: current,
        openedSha,
        edited: { ...current, published: false },
        text: raw,
      })
      discardRecovery()
      savedForm = ""
      setScope("draft")
      await loadArticle(id, false)
      options.onSaved?.({ kind: "unpublish", articleId: id, commit: result?.sha })
      message("文章已撤下。")
    })
  }
  $("delete-draft").onclick = () => {
    if (!confirm("删除这篇草稿？")) return
    if (!current) {
      closeEditor(true)
      options.onClose?.()
      return
    }
    action(async () => {
      const deletedId = current.id
      const result = await client.removeDraft({ opened: current, openedSha })
      snapshot = await client.snapshot()
      closeEditor(true)
      options.onSaved?.({ kind: "delete", articleId: deletedId, commit: result?.sha })
      message("草稿已删除。")
    })
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
    if (!client || busy) return false
    if (current && (current.id === id || current.draftOf === id)) {
      $("workspace").hidden = false
      $("settings-workspace").hidden = true
      setScope(current.published ? "published" : "draft")
      return true
    }
    if (!mayLeaveArticle()) return false
    $("workspace").hidden = false
    $("settings-workspace").hidden = true
    setScope("published")
    return action(() => loadArticle(id))
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
    openArticle: requestArticle,
    showMode: (mode) => !busy && client && showMode(mode),
    newArticle,
    dirty,
    isBusy: () => busy,
    canClose,
    closeEditor: () => !busy && closeEditor(),
    logout: () => !busy && logout(),
    getSession: () => session && { ...session },
    currentArticle: () => current && structuredClone(current),
    dispose() {
      if (disposed) return
      persistRecovery()
      disposed = true
      clearTimeout(previewTimer)
      clearTimeout(recoveryTimer)
      previewVersion++
      listeners.abort()
      settings.dispose()
      clearImages()
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
