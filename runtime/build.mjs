import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))

// The community packages bundle VFile's Node branch. Route its small path/process/URL
// surface to browser implementations while leaving the shared Markdown plugins intact.
export function runtimeBrowserPlugins() {
  return [
    {
      name: "runtime-browser-compatibility",
      setup(build) {
        const processShim = path.join(directory, "shims/process.mjs")
        build.initialOptions.inject = [...(build.initialOptions.inject || []), processShim]
        build.onResolve({ filter: /^(?:node:)?(?:path|process|url|fs|module)$/ }, (args) => ({
          path:
            args.path.replace(/^node:/, "") === "path"
              ? path.join(directory, "../node_modules/path-browserify/index.js")
              : path.join(directory, `shims/${args.path.replace(/^node:/, "")}.mjs`),
        }))
      },
    },
  ]
}
