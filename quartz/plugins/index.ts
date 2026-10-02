import { StaticResources } from "../util/resources"
import { BuildCtx } from "../util/ctx"
import { adaptMermaidResource } from "../../scripts/lib/mermaid-reader.mjs"
// @ts-ignore Quartz's build loader imports inline scripts as browser source.
import mermaidReaderScript from "../../scripts/lib/mermaid-reader.inline.js"

export function getStaticResourcesFromPlugins(ctx: BuildCtx) {
  const staticResources: StaticResources = {
    css: [],
    js: [],
    additionalHead: [],
  }

  for (const transformer of [...ctx.cfg.plugins.transformers, ...ctx.cfg.plugins.emitters]) {
    const res = transformer.externalResources ? transformer.externalResources(ctx) : {}
    if (res?.js) {
      staticResources.js.push(
        ...res.js.map((resource) => adaptMermaidResource(resource, mermaidReaderScript)),
      )
    }
    if (res?.css) {
      staticResources.css.push(...res.css)
    }
    if (res?.additionalHead) {
      staticResources.additionalHead.push(...res.additionalHead)
    }
  }

  // if serving locally, listen for rebuilds and reload the page
  if (ctx.argv.serve) {
    const wsUrl = ctx.argv.remoteDevHost
      ? `wss://${ctx.argv.remoteDevHost}:${ctx.argv.wsPort}`
      : `ws://localhost:${ctx.argv.wsPort}`

    staticResources.js.push({
      loadTime: "afterDOMReady",
      contentType: "inline",
      script: `
        const socket = new WebSocket('${wsUrl}')
        // reload(true) ensures resources like images and scripts are fetched again in firefox
        socket.addEventListener('message', () => document.location.reload(true))
      `,
    })
  }

  return staticResources
}

export * from "./transformers"
export * from "./filters"
export * from "./emitters"
export * from "./types"
export * from "./config"
export * as PageTypes from "./pageTypes"
export * as PluginLoader from "./loader"
