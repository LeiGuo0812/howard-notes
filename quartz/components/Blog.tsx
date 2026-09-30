import fs from "node:fs"
import { QuartzComponent, QuartzComponentProps } from "./types"
import { FullSlug, pathToRoot, resolveRelative, simplifySlug } from "../util/path"
import { PageFrame } from "./frames/types"
import { slug } from "github-slugger"
import siteSettings from "../../library/site.json"

type Topic = { id: string; title: string; category: string; visible: boolean; count: number }
type Day = { date: string; count: number; level: number; inRange: boolean }
type BlogData = {
  settings: typeof siteSettings
  topics: Topic[]
  total: number
  collections: { id: string; title: string; enabled: boolean; count: number }[]
  activity: { asOf: string; from: string; total: number; weeks: { month: string; days: Day[] }[] }
}
type Listing = {
  rows: { id: string; title: string; date: string; category: string }[]
  page: number
  pageCount: number
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
  about: "about",
}

export const BlogNav: QuartzComponent = (props) => {
  const settings = data().settings
  return (
    <>
      <a class="blog-brand internal" href={href(props, "index")} data-no-popover="true">
        <span class="brand-mark" aria-hidden="true">
          {settings.brand.mark}
        </span>
        <span>
          {settings.brand.name}
          <span class="brand-subtitle">{settings.brand.subtitle}</span>
        </span>
      </a>
      <nav class="blog-nav" aria-label="主导航">
        {settings.navigation
          .filter((item) => item.visible)
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
}
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
function Heatmap() {
  const activity = data().activity
  return (
    <div class="activity-chart">
      <div class="activity-summary">
        <a href="https://github.com/LeiGuo0812/howard-notes/commits/main/">
          {activity.total} 次提交
        </a>
        <span>
          {activity.from} — {activity.asOf}
        </span>
      </div>
      <div
        class="heatmap-scroll"
        tabIndex={0}
        role="group"
        aria-label={`博客仓库最近 365 天共 ${activity.total} 次提交`}
      >
        <div class="heatmap-weekdays" aria-hidden="true">
          <span>一</span>
          <span>三</span>
          <span>五</span>
        </div>
        <div class="heatmap-weeks">
          {activity.weeks.map((week) => (
            <div class="heatmap-week">
              <span class="heatmap-month">{week.month}</span>
              {week.days.map((day) => {
                const label = `${day.date} · ${day.count} 次提交`
                const cls = `heatmap-day level-${day.level}${day.inRange ? "" : " outside"}`
                return day.count > 0 ? (
                  <a
                    class={cls}
                    title={label}
                    aria-label={label}
                    data-date={day.date}
                    data-count={day.count}
                    href={`https://github.com/LeiGuo0812/howard-notes/commits/main/?since=${encodeURIComponent(day.date + "T00:00:00+08:00")}&until=${encodeURIComponent(day.date + "T23:59:59+08:00")}`}
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
  return (
    <div class={`home-workspace layout-${settings.home.layout} density-${settings.home.density}`}>
      <div class="home-heading">
        <h1>{settings.home.title}</h1>
        <span>{total} 篇</span>
      </div>
      {settings.home.description && <p class="home-description">{settings.home.description}</p>}
      <div class="home-modules">
        {settings.home.sections
          .filter((section) => section.enabled)
          .map((section) => (
            <section
              class={`home-module module-${section.id}`}
              aria-labelledby={`section-${section.id}`}
            >
              <h2 id={`section-${section.id}`}>{section.title}</h2>
              {section.id === "topics" ? (
                <TopicChips props={props} />
              ) : section.id === "collections" ? (
                <CollectionChips props={props} />
              ) : (
                <Heatmap />
              )}
            </section>
          ))}
      </div>
    </div>
  )
}
function ListingPage({ props, listing }: { props: QuartzComponentProps; listing: Listing }) {
  const pageHref = (page: number) => href(props, listing.baseRoute + (page > 1 ? `-p${page}` : ""))
  return (
    <section class="listing-page" aria-label="文章列表">
      <div class="listing-summary">
        <a class="internal" data-no-popover="true" href={href(props, listing.parent)}>
          ← {listing.parentLabel}
        </a>
        <span>{listing.total} 篇</span>
      </div>
      {listing.rows.length ? (
        <ol class="article-rows" start={(listing.page - 1) * 24 + 1}>
          {listing.rows.map((row) => (
            <li>
              <a
                class="internal article-row"
                data-no-popover="true"
                href={href(props, `notes/${row.id}`)}
              >
                <span>{row.title}</span>
                <div>
                  {!listing.topicId && <small>{row.category}</small>}
                  <time dateTime={row.date}>{row.date}</time>
                </div>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p class="empty-list">暂无文章</p>
      )}
      {listing.pageCount > 1 && (
        <nav class="pagination" aria-label="列表分页">
          {listing.page > 1 && (
            <a class="internal" data-no-popover="true" href={pageHref(listing.page - 1)}>
              上一页
            </a>
          )}
          {Array.from({ length: listing.pageCount }, (_, i) => i + 1).map((page) => (
            <a
              class="internal"
              data-no-popover="true"
              href={pageHref(page)}
              aria-current={page === listing.page ? "page" : undefined}
            >
              {page}
            </a>
          ))}
          {listing.page < listing.pageCount && (
            <a class="internal" data-no-popover="true" href={pageHref(listing.page + 1)}>
              下一页
            </a>
          )}
        </nav>
      )}
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
    const home = componentData.fileData.slug === "index"
    const type = componentData.fileData.frontmatter?.type
    const article = type === "article",
      hub = type === "topic-hub" || type === "collection-hub",
      listing = type === "listing"
    const listingData = componentData.fileData.frontmatter?.listing as Listing | undefined
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
            </div>
            {!home &&
              (type === "topic-hub" ? (
                <TopicChips props={componentData} />
              ) : type === "collection-hub" ? (
                <CollectionChips props={componentData} />
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
