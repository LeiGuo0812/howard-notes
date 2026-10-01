import { prepareProjection } from "../runtime/projection.mjs"
import { renderPages } from "../quartz/runtime/render.tsx"
import { publicationChunks, renderedPageHash } from "./runtime-publish.mjs"

self.onmessage = async ({ data: { id, input } }) => {
  try {
    const { shell, reusableDocuments, maxChunkBytes, ...args } = input
    const projection = await prepareProjection(args)
    const pages = renderPages(projection, shell)
    const old = new Map((args.previous.documents || []).map((doc) => [doc.id, doc]))
    const reusable = new Set(reusableDocuments || [])
    const documents = projection.documents.filter(
      (doc) => !reusable.has(doc.id) || JSON.stringify(old.get(doc.id)) !== JSON.stringify(doc),
    )
    const hashes = await Promise.all(pages.map((page) => renderedPageHash(page.html)))
    const changed = pages.filter((page, i) => args.previous.pageHashes?.[page.path] !== hashes[i])
    self.postMessage({
      id,
      result: {
        chunks: publicationChunks(documents, changed, Math.min(730000, maxChunkBytes || 730000)),
        contentIndex: projection.contentIndex,
        blogData: projection.blogData,
      },
    })
  } catch (error) {
    self.postMessage({ id, error: error.message || "后台准备失败，请重试同步。" })
  }
}
