import { validateSite, topicList } from "../scripts/lib/site-settings.mjs"
import { imageHostSettings } from "../scripts/lib/image-host.mjs"
import { GitHubImageHost } from "./images.mjs"
import { brokerOrigin } from "./auth.mjs"
const $ = (id) => document.getElementById(id)
const node = (tag, text, cls) => {
  const el = document.createElement(tag)
  if (text !== undefined) el.textContent = text
  if (cls) el.className = cls
  return el
}
const get = (obj, path) => path.split(".").reduce((value, key) => value[key], obj)
const set = (obj, path, value) => {
  const parts = path.split("."),
    key = parts.pop()
  get(obj, parts.join("."))[key] = value
}

export function createSettings({ getSnapshot, action, message, onSaved, refresh }) {
  let working,
    baseline = "",
    openedSha
  const dirty = () => !!working && JSON.stringify(working) !== baseline
  const changed = () => {
    $("settings-state").textContent = dirty() ? "未保存" : "已保存"
    $("image-host-state").textContent = ""
    if (!$("authorize-images").hidden) {
      const link = new URL($("authorize-images").href)
      link.searchParams.set("repository", working.imageHost.repository)
      $("authorize-images").href = link.href
    }
    renderPreview()
  }
  function renderPreview() {
    const root = $("layout-preview")
    root.replaceChildren()
    root.dataset.accent = working.accent
    root.dataset.layout = working.home.layout
    root.dataset.density = working.home.density
    const brand = node("div", undefined, "mini-brand")
    brand.append(node("strong", working.brand.mark), node("span", working.brand.name))
    root.append(brand)
    root.append(node("h2", working.home.title))
    if (working.home.description)
      root.append(node("p", working.home.description, "mini-description"))
    const modules = node("div", undefined, "mini-modules")
    for (const section of working.home.sections
      .filter((item) => item.enabled)
      .sort((a, b) => Number(a.id === "activity") - Number(b.id === "activity"))) {
      const el = node("section", undefined, "mini-module mini-" + section.id)
      el.append(node("h3", section.title))
      if (section.id === "activity") el.append(node("div", "笔记活动", "mini-heatmap"))
      else if (["featured", "recent"].includes(section.id)) {
        const articles = getSnapshot()
          .catalog.articles.filter((article) => article.published)
          .sort((a, b) =>
            (b.modified || b.created || b.date).localeCompare(a.modified || a.created || a.date),
          )
        for (const article of articles.slice(0, 3))
          el.append(node("p", article.title, "mini-article"))
        if (!articles.length) el.append(node("p", "暂无文章", "mini-article"))
      } else {
        const chips = node("div", undefined, "mini-chips")
        for (const item of section.id === "topics"
          ? working.topics.filter((item) => item.visible)
          : section.id === "tags"
            ? [
                ...new Set(
                  getSnapshot()
                    .catalog.articles.filter((a) => a.published)
                    .flatMap((a) => a.tags || []),
                ),
              ]
                .slice(0, 8)
                .map((title) => ({ title }))
            : working.collections.filter((item) => item.enabled))
          chips.append(node("span", item.title))
        el.append(chips)
      }
      modules.append(el)
    }
    root.append(modules, node("div", working.footer, "mini-footer"))
  }
  function ordered(container, items, kind) {
    const root = $(container)
    root.replaceChildren()
    items.forEach((item, index) => {
      const row = node("div", undefined, "setting-row")
      row.dataset.itemId = item.id
      const visibility = kind === "navigation" || kind === "topic" ? "visible" : "enabled",
        titleKey = kind === "navigation" ? "label" : "title"
      const check = node("input")
      check.type = "checkbox"
      check.checked = item[visibility]
      check.setAttribute("aria-label", `显示${item[titleKey]}`)
      check.onchange = () => {
        item[visibility] = check.checked
        changed()
      }
      const title = node("input")
      title.value = item[titleKey]
      title.required = true
      title.maxLength = kind === "navigation" ? 20 : kind === "topic" ? 60 : 40
      title.setAttribute(
        "aria-label",
        `${kind === "topic" ? "专题" : "模块"}名称 ${item[titleKey]}`,
      )
      title.oninput = () => {
        item[titleKey] = title.value
        changed()
      }
      row.append(check, title)
      if (kind === "topic")
        row.append(
          node(
            "small",
            String(
              getSnapshot().catalog.articles.filter((a) => a.category === item.category).length,
            ),
          ),
        )
      for (const [symbol, delta, label] of [
        ["↑", -1, "上移"],
        ["↓", 1, "下移"],
      ]) {
        const button = node("button", symbol)
        button.type = "button"
        button.disabled = index + delta < 0 || index + delta >= items.length
        button.dataset.boundary = String(button.disabled)
        button.setAttribute("aria-label", `${label}${item[titleKey]}`)
        button.onclick = () => {
          const target = index + delta
          if (target < 0 || target >= items.length) return
          ;[items[index], items[target]] = [items[target], items[index]]
          renderRows()
          changed()
        }
        row.append(button)
      }
      if (kind === "topic") {
        const remove = node("button", "×")
        remove.type = "button"
        remove.setAttribute("aria-label", `删除专题${item.title}`)
        remove.onclick = () => {
          if (getSnapshot().catalog.articles.some((a) => a.category === item.category)) {
            message("此专题仍有文章，请先调整文章专题。", true)
            return
          }
          items.splice(index, 1)
          renderRows()
          changed()
        }
        row.append(remove)
      }
      root.append(row)
    })
  }
  function renderRows() {
    ordered("section-settings", working.home.sections, "section")
    ordered("topic-settings", working.topics, "topic")
    ordered("collection-settings", working.collections, "collection")
    ordered("navigation-settings", working.navigation, "navigation")
  }
  function load(snapshot) {
    openedSha = snapshot.siteSha
    working = structuredClone(snapshot.settings)
    working.imageHost = { ...imageHostSettings(working) }
    working.topics = topicList(working, snapshot.catalog.articles).map(
      ({ count, ...topic }) => topic,
    )
    baseline = JSON.stringify(working)
    for (const input of $("site-form").querySelectorAll("[data-setting]")) {
      input.value = get(working, input.dataset.setting)
      input.oninput = () => {
        if (input.dataset.setting.includes(".")) set(working, input.dataset.setting, input.value)
        else working[input.dataset.setting] = input.value
        changed()
      }
    }
    renderRows()
    changed()
    fetch(new URL("auth-config.json", location.href), { cache: "no-store" })
      .then((response) => response.json())
      .then((config) => {
        const link = new URL("/ready", brokerOrigin(config.brokerOrigin))
        link.searchParams.set("repository", working.imageHost.repository)
        $("authorize-images").href = link.href
        $("authorize-images").hidden = false
      })
      .catch(() => {})
  }
  $("test-image-host").onclick = () =>
    action(async () => {
      $("image-host-state").textContent = "正在检查…"
      try {
        await new GitHubImageHost(getSnapshot().client, working.imageHost).checkAccess()
        $("image-host-state").textContent = "仓库公开，分支可访问"
      } catch (error) {
        $("image-host-state").textContent = "连接失败"
        throw error
      }
    })
  $("add-topic").onclick = () => {
    const title = $("new-topic").value.trim()
    if (!title) {
      $("new-topic").focus()
      return
    }
    if (working.topics.some((topic) => topic.title === title || topic.category === title)) {
      message("专题已存在。", true)
      return
    }
    if (working.topics.length >= 80) {
      message("最多可设置 80 个专题。", true)
      return
    }
    working.topics.push({
      id: `topic-${crypto.randomUUID()}`,
      title,
      category: title,
      visible: true,
    })
    $("new-topic").value = ""
    renderRows()
    changed()
  }
  $("new-topic").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      $("add-topic").click()
    }
  }
  $("site-form").onsubmit = (event) => {
    event.preventDefault()
    action(async () => {
      validateSite(working)
      message("正在保存页面…")
      await getSnapshot().client.saveSettings({ openedSha, settings: structuredClone(working) })
      const latest = await refresh()
      load(latest)
      onSaved(latest)
      message("页面已保存，正在部署。", false, "https://github.com/LeiGuo0812/howard-notes/actions")
    })
  }
  $("reload-settings").onclick = () => {
    if (!dirty() || confirm("放弃未保存的页面设置？"))
      action(async () => {
        load(await refresh())
        message("已载入最新设置。")
      })
  }
  $("export-settings").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(working, null, 2) + "\n"], { type: "application/json" }),
    )
    const link = node("a")
    link.href = url
    link.download = "site.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return { load, dirty }
}
