import fs from "node:fs"
import { QuartzComponent, QuartzComponentProps } from "./types"
import { FullSlug, pathToRoot, resolveRelative, simplifySlug } from "../util/path"
import { PageFrame } from "./frames/types"
import { slug } from "github-slugger"
import siteSettings from "../../library/site.json"
// @ts-ignore Quartz's inline-script loader turns this module into a JavaScript string.
import browserScript from "./scripts/note-browser.inline"

type Row = {
  id: string
  title: string
  date: string
  created: string
  modified: string
  category: string
  excerpt: string
  tags: { id: string; title: string }[]
}
type Topic = {
  id: string
  title: string
  category: string
  visible: boolean
  count: number
  preview: Row[]
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
type BlogData = {
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
let cached: BlogData | undefined
const data = () =>
  (cached ??= JSON.parse(fs.readFileSync(".local/blog-data.json", "utf8")) as BlogData)
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
  about: "about",
}
export const BlogNav: QuartzComponent = (props) => (
  <>
    <a class="blog-brand internal" href={href(props, "index")} data-no-popover="true">
      <span class="brand-mark" aria-hidden="true">
        {data().settings.brand.mark}
      </span>
      <span>
        {data().settings.brand.name}
        <span class="brand-subtitle">{data().settings.brand.subtitle}</span>
      </span>
    </a>
    <nav class="blog-nav" aria-label="主导航">
      {data()
        .settings.navigation.filter((item) => item.visible)
        .map((item) => (
          <a
            class="internal"
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
        ))}
    </nav>
  </>
)
BlogNav.afterDOMLoaded = browserScript

function TopicChips({ props }: { props: QuartzComponentProps }) {
  return (
    <nav class="topic-chips" aria-label="专题标签">
      {data()
        .topics.filter((topic) => topic.visible)
        .map((topic) => (
          <a
            class="internal topic-chip"
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
  tags = data().tags,
}: {
  props: QuartzComponentProps
  tags?: { id: string; title: string; count?: number }[]
}) {
  return (
    <nav class="topic-chips tag-chips" aria-label="笔记标签">
      {tags.map((tag) => (
        <a class="internal topic-chip" data-no-popover="true" href={href(props, `tags/${tag.id}`)}>
          <span>#{tag.title}</span>
          {tag.count !== undefined && <small>{tag.count}</small>}
        </a>
      ))}
    </nav>
  )
}
function CollectionChips({ props }: { props: QuartzComponentProps }) {
  return (
    <nav class="topic-chips collection-chips" aria-label="文章入口">
      {data()
        .collections.filter((item) => item.enabled)
        .map((item) => (
          <a
            class="internal topic-chip"
            data-no-popover="true"
            href={href(props, `collections/${item.id}`)}
          >
            <span>{item.title}</span>
            <small>{item.count}</small>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
    </nav>
  )
}
function NotePreview({
  props,
  row,
  compact = false,
}: {
  props: QuartzComponentProps
  row: Row
  compact?: boolean
}) {
  return (
    <a
      class={`internal note-preview${compact ? " compact-preview" : ""}`}
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
      {!compact && <small>{row.category}</small>}
    </a>
  )
}
function TopicDirectory({ props }: { props: QuartzComponentProps }) {
  return (
    <div class="topic-directory">
      {data()
        .topics.filter((topic) => topic.visible)
        .map((topic) => (
          <section class="topic-section" aria-labelledby={`topic-${topic.id}`}>
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
                topic.preview.map((row) => <NotePreview props={props} row={row} compact />)
              ) : (
                <p class="empty-list">暂无文章</p>
              )}
            </div>
          </section>
        ))}
    </div>
  )
}
function Heatmap({ props }: { props: QuartzComponentProps }) {
  const activity = data().activity
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
  const { settings, total } = data()
  // Keep activity last even when older saved settings used another order.
  const sections = settings.home.sections
    .filter((section) => section.enabled)
    .sort((a, b) => Number(a.id === "activity") - Number(b.id === "activity"))
  return (
    <div class={`home-workspace layout-${settings.home.layout} density-${settings.home.density}`}>
      <div class="home-heading">
        <h1>{settings.home.title}</h1>
        <span>{total} 篇</span>
      </div>
      {settings.home.description && <p class="home-description">{settings.home.description}</p>}
      <div class="home-modules">
        {sections.map((section) => (
          <section
            class={`home-module module-${section.id}`}
            aria-labelledby={`section-${section.id}`}
          >
            <div class="module-heading">
              <h2 id={`section-${section.id}`}>{section.title}</h2>
              {["featured", "recent"].includes(section.id) && (
                <a
                  class="internal"
                  data-no-popover="true"
                  href={href(props, `collections/${section.id}`)}
                >
                  全部 <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
            {section.id === "featured" || section.id === "recent" ? (
              <div class={`home-note-previews ${section.id}-previews`}>
                {data()[section.id].length ? (
                  data()[section.id].map((row) => (
                    <NotePreview props={props} row={row} compact={section.id === "recent"} />
                  ))
                ) : (
                  <p class="empty-list">暂无文章</p>
                )}
              </div>
            ) : section.id === "topics" ? (
              <TopicChips props={props} />
            ) : section.id === "collections" ? (
              <CollectionChips props={props} />
            ) : section.id === "tags" ? (
              <TagChips props={props} tags={data().tags.slice(0, 12)} />
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
      <div class="listing-controls">
        <label class="listing-search">
          <span class="sr-only">搜索文章</span>
          <input id="listing-search" type="search" placeholder="搜索标题、专题、标签" />
        </label>
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
      </div>
      <div class="activity-filter" id="activity-filter" hidden>
        <span id="activity-filter-date" />
        <button type="button" id="clear-activity-filter">
          显示全部
        </button>
      </div>
      <ol class="article-rows" id="sortable-articles">
        {listing.rows.map((row) => (
          <li
            data-note-id={row.id}
            data-title={row.title}
            data-created={row.created}
            data-modified={row.modified}
            data-search={`${row.title} ${row.category} ${row.tags.map((tag) => tag.title).join(" ")}`}
          >
            <a
              class="internal article-row"
              data-no-popover="true"
              href={href(props, `notes/${row.id}`)}
            >
              <span>{row.title}</span>
              <div>
                {!listing.topicId && <small>{row.category}</small>}
                <time dateTime={row.modified} title={`创建 ${row.created} · 更新 ${row.modified}`}>
                  {row.modified}
                </time>
              </div>
            </a>
          </li>
        ))}
      </ol>
      <p class="empty-list" id="listing-empty" hidden={listing.rows.length > 0}>
        暂无文章
      </p>
    </section>
  )
}
export const BlogFooter: QuartzComponent = (props) => (
  <footer class="blog-footer">
    <span>{data().settings.footer}</span>
    <div>
      <a href={`${root(props)}/index.xml`} data-router-ignore>
        RSS
      </a>
      <a href={`${root(props)}/admin/`} data-router-ignore>
        管理
      </a>
      <a href="https://github.com/LeiGuo0812/howard-notes">GitHub</a>
    </div>
  </footer>
)
export const BlogFrame: PageFrame = {
  name: "blog",
  render({ componentData, header, beforeBody, pageBody: Content, afterBody, right, footer }) {
    const home = componentData.fileData.slug === "index",
      type = componentData.fileData.frontmatter?.type
    const article = type === "article",
      hub = type === "topic-hub" || type === "tag-hub",
      listing = type === "listing"
    const listingData = componentData.fileData.frontmatter?.listing as Listing | undefined
    const current = article
      ? data().articles.find((row) => componentData.fileData.slug === `notes/${row.id}`)
      : undefined
    return (
      <div class={`site-surface accent-${data().settings.accent}`}>
        <a class="skip-link" href="#main-content">
          跳到正文
        </a>
        <header class="blog-header">
          {header.map((Component) => (
            <Component {...componentData} />
          ))}
        </header>
        <div
          class={`blog-layout ${home ? "is-home" : ""} ${article ? "is-article" : ""} ${hub || listing ? "is-directory" : ""}`}
        >
          <main class="center" id="main-content">
            <div class="page-header">
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
            </div>
            {!home &&
              (type === "topic-hub" ? (
                <TopicDirectory props={componentData} />
              ) : type === "tag-hub" ? (
                <TagChips props={componentData} />
              ) : listing && listingData ? (
                <ListingPage props={componentData} listing={listingData} />
              ) : (
                <Content {...componentData} />
              ))}
            {article && (
              <div class="page-footer">
                {afterBody.map((Component) => (
                  <Component {...componentData} />
                ))}
              </div>
            )}
          </main>
          {article && (
            <aside class="right sidebar" aria-label="文章导航">
              {right.map((Component) => (
                <Component {...componentData} />
              ))}
            </aside>
          )}
        </div>
        {footer.map((Component) => (
          <Component {...componentData} />
        ))}
      </div>
    )
  },
}
