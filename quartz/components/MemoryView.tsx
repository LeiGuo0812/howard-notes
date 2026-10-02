import { QuartzComponent } from "./types"
import { pathToRoot } from "../util/path"
import { Pagination } from "./Pagination"

// This public shell contains no memory content. Visibility is checked by the
// content service on every request, independently from article publishing.
export const MemoryHub: QuartzComponent = (props) => {
  if (props.fileData.slug !== "memory/index") return null
  return (
    <section
      id="memory-hub"
      class="memory-hub"
      data-memory-base={`${pathToRoot(props.fileData.slug!)}/`}
      aria-label="记忆卡"
    >
      <div class="memory-heading">
        <span id="memory-count" role="status" aria-live="polite" />
        <button type="button" class="memory-new" data-memory-action="new" hidden title="新建记忆卡">
          ＋ 新建记忆卡
        </button>
      </div>
      <div class="memory-layout">
        <details id="memory-sidebar" class="memory-sidebar" open>
          <summary title="按记忆卡标签筛选">标签索引</summary>
          <div class="memory-sidebar-content">
            <div class="memory-status-controls" hidden>
              <label>
                <span class="sr-only">记忆卡状态</span>
                <select id="memory-status">
                  <option value="NORMAL">记忆卡</option>
                  <option value="ARCHIVED">已归档</option>
                  <option value="ALL">全部记忆卡</option>
                  <option value="TRASH">回收站</option>
                </select>
              </label>
            </div>
            <nav id="memory-tags" aria-label="记忆卡标签" />
            <nav
              id="memory-time-navigation"
              class="memory-time-navigation"
              aria-label="记忆卡年月导航"
              hidden
            />
          </div>
        </details>
        <div class="memory-main">
          <div class="memory-controls">
            <label class="memory-search">
              <span class="sr-only">搜索记忆卡</span>
              <input id="memory-search" type="search" placeholder="搜索记忆卡" autoComplete="off" />
            </label>
            <div class="memory-view-switch" role="group" aria-label="记忆卡视图">
              <button type="button" data-memory-view="cards" aria-pressed="true" title="卡片视图">
                卡片
              </button>
              <button
                type="button"
                data-memory-view="timeline"
                aria-pressed="false"
                title="时间线视图"
              >
                时间线
              </button>
            </div>
            <label>
              <span class="sr-only">记忆卡排序</span>
              <select id="memory-sort">
                <option value="created-desc">最新创建</option>
                <option value="created-asc">最早创建</option>
                <option value="modified-desc">最近更新</option>
                <option value="modified-asc">最早更新</option>
              </select>
            </label>
          </div>
          <div id="memory-active-filter" hidden />
          <p id="memory-message" role="status" aria-live="polite">
            正在加载…
          </p>
          <div id="memory-cards" class="memory-card-grid" />
          <div id="memory-timeline" class="memory-timeline" hidden />
          <Pagination prefix="memory" label="记忆卡分页" hidden />
        </div>
      </div>
    </section>
  )
}
