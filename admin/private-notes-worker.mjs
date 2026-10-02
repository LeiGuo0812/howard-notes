import { renderPrivateReading } from "../runtime/private-reading.ts"

// This worker receives one original and metadata, never credentials. Compilation is
// ephemeral: it performs no fetches and keeps no original-text cache between requests.
self.onmessage = async (event) => {
  const id = event.data?.id
  try {
    const result = await renderPrivateReading(event.data?.input)
    self.postMessage({ id, result })
  } catch {
    // Parser errors can contain fragments of a private note; never return them.
    self.postMessage({ id, error: "笔记暂时无法显示，请重试。" })
  }
}
