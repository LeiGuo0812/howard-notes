export function fileURLToPath(value) {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== "file:") throw new Error("Expected a file URL.")
  return decodeURIComponent(url.pathname)
}
