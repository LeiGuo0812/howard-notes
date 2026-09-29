import { marked } from "marked"
import DOMPurify from "dompurify"
import { GitHubLibrary } from "./github.mjs"
import { validateCatalog } from "../scripts/lib/catalog.mjs"

const $ = (id) => document.getElementById(id)
let client,
  snapshot,
  current = null,
  openedSha = null,
  raw = "",
  savedForm = "",
  images = [],
  busy = false
const date = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())
const formValue = () =>
  JSON.stringify(
    [...$("editor-form").querySelectorAll("input:not([type=file]),select,textarea")].map((el) =>
      el.type === "checkbox" ? el.checked : el.value,
    ),
  )
const dirty = () => !$("editor-form").hidden && formValue() !== savedForm
function message(text, error = false, href) {
  const el = $("status")
  el.hidden = false
  el.className = error ? "error" : ""
  el.textContent = text
  if (href) {
    const a = document.createElement("a")
    a.href = href
    a.target = "_blank"
    a.rel = "noopener noreferrer"
    a.textContent = "查看部署进度 ↗"
    el.append(a)
  }
}
function lock(value) {
  busy = value
  for (const el of document.querySelectorAll("button,input,select,textarea")) el.disabled = value
}
async function action(callback) {
  if (busy) return
  lock(true)
  try {
    await callback()
  } catch (error) {
    message(error.message || "操作失败，请重试。", true)
  } finally {
    lock(false)
  }
}
function mayLeave() {
  return !dirty() || window.confirm("当前修改尚未保存。确定放弃这些修改？")
}
function renderList() {
  const query = $("search").value.trim().toLocaleLowerCase()
  const filter = $("filter").value
  const list = snapshot.catalog.articles
    .filter(
      (article) =>
        (filter === "all" || (filter === "published") === article.published) &&
        [article.title, article.category, ...(article.tags || [])]
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
    button.setAttribute("aria-current", String(current?.id === article.id))
    const title = document.createElement("strong")
    title.textContent = article.title
    const meta = document.createElement("span")
    meta.textContent = `${article.category} · ${article.published ? "已发布" : "草稿 / 已撤下"}`
    button.append(title, meta)
    button.onclick = () => {
      if (mayLeave()) action(() => openArticle(article.id))
    }
    $("article-list").append(button)
  }
  $("categories").replaceChildren(
    ...[...new Set(snapshot.catalog.articles.map((item) => item.category))].map((value) => {
      const option = document.createElement("option")
      option.value = value
      return option
    }),
  )
}
function showEditor(article, text) {
  current = article ? structuredClone(article) : null
  raw = text
  images = []
  $("empty").hidden = true
  $("editor-form").hidden = false
  $("editor-heading").textContent = article ? "编辑文章" : "新建文章"
  for (const key of ["title", "category", "description"]) $(key).value = article?.[key] || ""
  $("slug").value = article?.id || `note-${Date.now().toString(36)}`
  $("slug").readOnly = !!article
  $("date").value = article?.date || date()
  $("published").value = String(article?.published ?? false)
  $("tags").value = (article?.tags || []).join(", ")
  $("featured").checked = article?.featured || false
  $("body").value = text
  $("view-live").hidden = !article?.published
  $("view-live").href = "../notes/" + (article?.id || "")
  $("reload").hidden = !article
  savedForm = formValue()
  preview()
  renderList()
}
async function openArticle(id) {
  message("正在载入最新原文…")
  snapshot = await client.snapshot()
  const article = snapshot.catalog.articles.find((item) => item.id === id)
  if (!article) throw new Error("文章已被移除，请刷新列表。")
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
function preview() {
  if ($("preview").hidden) return
  const source = $("body").value.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
  $("preview").innerHTML = DOMPurify.sanitize(marked.parse(source), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
    FORBID_ATTR: ["style", "srcset"],
  })
  for (const a of $("preview").querySelectorAll("a")) {
    a.target = "_blank"
    a.rel = "noopener noreferrer"
  }
  for (const img of $("preview").querySelectorAll("img")) {
    const src = img.getAttribute("src")
    const local = images.find((image) => src?.endsWith(image.file))
    if (local) img.src = local.preview
    else if (!/^(https?:|data:|blob:)/i.test(src || "")) {
      img.removeAttribute("src")
      img.alt = img.alt || "本地图片（发布后显示）"
    }
    img.loading = "lazy"
    img.referrerPolicy = "no-referrer"
  }
}
$("login-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const token = $("token").value.trim()
  $("token").value = ""
  action(async () => {
    message("正在验证 GitHub 权限并读取文章目录…")
    const connection = new GitHubLibrary(token)
    const login = await connection.authenticate()
    const loaded = await connection.snapshot()
    client = connection
    snapshot = loaded
    $("account").textContent = login
    $("logout").hidden = false
    $("login-panel").hidden = true
    $("workspace").hidden = false
    renderList()
    $("status").hidden = true
  })
})
$("logout").onclick = () => {
  if (mayLeave()) {
    client.token = ""
    client = null
    location.reload()
  }
}
$("search").oninput = renderList
$("filter").onchange = renderList
$("new-article").onclick = () => {
  if (mayLeave()) {
    openedSha = null
    showEditor(null, "")
    $("title").focus()
  }
}
$("reload").onclick = () => {
  if (current && mayLeave()) action(() => openArticle(current.id))
}
$("download").onclick = () => {
  const url = URL.createObjectURL(new Blob([sourceText()], { type: "text/markdown;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${$("title").value || "未命名文章"}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
$("toggle-preview").onclick = () => {
  const show = $("preview").hidden
  $("preview").hidden = !show
  $("writing-area").classList.toggle("with-preview", show)
  $("toggle-preview").setAttribute("aria-pressed", String(show))
  $("toggle-preview").textContent = show ? "隐藏预览" : "显示预览"
  preview()
}
let previewTimer
$("body").oninput = () => {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(preview, 250)
}
$("image").onchange = async () => {
  const file = $("image").files[0]
  $("image").value = ""
  if (!file) return
  await action(async () => {
    const ext = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    }[file.type]
    if (!ext || file.size > 10 * 1024 * 1024)
      throw new Error("请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
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
    images.push(image)
    const articleFile = current?.file || `notes/网页新建/${$("slug").value.trim()}.md`
    const relative = "../".repeat(articleFile.split("/").length - 1) + image.file
    const insert = `\n![${file.name.replace(/[\[\]\r\n]/g, "")}](${relative})\n`
    const input = $("body")
    input.setRangeText(insert, input.selectionStart, input.selectionEnd, "end")
    preview()
    message("图片已加入编辑内容，将随文章一起保存。")
  })
}
$("editor-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const edited = {
    ...(current || {}),
    id: $("slug").value.trim(),
    file: current?.file || `notes/网页新建/${$("slug").value.trim()}.md`,
    title: $("title").value.trim(),
    category: $("category").value.trim(),
    description: $("description").value.trim(),
    date: $("date").value,
    tags: $("tags")
      .value.split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    published: $("published").value === "true",
    featured: $("featured").checked,
    modified: date(),
  }
  action(async () => {
    validateCatalog({ version: 2, articles: [edited] })
    message("正在检查远端版本并保存…")
    await client.save({ opened: current, openedSha, edited, text: sourceText(), images })
    savedForm = formValue()
    await openArticle(edited.id)
    message(
      edited.published
        ? "已保存到 GitHub。自动检查与部署成功后，网站会更新。"
        : "已保存为草稿 / 撤下状态。部署成功后，该文章不再展示在网站中。",
      false,
      "https://github.com/LeiGuo0812/howard-notes/actions",
    )
  })
})
window.addEventListener("beforeunload", (event) => {
  if (dirty()) {
    event.preventDefault()
    event.returnValue = ""
  }
})
