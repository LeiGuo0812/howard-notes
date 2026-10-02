/** Shared trusted bootstrap; never derive an executable-script allowlist from note HTML. */
export function contentIndexScript(basePath = "/howard-notes") {
  return `const fetchData={then(resolve,reject){return (window.__howardContentIndex?window.__howardContentIndex():fetch(${JSON.stringify(`${basePath}/static/contentIndex.json`)},{cache:"no-cache"}).then(r=>{if(!r.ok)throw new Error("无法加载笔记索引");return r.json()})).then(resolve,reject)}}`
}

const origins = (values = []) => [
  ...new Set(
    values.flatMap((value) => {
      if (!value) return []
      try {
        const url = new URL(value)
        return url.protocol === "https:" && !url.username && !url.password ? [url.origin] : []
      } catch {
        return []
      }
    }),
  ),
]
const hashes = new Map()
async function scriptHash(script) {
  if (!hashes.has(script)) {
    hashes.set(
      script,
      crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(script))
        .then((digest) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`),
    )
  }
  return hashes.get(script)
}

/** Allows the compiled site, pinned reading dependencies and intentional image hosts. */
export async function pageSecurityPolicy({
  basePath = "/howard-notes",
  connectOrigins = [],
  meta = false,
} = {}) {
  const bootstrap = await scriptHash(contentIndexScript(basePath.replace(/\/$/, "")))
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${bootstrap} https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/ https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/copy-tex.min.js https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/pixi.js https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/packages/unsafe-eval.js`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/ https://fonts.googleapis.com",
    `connect-src 'self' https://api.github.com https://raw.githubusercontent.com ${origins(connectOrigins).join(" ")}`.trim(),
    "img-src 'self' https: data: blob:",
    "font-src 'self' https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/ https://fonts.gstatic.com",
    "worker-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    ...(meta ? [] : ["frame-ancestors 'self'"]),
  ].join("; ")
}

/** Attach at the final HTML response boundary, including errors and private pages. */
export async function applyPageSecurity(response, options = {}) {
  if (!response.headers.get("Content-Type")?.toLowerCase().includes("text/html")) return response
  const headers = new Headers(response.headers)
  headers.set("Content-Security-Policy", await pageSecurityPolicy(options))
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "no-referrer")
  headers.set("X-Frame-Options", "SAMEORIGIN")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
