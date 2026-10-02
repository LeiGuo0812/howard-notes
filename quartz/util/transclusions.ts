// Shared Quartz transclusion resolver; used by static pages and owner-side live projections.
import type { Root, Element, ElementContent } from "hast"
import type { GlobalConfiguration } from "../cfg"
import type { QuartzComponentProps } from "../components/types"
import type { FullSlug } from "./path"
import { normalizeHastElement } from "./path"
import { i18n } from "../i18n"

const headerRegex = new RegExp(/h[1-6]/)

/** @internal Exported for testing only. */
export function renderTranscludes(
  root: Root,
  cfg: GlobalConfiguration,
  slug: FullSlug,
  componentData: QuartzComponentProps,
  visited: Set<FullSlug>,
) {
  // Walk the tree manually instead of using visit() so we can track the
  // ancestor chain for cycle detection. visit() runs the callback before
  // descending into replaced children, so a Set-based guard there falsely
  // rejects sibling transclusions of the same target.
  function walk(node: Element | Root) {
    const children = (node as Root).children ?? []
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child?.type !== "element") continue
      const el = child as Element

      if (el.tagName !== "blockquote") {
        walk(el)
        continue
      }

      const classNames = (el.properties?.className ?? []) as string[]
      if (!classNames.includes("transclude")) {
        walk(el)
        continue
      }

      const inner = el.children[0] as Element
      const transcludeTarget = (inner.properties["data-slug"] ??
        inner.properties.dataSlug ??
        slug) as FullSlug
      if (visited.has(transcludeTarget)) {
        console.warn(`Warning: Skipping circular transclusion: ${slug} -> ${transcludeTarget}`)
        el.children = [
          {
            type: "element",
            tagName: "p",
            properties: { style: "color: var(--secondary);" },
            children: [
              {
                type: "text",
                value: `Circular transclusion detected: ${transcludeTarget}`,
              },
            ],
          },
        ]
        continue
      }

      visited.add(transcludeTarget)

      let page = componentData.allFiles.find((f) => f.slug === transcludeTarget)
      if (!page) {
        const dotIdx = transcludeTarget.lastIndexOf(".")
        const slashIdx = transcludeTarget.lastIndexOf("/")
        if (dotIdx > slashIdx + 1) {
          const stripped = transcludeTarget.slice(0, dotIdx) as FullSlug
          page = componentData.allFiles.findLast((f) => f.slug === stripped)
        }
      }
      if (!page) {
        visited.delete(transcludeTarget)
        continue
      }

      let blockRef = el.properties.dataBlock as string | undefined
      if (blockRef?.startsWith("#^")) {
        // block transclude
        blockRef = blockRef.slice("#^".length)
        let blockNode = page.blocks?.[blockRef]
        if (blockNode) {
          if (blockNode.tagName === "li") {
            blockNode = {
              type: "element",
              tagName: "ul",
              properties: {},
              children: [blockNode],
            }
          }

          el.children = [
            normalizeHastElement(blockNode, slug, transcludeTarget),
            {
              type: "element",
              tagName: "a",
              properties: {
                href: inner.properties?.href,
                class: ["internal", "internal-link", "transclude-src"],
              },
              children: [
                { type: "text", value: i18n(cfg.locale).components.transcludes.linkToOriginal },
              ],
            },
          ]
        }
      } else if (blockRef?.startsWith("#") && page.htmlAst) {
        // header transclude
        blockRef = blockRef.slice(1)
        let startIdx = undefined
        let startDepth = undefined
        let endIdx = undefined
        for (const [i, htmlEl] of page.htmlAst.children.entries()) {
          if (!(htmlEl.type === "element" && htmlEl.tagName.match(headerRegex))) continue
          const depth = Number(htmlEl.tagName.substring(1))

          if (startIdx === undefined || startDepth === undefined) {
            if (htmlEl.properties?.id === blockRef) {
              startIdx = i
              startDepth = depth
            }
          } else if (depth <= startDepth) {
            endIdx = i
            break
          }
        }

        if (startIdx === undefined) {
          visited.delete(transcludeTarget)
          continue
        }

        el.children = [
          ...(page.htmlAst.children.slice(startIdx, endIdx) as ElementContent[]).map((c) =>
            normalizeHastElement(c as Element, slug, transcludeTarget),
          ),
          {
            type: "element",
            tagName: "a",
            properties: {
              href: inner.properties?.href,
              class: ["internal", "internal-link", "transclude-src"],
            },
            children: [
              { type: "text", value: i18n(cfg.locale).components.transcludes.linkToOriginal },
            ],
          },
        ]
      } else if (page.htmlAst) {
        // page transclude
        el.children = [
          {
            type: "element",
            tagName: "h1",
            properties: {},
            children: [
              {
                type: "text",
                value:
                  page.frontmatter?.title ??
                  i18n(cfg.locale).components.transcludes.transcludeOf({
                    targetSlug: page.slug!,
                  }),
              },
            ],
          },
          ...(page.htmlAst.children as ElementContent[]).map((c) =>
            normalizeHastElement(c as Element, slug, transcludeTarget),
          ),
          {
            type: "element",
            tagName: "a",
            properties: {
              href: inner.properties?.href,
              class: ["internal", "internal-link", "transclude-src"],
            },
            children: [
              { type: "text", value: i18n(cfg.locale).components.transcludes.linkToOriginal },
            ],
          },
        ]
      }

      // Recurse into the replaced children to resolve nested transclusions,
      // then remove from visited so sibling embeds of the same target work.
      walk(el)
      visited.delete(transcludeTarget)
    }
  }

  walk(root)
}
