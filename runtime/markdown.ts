import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { VFile } from "vfile"
import { toHtml } from "hast-util-to-html"
import { ObsidianFlavoredMarkdown } from "@quartz-community/obsidian-flavored-markdown"
import { GitHubFlavoredMarkdown } from "@quartz-community/github-flavored-markdown"
import { SyntaxHighlighting } from "./syntax"
import { TableOfContentsTransformer } from "@quartz-community/table-of-contents"
import { CrawlLinks } from "@quartz-community/crawl-links"
import { Description } from "@quartz-community/description"
import { slugTag } from "@quartz-community/utils"
import type { BuildCtx, QuartzTransformerPluginInstance } from "@quartz-community/types"
import type { Root } from "hast"
import { renderTranscludes } from "../quartz/util/transclusions"
import { prepareArticleLinks } from "../quartz/util/article-links"
import { prepareArticleImages } from "../quartz/util/article-images"

// Keep this version in compiled-document keys when changing any rendering semantics.
export const MARKDOWN_VERSION = "quartz-live-2"

// This follows the existing Quartz transformer order. Only NoteProperties and Latex's
// selected KaTeX branch are adapted: importing their other Node engines is unnecessary.
export function createMarkdownCompiler(allSlugs: string[]) {
  const ctx = {
    allSlugs,
    allFiles: [],
    argv: { directory: "content", verbose: false },
    cfg: { configuration: { locale: "zh-CN" } },
  } as unknown as BuildCtx
  const transformers: QuartzTransformerPluginInstance[] = [
    SyntaxHighlighting(),
    ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false, enableCheckbox: true }),
    GitHubFlavoredMarkdown(),
    TableOfContentsTransformer(),
    CrawlLinks({ markdownLinkResolution: "absolute" }),
    Description(),
    {
      name: "Latex",
      markdownPlugins: () => [remarkMath],
      htmlPlugins: () => [[rehypeKatex, { output: "html", macros: {} }]],
    },
  ]
  const markdown = unified()
    .use(remarkParse)
    .use(transformers.flatMap((plugin) => plugin.markdownPlugins?.(ctx) || []))
  const html = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(transformers.flatMap((plugin) => plugin.htmlPlugins?.(ctx) || []))

  return async (source: string, metadata: Record<string, unknown>, slug: string) => {
    let rendered = source.trim()
    for (const plugin of transformers)
      if (plugin.textTransform) rendered = plugin.textTransform(ctx, rendered)
    const file = new VFile({ value: rendered, path: `content/${slug}.md` })
    file.data = {
      slug,
      relativePath: `${slug}.md`,
      filePath: `content/${slug}.md`,
      frontmatter: {
        ...metadata,
        tags: [...new Set(((metadata.tags || []) as string[]).map((tag) => slugTag(tag)))],
      },
    }
    const mdTree = await markdown.run(markdown.parse(file), file)
    const tree = (await html.run(mdTree, file)) as Root
    return { tree, data: file.data }
  }
}

export function transclusionTargets(tree: Root) {
  const targets = new Set<string>()
  function walk(node: any) {
    if (
      node.type === "element" &&
      node.tagName === "blockquote" &&
      node.properties?.className?.includes("transclude")
    ) {
      const slug = node.children?.[0]?.properties?.["data-slug"]
      if (typeof slug === "string") targets.add(slug)
    }
    for (const child of node.children || []) walk(child)
  }
  walk(tree)
  return [...targets].sort()
}

export function renderArticleFragment(tree: Root, slug: string, allFiles: any[]) {
  const expanded = structuredClone(tree)
  renderTranscludes(
    expanded,
    { locale: "zh-CN" } as any,
    slug as any,
    { allFiles } as any,
    new Set([slug]) as any,
  )
  return toHtml(prepareArticleLinks(prepareArticleImages(expanded)))
}
