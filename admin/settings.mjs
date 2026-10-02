import { validateSite, topicList } from "../scripts/lib/site-settings.mjs"
import {
  ACCENT_COLORS,
  DEFAULT_DESIGN,
  CHINESE_FONTS,
  ENGLISH_FONTS,
  normalizeSite,
  applyHomeTemplate,
  sectionLimit,
  orderedSections,
} from "../scripts/lib/site-design.mjs"
import { imageHostSettings } from "../scripts/lib/image-host.mjs"
import { GitHubImageHost } from "./images.mjs"
import { brokerOrigin } from "./auth.mjs"
import { createSitePreview } from "./site-preview.mjs"
import { readLayoutDraft, writeLayoutDraft, clearLayoutDraft } from "./layout-draft.mjs"
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
  const target = parts.length ? get(obj, parts.join(".")) : obj
  target[key] = value
}
export function createSettings({
  root = document,
  siteBase = new URL("../", location.href),
  getSnapshot,
  action,
  message,
  onSaved,
  refresh,
}) {
  const $ = (id) => root.querySelector(`[data-admin-id="${id}"]`) || root.querySelector(`#${id}`)
  const listeners = new AbortController()
  const listen = (target, type, handler, options = {}) =>
    target.addEventListener(type, handler, { ...options, signal: listeners.signal })
  const dragCleanups = new Set()
  let disposed = false
  let working,
    baseline = "",
    openedSha,
    storage
  try {
    storage = localStorage
  } catch {}
  const dirty = () => !!working && JSON.stringify(working) !== baseline
  const preview = createSitePreview(() => working, getSnapshot, { root, siteBase })
  for (const [path, fonts] of [
    ["design.chineseFont", CHINESE_FONTS],
    ["design.englishFont", ENGLISH_FONTS],
  ]) {
    const select = $("site-form").querySelector(`[data-setting="${path}"]`)
    const groups = new Map()
    for (const font of fonts) {
      if (!groups.has(font.group)) {
        const group = node("optgroup")
        group.label = font.group
        groups.set(font.group, group)
      }
      const option = node("option", font.label)
      option.value = font.id
      groups.get(font.group).append(option)
    }
    select.replaceChildren(...groups.values())
  }
  const persist = () => {
    try {
      validateSite(working)
      if (!storage) throw new Error("unavailable")
      if (dirty()) writeLayoutDraft(storage, openedSha, working)
      else clearLayoutDraft(storage)
      $("settings-state").textContent = dirty()
        ? openedSha !== getSnapshot().siteSha
          ? "草稿版本已过期"
          : "草稿已暂存"
        : "已发布"
    } catch {
      $("settings-state").textContent = "未暂存，可导出"
    }
  }
  const changed = () => {
    persist()
    $("image-host-state").textContent = ""
    if (!$("authorize-images").hidden) {
      const link = new URL($("authorize-images").href)
      link.searchParams.set("repository", working.imageHost.repository)
      $("authorize-images").href = link.href
    }
    preview.update()
  }
  function bindFields() {
    for (const input of $("site-form").querySelectorAll("[data-setting]")) {
      if (input.type === "checkbox") input.checked = get(working, input.dataset.setting)
      else input.value = get(working, input.dataset.setting)
      input.oninput = () => {
        const path = input.dataset.setting
        const value =
          input.type === "checkbox"
            ? input.checked
            : input.hasAttribute("data-number")
              ? Number(input.value)
              : input.value
        if (path === "pages.homeTemplate") {
          working = applyHomeTemplate(working, value)
          bindFields()
          renderRows()
        } else {
          set(working, path, value)
          if (path === "accent") {
            ;[working.design.accentColor, working.design.darkAccentColor] = ACCENT_COLORS[value]
            bindFields()
          }
          if (path === "home.activityPinned") renderRows()
        }
        changed()
      }
    }
  }
  function ordered(container, items, kind) {
    const root = $(container)
    root.replaceChildren()
    items.forEach((item, index) => {
      const row = node("div", undefined, "setting-row")
      row.dataset.itemId = item.id
      const visibility = kind === "navigation" || kind === "topic" ? "visible" : "enabled",
        titleKey = kind === "navigation" ? "label" : "title"
      const handle = node("button", "⠿", "drag-handle")
      handle.type = "button"
      const pinned = kind === "section" && working.home.activityPinned
      const locked = pinned && item.id === "activity"
      handle.disabled = locked
      handle.dataset.boundary = String(locked)
      handle.setAttribute("aria-label", `拖动${item[titleKey]}`)
      handle.title = "拖动排序"
      handle.onpointerdown = (event) => {
        if (event.button !== 0 || handle.disabled) return
        event.preventDefault()
        row.classList.add("dragging")
        const pointerId = event.pointerId
        const move = (event) => {
          if (event.pointerId !== pointerId) return
          event.preventDefault()
          const tree = root.getRootNode()
          const hit = (
            tree.elementFromPoint?.(event.clientX, event.clientY) ||
            document.elementFromPoint(event.clientX, event.clientY)
          )?.closest(".setting-row")
          // Some browsers expose only the shadow host through document hit testing.
          const target =
            hit?.parentElement === root
              ? hit
              : [...root.children].find((candidate) => {
                  const bounds = candidate.getBoundingClientRect()
                  return (
                    event.clientX >= bounds.left &&
                    event.clientX <= bounds.right &&
                    event.clientY >= bounds.top &&
                    event.clientY <= bounds.bottom
                  )
                })
          if (
            target &&
            target.parentElement === root &&
            target !== row &&
            !(pinned && target.dataset.itemId === "activity")
          ) {
            const from = items.findIndex((entry) => entry.id === item.id),
              to = items.findIndex((entry) => entry.id === target.dataset.itemId)
            items.splice(to, 0, items.splice(from, 1)[0])
            const rows = new Map([...root.children].map((child) => [child.dataset.itemId, child]))
            root.append(...items.map((entry) => rows.get(entry.id)))
            changed()
          }
          // The overlay scrolls at its host; inline editing shares the page's scroll container.
          const scroller = tree.host?.classList.contains("is-panel")
            ? tree.host
            : root.closest(".maintenance-scroll") || document.scrollingElement
          const bounds =
            scroller === document.scrollingElement
              ? { top: 0, bottom: innerHeight }
              : scroller.getBoundingClientRect()
          if (event.clientY < bounds.top + 75) scroller.scrollBy(0, -14)
          if (event.clientY > bounds.bottom - 75) scroller.scrollBy(0, 14)
        }
        const cleanup = () => {
          window.removeEventListener("pointermove", move)
          window.removeEventListener("pointerup", end)
          window.removeEventListener("pointercancel", end)
          dragCleanups.delete(cleanup)
          row.classList.remove("dragging")
        }
        const end = (event) => {
          if (event.pointerId !== pointerId) return
          cleanup()
          renderRows()
          $(container)
            .querySelector(`[data-item-id="${item.id}"] .drag-handle`)
            ?.focus({ preventScroll: true })
        }
        dragCleanups.add(cleanup)
        listen(window, "pointermove", move, { passive: false })
        listen(window, "pointerup", end)
        listen(window, "pointercancel", end)
      }
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
      row.append(handle, check, title)
      if (kind === "section" && ["featured", "recent"].includes(item.id)) {
        const count = node("input", undefined, "module-count")
        count.type = "number"
        count.min = 1
        count.max = item.id === "featured" ? 6 : 20
        count.value = sectionLimit(item)
        count.setAttribute("aria-label", `${item[titleKey]}展示篇数`)
        count.oninput = () => {
          item.limit = Number(count.value)
          changed()
        }
        row.append(count)
      }
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
        button.disabled =
          locked ||
          index + delta < 0 ||
          index + delta >= items.length ||
          (pinned && items[index + delta]?.id === "activity")
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
          items.splice(items.indexOf(item), 1)
          renderRows()
          changed()
        }
        row.append(remove)
      }
      root.append(row)
    })
  }
  function renderRows() {
    const sections = orderedSections(working)
    working.home.sections.splice(0, working.home.sections.length, ...sections)
    ordered("section-settings", working.home.sections, "section")
    ordered("topic-settings", working.topics, "topic")
    ordered("collection-settings", working.collections, "collection")
    ordered("navigation-settings", working.navigation, "navigation")
  }
  function load(snapshot, restoreDraft = true) {
    openedSha = snapshot.siteSha
    working = normalizeSite(snapshot.settings)
    working.imageHost = { ...imageHostSettings(working) }
    working.topics = topicList(working, snapshot.catalog.articles).map(
      ({ count, ...topic }) => topic,
    )
    baseline = JSON.stringify(working)
    const draft = restoreDraft && storage && readLayoutDraft(storage)
    if (draft) {
      working = normalizeSite(draft.settings)
      working.imageHost = { ...imageHostSettings(working) }
      openedSha = draft.openedSha
      if (openedSha !== snapshot.siteSha)
        message("已恢复旧版本草稿；远端设置有更新，请先导出草稿再重新载入。", true)
    }
    bindFields()
    renderRows()
    changed()
    preview.load()
    fetch(new URL("admin/auth-config.json", siteBase), { cache: "no-store" })
      .then((response) => response.json())
      .then((config) => {
        if (disposed) return
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
  $("save-layout-draft").onclick = () => {
    persist()
    if ($("settings-state").textContent === "草稿已暂存") message("布局草稿已保存在当前浏览器。")
  }
  $("reset-design").onclick = () => {
    working.design = {
      ...DEFAULT_DESIGN,
      accentColor: ACCENT_COLORS[working.accent][0],
      darkAccentColor: ACCENT_COLORS[working.accent][1],
    }
    bindFields()
    changed()
  }
  $("restore-settings").onclick = () =>
    action(async () => {
      working = normalizeSite(await getSnapshot().client.previousSettings())
      working.imageHost = { ...imageHostSettings(working) }
      // Preserve occupied topic URLs when restoring an older layout.
      const occupied = new Set(getSnapshot().catalog.articles.map((article) => article.category))
      for (const current of getSnapshot().settings.topics) {
        if (!occupied.has(current.category)) continue
        const previous = working.topics.find((topic) => topic.category === current.category)
        if (previous) previous.id = current.id
        else working.topics.push(structuredClone(current))
      }
      bindFields()
      renderRows()
      changed()
      message("已载入上一版设置，发布后生效。")
    })
  $("site-form").onsubmit = (event) => {
    event.preventDefault()
    try {
      validateSite(working)
    } catch (error) {
      message(error.message, true)
      return
    }
    action(
      async () => {
        message("正在发布页面…")
        const result = await getSnapshot().client.saveSettings({
          openedSha,
          settings: structuredClone(working),
        })
        if (storage) clearLayoutDraft(storage)
        const latest = result.snapshot || (await refresh())
        load(latest, false)
        const sync = await onSaved(latest, result)
        message(
          sync?.status === "synchronized"
            ? "页面已上线。"
            : sync?.status === "pending"
              ? "页面已保存到 GitHub，等待同步。"
              : "页面已发布，正在部署。",
          false,
          sync?.status === "static"
            ? "https://github.com/LeiGuo0812/howard-notes/actions"
            : undefined,
        )
      },
      { completion: { kind: "settings" } },
    )
  }
  $("reload-settings").onclick = () => {
    if (!dirty() || confirm("放弃布局草稿并载入已发布设置？"))
      action(async () => {
        const latest = await refresh()
        if (storage) clearLayoutDraft(storage)
        load(latest, false)
        message("已载入已发布设置。")
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
  return {
    load,
    dirty,
    setVisible(value) {
      preview.setActive(value)
    },
    dispose() {
      disposed = true
      listeners.abort()
      for (const cleanup of dragCleanups) cleanup()
      preview.dispose()
    },
  }
}
