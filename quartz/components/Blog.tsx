import { QuartzComponent, QuartzComponentProps } from "./types"
import { FullSlug, pathToRoot, resolveRelative, simplifySlug } from "../util/path"
import { PageFrame } from "./frames/types"
import { slug } from "github-slugger"

const root = (data: QuartzComponentProps) =>
  data.fileData.slug === "404"
    ? new URL(`https://${data.cfg.baseUrl}`).pathname.replace(/\/$/, "")
    : pathToRoot(data.fileData.slug!)
const href = (data: QuartzComponentProps, slug: string) =>
  data.fileData.slug === "404"
    ? `${root(data)}/${simplifySlug(slug as FullSlug).replace(/^\//, "")}`
    : resolveRelative(data.fileData.slug!, slug as FullSlug)

export const BlogNav: QuartzComponent = (props) => (
  <>
    <a class="blog-brand internal" href={href(props, "index")}>
      <span class="brand-mark" aria-hidden="true">
        h.
      </span>
      <span>
        Howard<span class="brand-subtitle">技术笔记</span>
      </span>
    </a>
    <nav class="blog-nav" aria-label="主导航">
      {[
        ["notes/index", "文章"],
        ["topics", "专题"],
        ["about", "关于"],
      ].map(([slug, label]) => (
        <a
          class="internal"
          href={href(props, slug)}
          aria-current={props.fileData.slug === slug ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  </>
)

export const BlogHome: QuartzComponent = (props) => {
  if (props.fileData.slug !== "index") return null
  const articles = props.allFiles
    .filter((file) => file.frontmatter?.type === "article")
    .sort(
      (a, b) =>
        String(b.frontmatter?.date).localeCompare(String(a.frontmatter?.date)) ||
        a.slug!.localeCompare(b.slug!),
    )
  const featured = articles.filter((file) => file.frontmatter?.featured === true).slice(0, 6)
  const topics = [...new Set(articles.map((file) => String(file.frontmatter?.category)))].map(
    (title) => [
      title,
      `${articles.filter((file) => file.frontmatter?.category === title).length} 篇笔记`,
    ],
  )
  return (
    <div class="home-content">
      <section class="home-intro" aria-labelledby="home-title">
        <div>
          <p class="intro-label">编程 / 数据 / 工具</p>
          <h1 id="home-title">
            把问题记下来，
            <br />
            把方法留下来。
          </h1>
          <p class="intro-description">
            你好，我是
            Howard。这里记录编程、数据分析和工具使用中的实践，也整理那些值得再查一次的知识。
          </p>
          <a class="browse-link internal" href={href(props, "notes/index")}>
            浏览全部文章 <span aria-hidden="true">↗</span>
          </a>
        </div>
        <a class="intro-figure library-intro internal" href={href(props, "topics")}>
          <p class="intro-label">持续积累的知识库</p>
          <p class="library-count">
            {articles.length}
            <span>篇笔记</span>
          </p>
          <div>
            <span>编程、统计与科研工具</span>
            <strong>
              从 {topics.length} 个专题开始阅读 <span aria-hidden="true">↗</span>
            </strong>
          </div>
        </a>
      </section>
      <section class="featured-section" aria-labelledby="featured-heading">
        <h2 id="featured-heading">精选文章</h2>
        <div class="featured-list">
          {featured.map((file) => (
            <a class="featured-entry internal" href={href(props, file.slug!)}>
              <span class="entry-category">{String(file.frontmatter?.category)}</span>
              <h3>{file.frontmatter?.title}</h3>
              <p>{file.frontmatter?.description}</p>
              <span class="entry-more">
                阅读全文 <span aria-hidden="true">↗</span>
              </span>
            </a>
          ))}
        </div>
      </section>
      <div class="home-bottom">
        <section aria-labelledby="latest-heading">
          <h2 id="latest-heading">最近发布</h2>
          <ul class="latest-list">
            {articles.slice(0, 10).map((file) => (
              <li>
                <time dateTime={String(file.frontmatter?.date)}>
                  {String(file.frontmatter?.date).slice(5).replace("-", " / ")}
                </time>
                <a class="internal" href={href(props, file.slug!)}>
                  {file.frontmatter?.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section class="topic-section" aria-labelledby="topics-heading">
          <h2 id="topics-heading">按专题阅读</h2>
          <ul>
            {topics.map(([title, description]) => (
              <li>
                <a class="internal" href={`${href(props, "topics")}#${slug(title)}`}>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

export const BlogFooter: QuartzComponent = (props) => (
  <footer class="blog-footer">
    <span>Howard 的技术笔记</span>
    <div>
      <a href={`${root(props)}/index.xml`}>RSS</a>
      <a href={`${root(props)}/admin/`} data-router-ignore>
        文章管理
      </a>
      <a href="https://github.com/LeiGuo0812/howard-notes">GitHub</a>
      <a href="https://quartz.jzhao.xyz/">Quartz</a>
    </div>
  </footer>
)

export const BlogFrame: PageFrame = {
  name: "blog",
  render({ componentData, header, beforeBody, pageBody: Content, afterBody, right, footer }) {
    const home = componentData.fileData.slug === "index"
    const article = componentData.fileData.frontmatter?.type === "article"
    return (
      <>
        <a class="skip-link" href="#main-content">
          跳到正文
        </a>
        <header class="blog-header">
          {header.map((Component) => (
            <Component {...componentData} />
          ))}
        </header>
        <div class={`blog-layout ${home ? "is-home" : ""} ${article ? "is-article" : ""}`}>
          <main class="center" id="main-content">
            <div class="page-header">
              <div class="popover-hint">
                {beforeBody.map((Component) => (
                  <Component {...componentData} />
                ))}
              </div>
            </div>
            {!home && <Content {...componentData} />}
            <div class="page-footer">
              {afterBody.map((Component) => (
                <Component {...componentData} />
              ))}
            </div>
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
      </>
    )
  },
}
