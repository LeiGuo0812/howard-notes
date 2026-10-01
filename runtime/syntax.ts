import rehypePrettyCode from "rehype-pretty-code"
import { tokenClassifierTransformer } from "./token-classifier"
import type { QuartzTransformerPluginInstance } from "@quartz-community/types"

// The official Shiki entry lazily imports individual grammars and themes. Reusing the
// community package's prebundled entry would eagerly download every grammar at once.
export function SyntaxHighlighting(): QuartzTransformerPluginInstance {
  return {
    name: "SyntaxHighlighting",
    htmlPlugins: () => [
      [
        rehypePrettyCode,
        {
          theme: { light: "github-light", dark: "github-dark" },
          keepBackground: false,
          transformers: [tokenClassifierTransformer()],
        },
      ],
    ],
  }
}
