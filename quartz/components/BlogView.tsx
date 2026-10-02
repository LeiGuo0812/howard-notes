import { QuartzComponent, QuartzComponentProps } from "./types"
import { FullSlug, pathToRoot, resolveRelative, simplifySlug } from "../util/path"
import { PageFrame } from "./frames/types"
import { slug } from "github-slugger"
import { cloneElement, isValidElement, ComponentChildren } from "preact"
import siteSettings from "../../library/site.json"
import { ARTICLES_PER_PAGE } from "./scripts/browsing"
import { prepareArticleImages } from "../util/article-images"
import { prepareArticleLinks } from "../util/article-links"
import { MemoryHub } from "./MemoryView"
import { PrivateNotesHub } from "./PrivateNotesView"
import { PageScrollControls } from "./PageScrollControls"
import { Pagination } from "./Pagination"
import {
  designStyle,
  orderedSections,
  sectionLimit,
  sitePages,
} from "../../scripts/lib/site-design.mjs"

type Row = {
  id: string
  title: string
  date: string
  created: string
  modified: string
  category: string
  categoryKey?: string
  excerpt: string
  thumbnail?: { src: string; alt: string }
  tags: { id: string; title: string }[]
}
type Topic = {
  id: string
  title: string
  category: string
  visible: boolean
  count: number
  preview: Row[]
  previewPool: Row[]
}
type Day = {
  date: string
  count: number
  created: number
  modified: number
  level: number
  inRange: boolean
}
type Period = {
  id: string
  label: string
  asOf: string
  from: string
  total: number
  weeks: { month: string; days: Day[] }[]
}
export type BlogData = {
  settings: typeof siteSettings
  topics: Topic[]
  total: number
  tags: { id: string; title: string; count: number }[]
  articles: Row[]
  featured: Row[]
  recent: Row[]
  collections: { id: string; title: string; enabled: boolean; count: number }[]
  activity: { selected: string; periods: Period[] }
}
type Listing = {
  rows: Row[]
  baseRoute: string
  parent: string
  parentLabel: string
  total: number
  topicId?: string
}
let staticBlogData: BlogData | undefined
export function setStaticBlogData(value: BlogData) {
  staticBlogData = value
}
const data = (props: QuartzComponentProps): BlogData => {
  const result = props.runtimeData ?? staticBlogData
  if (!result)
    throw new Error("笔记页面缺少数据：请提供 runtimeData，或在 Quartz 构建前加载静态博客数据。")
  return result
}
const root = (props: QuartzComponentProps) =>
  props.fileData.slug === "404"
    ? new URL(`https://${props.cfg.baseUrl}`).pathname.replace(/\/$/, "")
    : pathToRoot(props.fileData.slug!)
const href = (props: QuartzComponentProps, route: string) =>
  props.fileData.slug === "404"
    ? `${root(props)}/${simplifySlug(route as FullSlug).replace(/^\//, "")}`
    : resolveRelative(props.fileData.slug!, route as FullSlug)
