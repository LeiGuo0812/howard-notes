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
import type { Root as MarkdownRoot } from "mdast"
import type { FullSlug, FilePath } from "../quartz/util/path"
import { renderTranscludes } from "../quartz/util/transclusions"
import { prepareArticleLinks } from "../quartz/util/article-links"
import { prepareArticleImages } from "../quartz/util/article-images"
import {
  sanitizeSourceTree,
  sanitizeArticleTree,
  articleHeadingId,
} from "../quartz/util/article-security"

// Keep this version in compiled-document keys when changing any rendering semantics.
export const MARKDOWN_VERSION = "quartz-live-3-safe-html"

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
    .use(() => (tree: Root) => sanitizeSourceTree(tree))
    .use(transformers.flatMap((plugin) => plugin.htmlPlugins?.(ctx) || []))
    .use(() => (tree: Root, file: VFile) => {
      const toc = file.data.toc
      if (toc)
        file.data.toc = toc.map((entry) => ({ ...entry, slug: articleHeadingId(entry.slug) }))
      return sanitizeArticleTree(tree)
    })

  return async (source: string, metadata: Record<string, unknown>, slug: string) => {
    let rendered = source.trim()
    for (const plugin of transformers)
      if (plugin.textTransform) rendered = plugin.textTransform(ctx, rendered)
    const file = new VFile({ value: rendered, path: `content/${slug}.md` })
    file.data = {
      slug: slug as FullSlug,
      relativePath: `${slug}.md` as FilePath,
      filePath: `content/${slug}.md` as FilePath,
      frontmatter: {
        ...metadata,
        title: String(metadata.title ?? slug),
        tags: [...new Set(((metadata.tags || []) as string[]).map((tag) => slugTag(tag)))],
      },
    }
    const mdTree = await markdown.run(markdown.parse(file), file)
    const tree = (await html.run(mdTree as MarkdownRoot, file)) as Root
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
      const properties = node.children?.[0]?.properties
      const slug = properties?.["data-slug"] ?? properties?.dataSlug
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
  return toHtml(sanitizeArticleTree(prepareArticleLinks(prepareArticleImages(expanded))))
}
