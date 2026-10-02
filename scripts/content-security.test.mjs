import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  contentIndexScript,
  pageSecurityPolicy,
  applyPageSecurity,
} from "./lib/content-security.mjs"

test("only the trusted content-index bootstrap receives an inline script hash", async () => {
  const policy = await pageSecurityPolicy({
    connectOrigins: [
      "https://login.example",
      "https://content.example/api",
      "https://user:secret@evil.test",
      "javascript:alert(1)",
    ],
  })
  const expected = createHash("sha256").update(contentIndexScript()).digest("base64")
  assert.match(policy, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  const scripts = /script-src ([^;]+)/.exec(policy)[1]
  assert.doesNotMatch(scripts, /'unsafe-inline'|'unsafe-eval'|data:|blob:|https:\s/)
  assert.match(policy, /script-src-attr 'none'/)
  assert.match(
    policy,
    /object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'/,
  )
  assert.match(policy, /https:\/\/login\.example https:\/\/content\.example/)
  assert.doesNotMatch(policy, /evil\.test|javascript:/)
  assert.match(policy, /worker-src 'self'; frame-src 'self'/)
})

test("different site prefixes receive the hash for their exact trusted bootstrap", async () => {
  const policy = await pageSecurityPolicy({ basePath: "/garden/" })
  const expected = createHash("sha256").update(contentIndexScript("/garden")).digest("base64")
  assert.ok(policy.includes(`'sha256-${expected}'`))
  assert.doesNotMatch(await pageSecurityPolicy({ meta: true }), /frame-ancestors/)
})

test("HTML and HEAD responses gain CSP without trusting scripts embedded in the page", async () => {
  const page = new Response("<script>untrustedAttack()</script><p>正常页面</p>", {
    headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"r1"' },
  })
  const secured = await applyPageSecurity(page)
  const maliciousHash = createHash("sha256").update("untrustedAttack()").digest("base64")
  assert.ok(!secured.headers.get("Content-Security-Policy").includes(maliciousHash))
  assert.equal(secured.headers.get("ETag"), '"r1"')
  assert.equal(secured.headers.get("Referrer-Policy"), "no-referrer")
  assert.equal(secured.headers.get("X-Frame-Options"), "SAMEORIGIN")
  assert.match(await secured.text(), /正常页面/)
  const head = await applyPageSecurity(
    new Response(null, { headers: { "Content-Type": "text/html" } }),
  )
  assert.ok(head.headers.has("Content-Security-Policy"))
  assert.equal(await head.text(), "")
})

test("non-HTML API payloads keep their response and cache policy", async () => {
  const response = Response.json({ source: "<script>kept as original text</script>" })
  assert.equal(await applyPageSecurity(response), response)
  assert.equal(response.headers.get("Content-Security-Policy"), null)
})