const navRoutes: Record<string, string> = {
  notes: "notes/index",
  topics: "topics/index",
  tags: "tags/index",
  memories: "memory/index",
  about: "about",
}
function PrivateNavigation({ props }: { props: QuartzComponentProps }) {
  return (
    <a
      class="internal private-notes-nav"
      data-private-nav
      data-nav-id="private"
      data-no-popover="true"
      href={href(props, "private/index")}
      aria-current={props.fileData.frontmatter?.type === "private-hub" ? "page" : undefined}
      hidden
    >
      私密文章
    </a>
  )
}
export const BlogNav: QuartzComponent = (props) => (
  <>
    <a class="blog-brand internal" href={href(props, "index")} data-no-popover="true">
      <span class="brand-mark" aria-hidden="true">
        {data(props).settings.brand.mark}
      </span>
      <span>
        <span class="brand-name">{data(props).settings.brand.name}</span>
        <span class="brand-subtitle">{data(props).settings.brand.subtitle}</span>
      </span>
    </a>
    <nav class="blog-nav" aria-label="主导航">
      {data(props).settings.navigation.map((item) => (
        <>
          <a
            class="internal"
            data-nav-id={item.id}
            hidden={!item.visible}
            data-no-popover="true"
            href={href(props, navRoutes[item.id])}
            aria-current={
              (item.id === "notes" && props.fileData.slug?.startsWith("collections/")) ||
              props.fileData.slug?.startsWith(navRoutes[item.id].replace("/index", ""))
                ? "page"
                : undefined
            }
          >
            {item.label}
          </a>
          {item.id === "notes" && <PrivateNavigation props={props} />}
        </>
      ))}
      {!data(props).settings.navigation.some((item) => item.id === "notes") && (
        <PrivateNavigation props={props} />
      )}
      <a
        class="blog-admin"
        href={`${root(props)}/admin/`}
        data-router-ignore
        data-maintenance-login
        title="登录网站维护"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path
            d="M14 5H5v14h14v-9M14 4l6 6M10 14l2.5-.5L21 5l-3-3-8.5 8.5Z"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <span class="maintenance-login-label">登录</span>
      </a>
      <span class="maintenance-status" data-maintenance-status role="status" hidden>
        <span class="maintenance-status-dot" aria-hidden="true" />
        已登录
      </span>
    </nav>
  </>
)

