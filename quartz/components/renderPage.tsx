import { render } from "preact-render-to-string"
import { QuartzComponent, QuartzComponentProps } from "./types"
import BodyConstructor from "./Body"
import {
  CSSResource,
  JSResource,
  JSResourceToScriptElement,
  StaticResources,
} from "../util/resources"
import { FullSlug, RelativeURL, joinSegments } from "../util/path"
import { clone } from "../util/clone"
import { Root } from "hast"
import { GlobalConfiguration } from "../cfg"
import { i18n } from "../i18n"
import { resolveFrame } from "./frames"
import type { TreeTransform } from "../plugins/types"
import type { BuildCtx } from "../util/ctx"
import { contentIndexScript } from "../runtime/render"
import { sanitizeArticleTree } from "../util/article-security"

import { renderTranscludes } from "../util/transclusions"
export { renderTranscludes } from "../util/transclusions"

interface RenderComponents {
  head: QuartzComponent
  header: QuartzComponent[]
  beforeBody: QuartzComponent[]
  pageBody: QuartzComponent
  afterBody: QuartzComponent[]
  left: QuartzComponent[]
  right: QuartzComponent[]
  footer: QuartzComponent[]
  frame?: string
}

export function pageResources(
  baseDir: FullSlug | RelativeURL,
  staticResources: StaticResources,
  ctx?: BuildCtx,
): StaticResources {
  const hashedNames = ctx?.hashedResourceNames
  const cssFile = hashedNames?.["index.css"] ?? "index.css"
  const prescriptFile = hashedNames?.["prescript.js"] ?? "prescript.js"
  const postscriptFile = hashedNames?.["postscript.js"] ?? "postscript.js"

  const componentCssResources: CSSResource[] = []
  if (ctx?.componentCssMap) {
    const seen = new Set<string>()
    for (const filename of ctx.componentCssMap.values()) {
      if (seen.has(filename)) continue
      seen.add(filename)
      componentCssResources.push({ content: joinSegments(baseDir, filename) })
    }
  }

  const extracted = ctx?.extractedInlineResources
  const resolvedCss: CSSResource[] = staticResources.css.map((resource) => {
    if (!(resource.inline ?? false) || !extracted) return resource
    const filename = extracted.get(resource.content)
    if (!filename) return resource
    return { content: joinSegments(baseDir, filename) }
  })

  const resolvedJs: JSResource[] = staticResources.js.map((resource) => {
    if (resource.contentType !== "inline" || !extracted) return resource
    const filename = extracted.get(resource.script)
    if (!filename) return resource
    return {
      src: joinSegments(baseDir, filename),
      loadTime: resource.loadTime,
      contentType: "external" as const,
      moduleType: resource.moduleType,
      spaPreserve: resource.spaPreserve,
    }
  })

  const basePath = ctx?.argv.serve
    ? ""
    : ctx?.cfg.configuration.baseUrl
      ? new URL(`https://${ctx.cfg.configuration.baseUrl}`).pathname.replace(/\/$/, "")
      : String(baseDir).replace(/\/$/, "")
  const indexLoader = contentIndexScript(basePath)

  const resources: StaticResources = {
    css: [
      {
        content: joinSegments(baseDir, cssFile),
      },
      ...componentCssResources,
      ...resolvedCss,
    ],
    js: [
      {
        src: joinSegments(baseDir, prescriptFile),
        loadTime: "beforeDOMReady",
        contentType: "external",
      },
      {
        loadTime: "beforeDOMReady",
        contentType: "inline",
        spaPreserve: true,
        script: indexLoader,
      },
      ...resolvedJs,
    ],
    additionalHead: staticResources.additionalHead,
  }

  resources.js.push({
    src: joinSegments(baseDir, postscriptFile),
    loadTime: "afterDOMReady",
    moduleType: "module",
    contentType: "external",
  })

  return resources
}

export function renderPage(
  cfg: GlobalConfiguration,
  slug: FullSlug,
  componentData: QuartzComponentProps,
  components: RenderComponents,
  pageResources: StaticResources,
  treeTransforms?: TreeTransform[],
): string {
  // make a deep copy of the tree so we don't remove the transclusion references
  // for the file cached in contentMap in build.ts
  const root = clone(componentData.tree) as Root
  const visited = new Set<FullSlug>([slug])
  renderTranscludes(root, cfg, slug, componentData, visited)

  // Run plugin-provided tree transforms (e.g. resolving inline bases codeblocks)
  if (treeTransforms) {
    for (const transform of treeTransforms) {
      transform(root, slug, componentData)
    }
  }

  // set componentData.tree to the edited html that has transclusions rendered
  componentData.tree = sanitizeArticleTree(root)

  const {
    head: Head,
    header,
    beforeBody,
    pageBody: Content,
    afterBody,
    left,
    right,
    footer,
    frame: frameName,
  } = components
  const Body = BodyConstructor()
  const frame = resolveFrame(frameName)

  const lang = componentData.fileData.frontmatter?.lang ?? cfg.locale?.split("-")[0] ?? "en"
  const direction = i18n(cfg.locale).direction ?? "ltr"
  // During local dev (--serve), the dev server serves from root without the
  // baseUrl subpath, so basePath must be empty to avoid broken links.
  const basePath =
    componentData.ctx.argv.serve || !cfg.baseUrl
      ? ""
      : new URL(`https://${cfg.baseUrl}`).pathname.replace(/\/$/, "")
  const doc = (
    <html lang={lang} dir={direction}>
      <Head {...componentData} />
      <body data-slug={slug} data-basepath={basePath}>
        {frame.css && <style dangerouslySetInnerHTML={{ __html: frame.css }} />}
        <div id="quartz-root" class="page" data-frame={frame.name}>
          <Body {...componentData}>
            {[
              frame.render({
                componentData,
                head: Head,
                header,
                beforeBody,
                pageBody: Content,
                afterBody,
                left,
                right,
                footer,
              }),
            ]}
          </Body>
        </div>
      </body>
      {pageResources.js
        .filter((resource) => resource.loadTime === "afterDOMReady")
        .map((res) => JSResourceToScriptElement(res, true))}
    </html>
  )

  return "<!DOCTYPE html>\n" + render(doc)
}
