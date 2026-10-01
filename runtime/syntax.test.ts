import test from "node:test"
import assert from "node:assert/strict"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { toHtml } from "hast-util-to-html"
import { VFile } from "vfile"
import { ObsidianFlavoredMarkdown } from "@quartz-community/obsidian-flavored-markdown"
import { SyntaxHighlighting as original } from "@quartz-community/syntax-highlighting"
import { SyntaxHighlighting } from "./syntax"
import type { BuildCtx, QuartzTransformerPluginInstance } from "@quartz-community/types"
import type { Root } from "hast"

test("lazy syntax adapter preserves Quartz's seventeen-language code, metadata, token and Mermaid output", async () => {
  const samples = {
    python: "def answer(x: int):\n    return x + 42",
    javascript: 'const x = { name: "你好" };\nconsole.log(x);',
    typescript: 'const x: string = "hello";',
    json: '{"answer":42,"label":"你好"}',
    bash: 'echo "$HOME"\nls -la',
    shellscript: "if [ -e notes ]; then\n echo ok\nfi",
    powershell: "Get-ChildItem -Path $pwd",
    latex: "\\frac{a}{b} + \\sum_{i=1}^{n} x_i",
    mermaid: "graph LR; A-->B",
    css: "a { color: red; margin: 2px; }",
    html: '<div class="card">你好</div>',
    vb: "Dim count As Integer = 42",
    r: "x <- c(1, 2)\nprint(mean(x))",
    matlab: "x = zeros(3,1);\ndisp(x)",
    bat: "@echo off\nset count=1",
    cpp: "#include <vector>\nint main() { return 0; }",
    sql: "SELECT id FROM articles WHERE published = true;",
  }
  const ctx = { allSlugs: ["notes/test"] } as unknown as BuildCtx
  function processor(plugin: QuartzTransformerPluginInstance) {
    const obsidian = ObsidianFlavoredMarkdown()
    return unified()
      .use(remarkParse)
      .use(obsidian.markdownPlugins?.(ctx) || [])
      .use(remarkRehype)
      .use(plugin.htmlPlugins?.(ctx) || [])
      .use(obsidian.htmlPlugins?.(ctx) || [])
  }
  const old = processor(original())
  const lazy = processor(SyntaxHighlighting())
  for (const [language, source] of Object.entries(samples)) {
    const value = `\`\`\`${language} title="Example" {1}\n${source}\n\`\`\``
    async function render(pipeline: typeof old) {
      const file = new VFile({ value, path: "test.md" })
      file.data = { slug: "notes/test", frontmatter: { title: "test" } }
      return toHtml((await pipeline.run(pipeline.parse(file), file)) as Root)
    }
    assert.equal(await render(lazy), await render(old), `${language} rendering differs`)
  }
})