function TopicChips({ props }: { props: QuartzComponentProps }) {
  return (
    <nav class="topic-chips" aria-label="专题标签">
      {data(props).topics.map((topic) => (
        <a
          class="internal topic-chip"
          data-topic-id={topic.id}
          hidden={!topic.visible}
          data-no-popover="true"
          id={slug(topic.category)}
          href={href(props, `topics/${topic.id}`)}
        >
          <span>{topic.title}</span>
          <small>{topic.count}</small>
        </a>
      ))}
    </nav>
  )
}
function TagChips({
  props,
  tags = data(props).tags,
}: {
  props: QuartzComponentProps
  tags?: { id: string; title: string; count?: number }[]
}) {
  return (
    <nav class="topic-chips tag-chips" aria-label="笔记标签">
      {tags.map((tag) => (
        <a class="internal topic-chip" data-no-popover="true" href={href(props, `tags/${tag.id}`)}>
          <span class="tag-symbol" aria-hidden="true">
            #
          </span>
          <span>{tag.title}</span>
          {tag.count !== undefined && <small class="tag-count">{tag.count}</small>}
        </a>
      ))}
    </nav>
  )
}
function NotePreview({
  props,
  row,
  compact = false,
  hidden = false,
  frosted = false,
}: {
  props: QuartzComponentProps
  row: Row
  compact?: boolean
  hidden?: boolean
  frosted?: boolean
}) {
  const card = (
    <a
      class={`internal note-preview${compact ? " compact-preview" : ""}${frosted ? " frosted-panel" : ""}`}
      data-spotlight={frosted ? "" : undefined}
      hidden={hidden}
      data-no-popover="true"
      href={href(props, `notes/${row.id}`)}
    >
      <div class="preview-note-heading">
        <h3>{row.title}</h3>
        <time dateTime={row.modified} title={`创建 ${row.created} · 更新 ${row.modified}`}>
          {row.modified}
        </time>
      </div>
      {row.excerpt && <p>{row.excerpt}</p>}
      {!compact && <small data-category={row.categoryKey || row.category}>{row.category}</small>}
    </a>
  )
  return frosted ? <div class="frost-environment lucky-preview-surface">{card}</div> : card
}
function TopicDirectory({ props }: { props: QuartzComponentProps }) {
  const cards = sitePages(data(props).settings).topicLayout === "cards"
  return (
    <div class={`topic-directory topic-layout-${cards ? "cards topic-card-grid" : "list"}`}>
      {data(props).topics.map((topic) => (
        <section
          class={`topic-section topic-card${cards ? " frosted-panel" : ""}`}
          data-spotlight={cards ? "" : undefined}
          data-topic-id={topic.id}
          hidden={!topic.visible}
          aria-labelledby={`topic-${topic.id}`}
        >
          <div class="topic-section-heading">
            <h2 id={`topic-${topic.id}`}>
              <a class="internal" data-no-popover="true" href={href(props, `topics/${topic.id}`)}>
                {topic.title}
              </a>
            </h2>
            <a
              class="internal topic-more"
              data-no-popover="true"
              href={href(props, `topics/${topic.id}`)}
            >
              {topic.count} 篇 <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div class="topic-note-previews">
            {topic.preview.length ? (
              topic.previewPool.map((row, index) => (
                <NotePreview
                  props={props}
                  row={row}
                  compact
                  hidden={index >= sitePages(data(props).settings).topicPreviewCount}
                />
              ))
            ) : (
              <p class="empty-list">暂无文章</p>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
function ReadingGraph({
  props,
  Component,
}: {
  props: QuartzComponentProps
  Component: QuartzComponent
}) {
  const current = data(props).articles.find((row) => `notes/${row.id}` === props.fileData.slug)
  if (!current) return <Component {...props} />
  const outgoing = new Set(props.fileData.links || [])
  const tags = new Set(current.tags.map((tag) => tag.id))
  const related = data(props)
    .articles.filter((row) => row.id !== current.id)
    .map((row) => {
      const file = props.allFiles.find((file) => file.slug === `notes/${row.id}`)
      const references =
        outgoing.has(simplifySlug(`notes/${row.id}` as FullSlug)) ||
        file?.links?.includes(simplifySlug(props.fileData.slug!))
      const common = row.tags.filter((tag) => tags.has(tag.id)).length
      return {
        row,
        score: (references ? 100 : 0) + common * 10 + Number(row.category === current.category),
        relation: references ? "笔记引用" : common ? "共同标签" : "同一专题",
      }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title, "zh-CN"))
    .slice(0, 6)
  const positions = [
    [52, 48],
    [268, 48],
    [48, 155],
    [272, 155],
    [72, 260],
    [248, 260],
  ]
  const lines = (title: string) => {
    const chars = [...title]
    return chars.length > 22
      ? [chars.slice(0, 11).join(""), chars.slice(11, 21).join("") + "…"]
      : [chars.slice(0, 11).join(""), chars.slice(11).join("")]
  }
  const graph = (
    <svg class="note-relationship-graph" viewBox="0 0 320 330" aria-label="笔记关系图谱">
      {related.map((item, index) => (
        <path
          class={item.relation === "笔记引用" ? "reference-edge" : "topic-edge"}
          d={`M160 144 L${positions[index][0]} ${positions[index][1]}`}
        >
          <title>{item.relation}</title>
        </path>
      ))}
      <circle class="current-node" cx="160" cy="144" r="7" />
      <text class="current-node-title" x="160" y="126" text-anchor="middle">
        <title>{current.title}</title>
        {[...current.title].slice(0, 16).join("")}
        {[...current.title].length > 16 ? "…" : ""}
      </text>
      {related.map(({ row, relation }, index) => {
        const [x, y] = positions[index]
        return (
          <a
            class="internal graph-note"
            href={href(props, `notes/${row.id}`)}
            data-no-popover="true"
            aria-label={row.title}
          >
            <title>
              {row.title} · {relation}
            </title>
            <circle cx={x} cy={y} r="4" />
            <text x={index % 2 ? 174 : 14} y={y + 22}>
              {lines(row.title).map((line, i) => (
                <tspan x={index % 2 ? 174 : 14} dy={i ? 16 : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          </a>
        )
      })}
    </svg>
  )
  // Keep Quartz's full-graph button and dialog, replace only the small local canvas.
  // Generated listing pages are navigation, so local relations use actual notes.
  const replace = (node: ComponentChildren): ComponentChildren => {
    if (Array.isArray(node)) return node.map(replace)
    if (!isValidElement(node)) return node
    const attributes = node.props as { class?: string; children?: ComponentChildren }
    if (attributes.class === "graph-container") return graph
    return cloneElement(node, {}, replace(attributes.children))
  }
  return <>{replace(Component(props))}</>
}
function Heatmap({ props }: { props: QuartzComponentProps }) {
  const activity = data(props).activity
  return (
    <div class="activity-chart">
      <label class="activity-period-label">
        年份
        <select id="activity-period" aria-label="笔记活动年份" value={activity.selected}>
          {activity.periods.map((period) => (
            <option value={period.id}>{period.label}</option>
          ))}
        </select>
      </label>
      {activity.periods.map((period) => (
        <div
          class="activity-period"
          data-activity-period={period.id}
          hidden={period.id !== activity.selected}
        >
          <div class="activity-summary">
            <span>{period.total} 次笔记活动</span>
            <span>
              {period.from} — {period.asOf}
            </span>
          </div>
          <div
            class="heatmap-scroll"
            tabIndex={0}
            role="group"
            aria-label={`${period.label}共 ${period.total} 次笔记创建或更新`}
          >
            <div class="heatmap-weekdays" aria-hidden="true">
              <span>一</span>
              <span>三</span>
              <span>五</span>
            </div>
            <div class="heatmap-weeks">
              {period.weeks.map((week) => (
                <div class="heatmap-week">
                  <span class="heatmap-month">{week.month}</span>
                  {week.days.map((day) => {
                    const label = `${day.date} · ${day.count} 篇 · 创建 ${day.created} / 更新 ${day.modified}`
                    const cls = `heatmap-day level-${day.level}${day.inRange ? "" : " outside"}`
                    return day.count > 0 ? (
                      <a
                        class={`${cls} internal`}
                        data-no-popover="true"
                        title={label}
                        aria-label={label}
                        data-date={day.date}
                        data-count={day.count}
                        href={`${href(props, "notes/index")}?activity=${day.date}`}
                      />
                    ) : (
                      <span
                        class={cls}
                        title={day.inRange ? label : undefined}
                        data-date={day.date}
                        data-count={day.count}
                        aria-hidden="true"
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
      <div class="heatmap-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i class={`heatmap-day level-${level}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  )
}
export const BlogHome: QuartzComponent = (props) => {
  if (props.fileData.slug !== "index") return null
  const { settings, total } = data(props)
  // Keep activity last even when older saved settings used another order.
  const sections = orderedSections(settings)
  return (
    <div
      class={`home-workspace layout-${settings.home.layout} density-${settings.home.density}`}
      data-home-template={sitePages(settings).homeTemplate}
    >
      <p class="home-eyebrow">
        <span class="home-identity">{settings.brand.name}</span>
        {settings.brand.subtitle && (
          <>
            <span aria-hidden="true">/</span>
            <span class="home-identity-subtitle">{settings.brand.subtitle}</span>
          </>
        )}
      </p>
      <div class="home-heading">
        <h1>{settings.home.title}</h1>
        <span>{total} 篇</span>
      </div>
      <p class="home-description" hidden={!settings.home.description}>
        {settings.home.description}
      </p>
      <div class="home-modules">
        {sections.map((section) => (
          <section
            class={`home-module module-${section.id}`}
            data-section-id={section.id}
            hidden={!section.enabled}
            aria-labelledby={`section-${section.id}`}
          >
            <div class="module-heading">
              <div class="module-title">
                <h2 id={`section-${section.id}`}>{section.title}</h2>
                {section.id === "featured" && (
                  <button
                    type="button"
                    id="refresh-random-notes"
                    aria-label="换一组文章"
                    title="换一组"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      aria-hidden="true"
                    >
                      <path d="M20 7v5h-5M4 17v-5h5" />
                      <path d="M6.1 7a7 7 0 0 1 11.5-1L20 12M4 12l2.4 6A7 7 0 0 0 17.9 17" />
                    </svg>
                    <span>换一组</span>
                  </button>
                )}
              </div>
              {["featured", "recent", "memories"].includes(section.id) && (
                <a
                  class="internal"
                  data-no-popover="true"
                  href={href(
                    props,
                    section.id === "memories"
                      ? "memory/index"
                      : section.id === "featured"
                        ? "notes/index"
                        : `collections/${section.id}`,
                  )}
                >
                  全部 <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
            {section.id === "featured" ? (
              <>
                <div
                  class="home-note-previews lucky-previews"
                  id="random-notes"
                  data-count={sectionLimit(section)}
                >
                  {data(props)
                    .articles.slice(0, sectionLimit(section))
                    .map((row) => (
                      <NotePreview props={props} row={row} frosted />
                    ))}
                </div>
                <template id="random-note-pool">
                  {data(props).articles.map((row) => (
                    <NotePreview props={props} row={row} />
                  ))}
                </template>
              </>
            ) : section.id === "recent" ? (
              <div class={`home-note-previews ${section.id}-previews`}>
                {data(props)[section.id].length ? (
                  data(props)[section.id].map((row) => (
                    <NotePreview props={props} row={row} compact={section.id === "recent"} />
                  ))
                ) : (
                  <p class="empty-list">暂无文章</p>
                )}
              </div>
            ) : section.id === "topics" ? (
              <TopicChips props={props} />
            ) : section.id === "memories" ? (
              <div
                id="home-memory-previews"
                class="home-memory-previews"
                data-memory-base={`${root(props)}/`}
                data-memory-route={href(props, "memory/index")}
                data-count="4"
                aria-live="polite"
              >
                <p class="home-memory-message" role="status">
                  正在加载…
                </p>
              </div>
            ) : (
              <Heatmap props={props} />
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
function ListingPage({ props, listing }: { props: QuartzComponentProps; listing: Listing }) {
  const articleTags = new Map<string, { id: string; title: string; count: number }>()
  for (const row of listing.rows) {
    for (const tag of row.tags) {
      const current = articleTags.get(tag.id)
      if (current) current.count += 1
      else articleTags.set(tag.id, { ...tag, count: 1 })
    }
  }
  const tags = [...articleTags.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "zh-CN", { numeric: true }),
  )
  return (
    <section class="listing-page" aria-label="文章列表">
      <div class="listing-summary">
        <a class="internal" data-no-popover="true" href={href(props, listing.parent)}>
          ← {listing.parentLabel}
        </a>
        <span id="listing-count" role="status" aria-live="polite">
          {listing.total} 篇
        </span>
      </div>
      <div class="listing-sidebar-anchor">
        <details class="timeline-sidebar" id="timeline-sidebar">
          <summary
            aria-label="展开文章标签导航"
            aria-controls="listing-sidebar-panels"
            title="文章标签"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            >
              <path d="M5 8h14M4 16h14M10 3 7 21M17 3l-3 18" />
            </svg>
            <span data-listing-sidebar-label>标签</span>
          </summary>
          <div id="listing-sidebar-panels" class="listing-sidebar-panels">
            <div class="listing-sidebar-tabs" role="group" aria-label="文章浏览导航">
              <button
                type="button"
                data-listing-sidebar-tab="tags"
                aria-pressed="true"
                aria-controls="listing-tags"
              >
                标签
              </button>
              <button
                type="button"
                data-listing-sidebar-tab="time"
                aria-pressed="false"
                aria-controls="timeline-navigation"
                hidden
              >
                年月
              </button>
            </div>
            <nav id="listing-tags" aria-label="文章标签">
              <a
                class="listing-tag-link"
                data-listing-tag=""
                data-router-ignore
                href={href(props, listing.baseRoute)}
              >
                <span>全部文章</span>
                <small>{listing.rows.length}</small>
              </a>
              {tags.map((tag) => (
                <a
                  class="listing-tag-link"
                  data-listing-tag={tag.id}
                  data-router-ignore
                  href={href(props, `tags/${tag.id}`)}
                  title={`#${tag.title} · ${tag.count} 篇文章`}
                >
                  <span>#{tag.title}</span>
                  <small>{tag.count}</small>
                </a>
              ))}
            </nav>
            <nav id="timeline-navigation" aria-label="时间线年份与月份导航" hidden />
          </div>
        </details>
      </div>
      <div class="listing-controls">
        <label class="listing-search">
          <span class="sr-only">搜索文章</span>
          <input id="listing-search" type="search" placeholder="搜索标题、专题、标签" />
        </label>
        <div class="listing-view-switch" role="group" aria-label="文章视图">
          <button type="button" data-listing-view="list" aria-pressed="true" title="列表视图">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            >
              <path d="M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01" />
            </svg>
            列表
          </button>
          <button
            type="button"
            data-listing-view="timeline"
            aria-pressed="false"
            title="时间线视图"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            >
              <path d="M6 3v18M10 6h10M10 12h8M10 18h10" />
              <circle cx="6" cy="6" r="1.5" />
              <circle cx="6" cy="12" r="1.5" />
              <circle cx="6" cy="18" r="1.5" />
            </svg>
            时间线
          </button>
        </div>
        <label class="listing-sort">
          排序
          <select id="listing-sort" aria-label="文章排序" defaultValue="modified-desc">
            <option value="modified-desc">更新：最新在前</option>
            <option value="modified-asc">更新：最早在前</option>
            <option value="created-desc">创建：最新在前</option>
            <option value="created-asc">创建：最早在前</option>
            <option value="title-asc">标题：升序</option>
            <option value="title-desc">标题：降序</option>
          </select>
        </label>
        <label class="timeline-jump" hidden>
          <span>跳转</span>
          <select id="timeline-jump" aria-label="跳转到年份或月份" />
        </label>
      </div>
      <div class="activity-filter" id="activity-filter" hidden>
        <span id="activity-filter-date" />
        <button type="button" id="clear-activity-filter">
          显示全部
        </button>
      </div>
      <ol class="article-rows" id="sortable-articles">
        {listing.rows.map((row, index) => (
          <li
            hidden={index >= ARTICLES_PER_PAGE}
            data-note-id={row.id}
            data-title={row.title}
            data-created={row.created}
            data-modified={row.modified}
            data-tags={JSON.stringify(row.tags.map((tag) => tag.id))}
            data-search={`${row.title} ${row.category} ${row.tags.map((tag) => tag.title).join(" ")}`}
          >
            <a
              class="internal article-row"
              data-no-popover="true"
              href={href(props, `notes/${row.id}`)}
            >
              <div class="article-row-copy">
                <span class="article-row-title">{row.title}</span>
                <div class="article-row-meta">
                  {!listing.topicId && <small>{row.category}</small>}
                  <time
                    dateTime={row.modified}
                    title={`创建 ${row.created} · 更新 ${row.modified}`}
                  >
                    {row.modified}
                  </time>
                </div>
                {row.excerpt && <p class="article-row-excerpt">{row.excerpt}</p>}
              </div>
              {row.thumbnail && (
                <span class="article-thumbnail" aria-hidden="true">
                  <img
                    src={
                      /^(?:https?:\/\/|\/)/i.test(row.thumbnail.src)
                        ? row.thumbnail.src
                        : `${root(props)}/${row.thumbnail.src}`
                    }
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    data-article-thumbnail
                    width="128"
                    height="96"
                  />
                </span>
              )}
            </a>
          </li>
        ))}
      </ol>
      <div class="article-timeline" id="article-timeline" hidden aria-label="文章时间线" />

      <Pagination
        prefix="listing"
        label="文章分页"
        totalPages={Math.max(1, Math.ceil(listing.total / ARTICLES_PER_PAGE))}
      />
      <p class="empty-list" id="listing-empty" hidden={listing.rows.length > 0}>
        暂无文章
      </p>
    </section>
  )
}
export const BlogFooter: QuartzComponent = (props) => (
  <footer class="blog-footer">
    <span>{data(props).settings.footer}</span>
    <div>
      <a href={`${root(props)}/index.xml`} data-router-ignore>
        RSS
      </a>
      <a href="https://github.com/LeiGuo0812/howard-notes">GitHub</a>
    </div>
  </footer>
)
type MaintenanceAction =
  "new" | "drafts" | "private" | "articles" | "trash" | "settings" | "reconnect" | "logout" | "edit"
function MaintenanceIcon({ action }: { action: MaintenanceAction }) {
  const paths: Record<MaintenanceAction, string> = {
    new: "M12 5v14M5 12h14",
    drafts: "M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8M8 16h5",
    private: "M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
    articles: "M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01",
    settings: "M4 5h16v14H4ZM4 10h16M10 10v9",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
    reconnect: "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 12M4 12l2.4 6A7 7 0 0 0 17.9 17",
    logout: "M9 4H4v16h5M14 8l4 4-4 4M8 12h12",
    edit: "M14 5H5v14h14v-9M14 4l6 6M10 14l2.5-.5L21 5l-3-3-8.5 8.5Z",
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[action]} />
    </svg>
  )
}
function MaintenanceButton({ action, label }: { action: MaintenanceAction; label: string }) {
  return (
    <button
      type="button"
      data-maintenance-action={action}
      aria-label={label}
      title={label}
      data-tooltip={label}
    >
      <MaintenanceIcon action={action} />
      <span class="maintenance-tool-label">{label}</span>
    </button>
  )
}
function MaintenanceTools() {
  return (
    <>
      <div class="maintenance-primary-tools">
        <MaintenanceButton action="new" label="新建文章" />
        <MaintenanceButton action="drafts" label="草稿箱" />
        <MaintenanceButton action="articles" label="文章管理" />
        <MaintenanceButton action="trash" label="回收站" />
        <MaintenanceButton action="settings" label="页面设置" />
      </div>
      <div class="maintenance-session-tools">
        <span class="maintenance-account" />
        <MaintenanceButton action="reconnect" label="重新登录" />
        <MaintenanceButton action="logout" label="退出登录" />
      </div>
    </>
  )
}
export const BlogFrame: PageFrame = {
  name: "blog",
  render({ componentData, header, beforeBody, pageBody: Content, afterBody, left, right, footer }) {
    const props = componentData
    const home = componentData.fileData.slug === "index",
      type = componentData.fileData.frontmatter?.type
    const article = type === "article",
      hub = type === "topic-hub" || type === "tag-hub",
      listing = type === "listing",
      memory = type === "memory-hub",
      privateNotes = type === "private-hub"
    const listingData = componentData.fileData.frontmatter?.listing as Listing | undefined
    const current = article
      ? data(props).articles.find((row) => componentData.fileData.slug === `notes/${row.id}`)
      : undefined
    return (
      <div
        class={`site-surface accent-${data(props).settings.accent}`}
        data-article-layout={sitePages(data(props).settings).articleLayout}
        style={designStyle(data(props).settings)}
      >
        <a class="skip-link" href="#main-content">
          跳到正文
        </a>
        <header class="blog-header">
          {header.map((Component) => (
            <Component {...componentData} />
          ))}
        </header>
        <nav
          class={`maintenance-toolbar${article ? " is-reading" : ""}`}
          aria-label="网站维护"
          hidden
        >
          {article || privateNotes ? (
            <details class="maintenance-tool-dock" open>
              <summary
                class="maintenance-dock-toggle"
                aria-label="维护工具"
                title="维护工具"
                data-tooltip="维护工具"
              >
                <MaintenanceIcon action="settings" />
              </summary>
              <div class="maintenance-dock-content">
                <MaintenanceTools />
              </div>
            </details>
          ) : (
            <MaintenanceTools />
          )}
        </nav>
        <div
          class={`blog-layout ${home ? "is-home" : ""} ${article ? "is-article" : ""} ${hub || listing || memory || privateNotes ? "is-directory" : ""} ${memory ? "is-memory" : ""} ${privateNotes ? "is-private" : ""}`}
        >
          {article && (
            <aside class="left sidebar reading-sidebar" aria-label="文章导航">
              <details class="reading-tools">
                <summary aria-label="目录与图谱" title="目录与图谱">
                  <span class="reading-tools-label">目录与图谱</span>
                  <span class="reading-tools-mobile-label" aria-hidden="true">
                    目录
                    <br />
                    图谱
                  </span>
                </summary>
                <div class="reading-tool-panels">
                  <div class="reading-drawer-header">
                    <strong>目录与图谱</strong>
                    <button
                      type="button"
                      data-reading-close
                      aria-label="收起目录与图谱"
                      title="收起"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        aria-hidden="true"
                      >
                        <path d="m6 6 12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                  {left.map((Component) => {
                    if (Component.name === "Graph")
                      return <ReadingGraph props={componentData} Component={Component} />
                    const panel = Component(componentData)
                    return panel && Component.name === "TableOfContents" ? (
                      <div class="frost-environment reading-toc-surface">{panel}</div>
                    ) : (
                      panel
                    )
                  })}
                </div>
              </details>
            </aside>
          )}
          <main class="center" id="main-content" data-maintenance-article={current?.id}>
            <div class="page-header" hidden={privateNotes}>
              <div class="popover-hint">
                {beforeBody.map((Component) => (
                  <Component {...componentData} />
                ))}
              </div>
              {current && (
                <div class="article-note-meta">
                  <span title={String(componentData.fileData.frontmatter?.created)}>
                    创建 {current.created}
                  </span>
                  <span>更新 {current.modified}</span>
                  {current.tags.length > 0 && (
                    <TagChips props={componentData} tags={current.tags} />
                  )}
                </div>
              )}
              {current && (
                <button
                  class="article-share-button"
                  type="button"
                  data-article-share={current.id}
                  aria-label="分享文章"
                  title="分享文章"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 15V3m-4 4 4-4 4 4M5 10v10h14V10"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              )}
              {current && (
                <button
                  class="maintenance-edit"
                  type="button"
                  data-maintenance-action="edit"
                  aria-label="编辑文章"
                  title="编辑文章"
                  data-tooltip="编辑文章"
                  hidden
                >
                  <MaintenanceIcon action="edit" />
                </button>
              )}
            </div>
            {!privateNotes && <div data-maintenance-slot hidden />}
            {!home &&
              (type === "topic-hub" ? (
                <TopicDirectory props={componentData} />
              ) : type === "tag-hub" ? (
                <TagChips props={componentData} />
              ) : memory ? (
                <MemoryHub {...componentData} />
              ) : privateNotes ? (
                <PrivateNotesHub {...componentData} />
              ) : listing && listingData ? (
                <ListingPage props={componentData} listing={listingData} />
              ) : (
                <Content
                  {...componentData}
                  tree={
                    article
                      ? prepareArticleLinks(prepareArticleImages(componentData.tree))
                      : componentData.tree
                  }
                />
              ))}
            {article && (
              <div class="page-footer">
                {afterBody.map((Component) => (
                  <Component {...componentData} />
                ))}
              </div>
            )}
          </main>
          {article && right.length > 0 && (
            <aside class="article-backlinks" aria-label="反向链接">
              {right.map((Component) => (
                <Component {...componentData} />
              ))}
            </aside>
          )}
        </div>
        <PageScrollControls />
        {footer.map((Component) => (
          <Component {...componentData} />
        ))}
      </div>
    )
  },
}
