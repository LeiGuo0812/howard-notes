const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const AST_CACHE_ENCODING = "gzip-base64-v1"

function toBase64(bytes) {
  let text = ""
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(text)
}

export async function encodeAstCache(tree, blocks) {
  const json = JSON.stringify({ tree, blocks }, (key, value) =>
    key === "position" && value?.start && value?.end ? undefined : value,
  )
  const stream = new Blob([encoder.encode(json)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  // Fixed metadata makes this portable between Node and browsers; no timestamps are stored.
  bytes.fill(0, 4, 8)
  bytes[9] = 255
  return toBase64(bytes)
}

export async function decodeAstCache(cache) {
  if (typeof cache !== "string" || cache.length > 3000000) throw new Error("无效的文章解析缓存。")
  const text = atob(cache)
  const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  const reader = stream.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16000000) {
        await reader.cancel()
        throw new Error("文章解析缓存过大。")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  const value = JSON.parse(decoder.decode(result))
  if (value?.tree?.type !== "root" || !value.blocks || typeof value.blocks !== "object")
    throw new Error("文章解析缓存格式不正确。")
  return value
}
