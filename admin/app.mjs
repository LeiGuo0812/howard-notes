import { GitHubLibrary } from "./github.mjs"
import { validateCatalog } from "../scripts/lib/catalog.mjs"
import { topicList } from "../scripts/lib/site-settings.mjs"
import { formatSelection, TextHistory } from "./formatting.mjs"
import { createPreview } from "./preview.mjs"
import { createSettings } from "./settings.mjs"
import { signIn } from "./auth.mjs"

const $ = (id) => document.getElementById(id)
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
  linkSelection = [0, 0]
const history = new TextHistory()
const date = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())
const formKeys = [
  "title",
  "category",
  "description",
  "slug",
  "date",
  "published",
  "tags",
  "featured",
  "body",
]
const formValue = () =>
  JSON.stringify(
    formKeys.map((key) => ($(key).type === "checkbox" ? $(key).checked : $(key).value)),
  )
const articleDirty = () => !!savedForm && formValue() !== savedForm
const settings = createSettings({
  getSnapshot: () => ({ ...snapshot, client }),
  action,
  message,
  refresh: async () => (snapshot = await client.snapshot()),
  onSaved: () => {
    renderList()
    renderCategories($("category").value)
  },
})
const dirty = () => articleDirty() || settings.dirty()
const viewer = createPreview($("preview"), () => ({
  client,
  snapshot,
  articles: snapshot?.catalog.articles || [],
  images,
  articleFile:
    current?.draftBaseline?.article.file || current?.file || `notes/网页新建/${$("slug").value}.md`,
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
  for (const el of document.querySelectorAll("button,input,select,textarea"))
    el.disabled = value || el.dataset.boundary === "true"
}
async function action(callback) {
  if (busy) return
  lock(true)
  try {
    await callback()
  } catch (error) {
    message(error.message || "操作失败。", true)
    if (client && error.status === 401) $("reconnect").hidden = false
  } finally {
    lock(false)
  }
}
const mayLeaveArticle = () => !articleDirty() || confirm("放弃未保存的文章修改？")
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
      if (mayLeaveArticle()) action(() => openArticle(article.id))
    }
    $("article-list").append(button)
  }
  if (!list.length) {
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
  clearImages()
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
  $("view-live").href = "../notes/" + (article?.draftOf || article?.id || "")
  $("reload").hidden = !article
  $("link-fields").hidden = true
  history.reset($("body").value)
  savedForm = formValue()
  updateState()
  preview()
  renderList()
}
async function openArticle(id) {
  message("正在载入…")
  snapshot = await client.snapshot()
  const draft = snapshot.catalog.articles.find((item) => item.draftOf === id)
  const article = draft || snapshot.catalog.articles.find((item) => item.id === id)
  if (!article) throw new Error("文章已移除，请重新载入。")
  const loaded = await client.read(article, snapshot)
  openedSha = loaded.sha
  showEditor(article, loaded.text)
  $("status").hidden = true
}
function sourceText() {
  const edited = $("body").value
  if (edited === raw.replace(/\r\n?/g, "\n")) return raw
  return raw.includes("\r\n") ? edited.replace(/\r?\n/g, "\r\n") : edited
}
function updateState() {
  $("save-state").textContent = !current || articleDirty() ? "未保存" : "已保存"
  $("word-count").textContent = `${Array.from($("body").value).length.toLocaleString()} 字符`
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
function closeEditor() {
  clearImages()
  current = null
  openedSha = null
  raw = ""
  savedForm = ""
  $("editor-form").hidden = true
  $("empty").hidden = false
  $("status").hidden = true
  renderList()
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
    closeEditor()
  }
  $("workspace").hidden = mode === "settings"
  $("settings-workspace").hidden = mode !== "settings"
  if (mode !== "settings") setScope(scope)
  else {
    $("tab-articles").setAttribute("aria-current", "false")
    $("tab-drafts").setAttribute("aria-current", "false")
  }
  $("tab-settings").setAttribute("aria-current", mode === "settings" ? "page" : "false")
  document.body.classList.remove("focus-editor")
  $("focus-mode").setAttribute("aria-pressed", "false")
  $("focus-mode").textContent = "专注"
}
function login() {
  action(async () => {
    message("等待 GitHub 登录…")
    const credentials = await signIn()
    const connection = new GitHubLibrary(credentials.token)
    const account = await connection.authenticate()
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
    $("account").textContent = account
    $("logout").hidden = false
    $("reconnect").hidden = false
    $("login-panel").hidden = true
    $("admin-tabs").hidden = false
    $("status").hidden = true
  })
}
$("login-button").onclick = login
$("reconnect").onclick = login
$("logout").onclick = () => {
  if (!dirty() || confirm("放弃未保存的修改并退出？")) {
    client.token = ""
    client = null
    clearImages()
    savedForm = ""
    window.onbeforeunload = null
    location.reload()
  }
}
$("tab-articles").onclick = () => showMode("articles")
$("tab-drafts").onclick = () => showMode("drafts")
$("tab-settings").onclick = () => showMode("settings")
$("search").oninput = renderList
$("new-article").onclick = () => {
  if (mayLeaveArticle()) {
    openedSha = null
    showEditor(null, "")
    $("title").focus()
  }
}
$("reload").onclick = () => {
  if (current && mayLeaveArticle()) action(() => openArticle(current.id))
}
$("download").onclick = () => {
  const url = URL.createObjectURL(new Blob([sourceText()], { type: "text/markdown;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${$("title").value || "未命名"}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
for (const button of document.querySelectorAll("[data-view]")) {
  if (button.tagName !== "BUTTON") continue
  button.onclick = () => {
    const view = button.dataset.view
    $("writing-area").dataset.view = view
    $("format-toolbar").hidden = view === "preview"
    for (const other of document.querySelectorAll("button[data-view]"))
      other.setAttribute("aria-pressed", String(other === button))
    preview()
  }
}
$("focus-mode").onclick = () => {
  const enabled = document.body.classList.toggle("focus-editor")
  $("focus-mode").setAttribute("aria-pressed", String(enabled))
  $("focus-mode").textContent = enabled ? "退出专注" : "专注"
}
for (const button of document.querySelectorAll("[data-format]"))
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
$("editor-form").addEventListener("input", updateState)
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
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && client) {
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
  source.addEventListener("scroll", () => {
    if (scrolling || !$("sync-scroll").checked || $("writing-area").dataset.view !== "split") return
    scrolling = true
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight)
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight)
    requestAnimationFrame(() => (scrolling = false))
  })
$("insert-image").onclick = () => $("image").click()
$("image").onchange = () => {
  const file = $("image").files[0]
  $("image").value = ""
  if (!file) return
  action(async () => {
    const ext = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    }[file.type]
    if (!ext || file.size > 10 * 1024 * 1024)
      throw new Error("请选择 10 MB 以内的 PNG、JPEG、WebP 或 GIF。")
    const bytes = new Uint8Array(await file.arrayBuffer()),
      digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
    let binary = ""
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    const image = {
      file: `assets/${digest}.${ext}`,
      base64: btoa(binary),
      preview: URL.createObjectURL(file),
    }
    if (images.some((item) => item.file === image.file)) URL.revokeObjectURL(image.preview)
    else images.push(image)
    const articleFile =
        current?.draftBaseline?.article.file ||
        current?.file ||
        `notes/网页新建/${$("slug").value.trim()}.md`,
      relative = "../".repeat(articleFile.split("/").length - 1) + image.file
    const input = $("body")
    input.setRangeText(
      `\n![${file.name.replace(/[\[\]\r\n]/g, "")}](${relative})\n`,
      input.selectionStart,
      input.selectionEnd,
      "end",
    )
    history.record(bodyState(), "image")
    updateState()
    preview()
    message("图片已插入。")
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
  action(async () => {
    if (published) {
      delete edited.draftOf
      delete edited.draftBaseline
    }
    validateCatalog({ version: 2, articles: [edited] })
    message("正在保存…")
    let nextId = edited.id
    if (!published && current?.published) {
      const id = `draft-${crypto.randomUUID()}`
      const draft = {
        ...edited,
        id,
        file: `notes/网页草稿/${id}.md`,
        draftOf: current.id,
        draftBaseline: { article: current, sha: openedSha },
      }
      await client.save({
        opened: null,
        openedSha: null,
        edited: draft,
        text: sourceText(),
        images,
      })
      nextId = id
    } else if (published && current?.draftOf) {
      const result = await client.publishDraft({
        opened: current,
        openedSha,
        edited,
        text: sourceText(),
        images,
      })
      nextId = result.articleId
    } else {
      await client.save({ opened: current, openedSha, edited, text: sourceText(), images })
    }
    savedForm = formValue()
    setScope(published ? "published" : "draft")
    $("workspace").hidden = false
    $("settings-workspace").hidden = true
    await openArticle(nextId)
    message(
      edited.published ? "已保存，正在部署。" : "草稿已保存。",
      false,
      "https://github.com/LeiGuo0812/howard-notes/actions",
    )
  })
}
$("cancel-edit").onclick = () => {
  if (mayLeaveArticle()) closeEditor()
}
$("unpublish").onclick = () => {
  if (!current?.published || !mayLeaveArticle() || !confirm("将这篇文章从网站撤下？")) return
  action(async () => {
    const id = current.id
    await client.save({
      opened: current,
      openedSha,
      edited: { ...current, published: false },
      text: raw,
    })
    savedForm = ""
    setScope("draft")
    await openArticle(id)
    message("文章已撤下。")
  })
}
$("delete-draft").onclick = () => {
  if (!confirm("删除这篇草稿？")) return
  if (!current) {
    closeEditor()
    return
  }
  action(async () => {
    await client.removeDraft({ opened: current, openedSha })
    snapshot = await client.snapshot()
    closeEditor()
    message("草稿已删除。")
  })
}
window.onbeforeunload = (event) => {
  if (dirty()) {
    event.preventDefault()
    event.returnValue = ""
  }
}
