import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { handle } from "./worker.mjs"
import { allowedExportImage, publicImageSources, MAX_EXPORT_IMAGE_BYTES } from "./export-images.mjs"

const image = "https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/public.png"
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  ),
)
function fixture(html = `<img src="${image}">`) {
  const queries = [],
    calls = []
  const current = { revision: 17, commit_sha: "a".repeat(40) }
  let upstream = () => new Response(png, { headers: { "Content-Type": "image/png" } })
  const DB = {
    prepare(sql) {
      queries.push(sql)
      let values = []
      return {
        bind(...bound) {
          values = bound
          return this
        },
        async first() {
          if (sql === "SELECT * FROM content_state WHERE id = 1") return current
          assert.equal(sql, "SELECT body FROM public_documents WHERE revision = ? AND id = ?")
          assert.equal(values[0], current.revision)
          return values[1] === "public-note"
            ? { body: JSON.stringify({ id: "public-note", html }) }
            : null
        },
      }
    },
  }
  const env = { DB, SITE_PREFIX: "/howard-notes/", FALLBACK_ORIGIN: "https://pages.example.test" }
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    return upstream(url, options)
  }
  const call = (route = "public-note/0", options = {}) =>
    handle(
      new Request(
        `https://notes.example.test/howard-notes/api/content/export-image/${route}`,
        options,
      ),
      env,
      {},
      fetcher,
    )
  return {
    call,
    calls,
    queries,
    current,
    setUpstream(value) {
      upstream = value
    },
  }
}

test("published OSS image exports through real Worker routing without forwarding credentials", async () => {
  const state = fixture()
  const result = await state.call("public-note/0?revision=17", {
    headers: {
      Cookie: "owner=synthetic-only",
      Authorization: "Bearer synthetic-only",
      Referer: "https://private.example.test/",
      Origin: "https://pages.example.test",
    },
  })
  assert.equal(result.status, 200)
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), png)
  assert.equal(result.headers.get("Content-Type"), "image/png")
  assert.equal(result.headers.get("Cache-Control"), "no-store")
  assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "https://pages.example.test")
  assert.equal(result.headers.get("Access-Control-Expose-Headers"), "X-Howard-Image-Source-SHA256")
  assert.equal(
    result.headers.get("X-Howard-Image-Source-SHA256"),
    createHash("sha256").update(image).digest("hex"),
  )
  assert.equal(state.calls.length, 1)
  const { url, options } = state.calls[0]
  assert.equal(url, image)
  assert.equal(options.credentials, "omit")
  assert.equal(options.redirect, "manual")
  assert.equal(options.referrerPolicy, "no-referrer")
  assert.deepEqual(Object.keys(options.headers), ["Accept"])
  assert.ok(!state.queries.some((sql) => /personal|private|public_payloads/.test(sql)))
})

test("private, draft, missing and withdrawn IDs never request an upstream image", async () => {
  const state = fixture()
  for (const id of ["private-note", "draft-note", "missing-note", "withdrawn-note"])
    assert.equal((await state.call(`${id}/0?revision=16`)).status, 404)
  assert.equal(state.calls.length, 0)
})

test("stale public revisions and invalid image ordinals fail before fetch", async () => {
  const state = fixture()
  for (const revision of ["16", "future", "18", "17&revision=17"])
    assert.ok([400, 409].includes((await state.call(`public-note/0?revision=${revision}`)).status))
  assert.equal((await state.call("public-note/1")).status, 404)
  for (const path of [
    "public-note/-1",
    "public-note/01",
    "public-note/10000",
    "public-note/0/extra",
  ])
    assert.equal((await state.call(path)).status, 400)
  assert.equal(state.calls.length, 0)
})

test("Pages without a revision uses only the active public row", async () => {
  const state = fixture()
  assert.equal((await state.call()).status, 200)
  state.current.revision = 18
  assert.equal((await state.call("public-note/0?revision=17")).status, 409)
  assert.equal(state.calls.length, 1)
})

test("no arbitrary URL, token or request body is accepted", async () => {
  const state = fixture()
  for (const query of ["url=https://evil.example/a.png", "token=secret", "index=1"])
    assert.equal((await state.call(`public-note/0?${query}`)).status, 400)
  assert.equal((await state.call("public-note/0", { method: "POST", body: image })).status, 405)
  assert.equal((await state.call("public-note/0", { method: "HEAD" })).status, 405)
  assert.equal(state.calls.length, 0)
})

test("allowlist rejects internal addresses, lookalike hosts, credentials, query and path escapes", async () => {
  const invalid = [
    "http://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/a.png",
    "https://127.0.0.1/img/a.png",
    "https://localhost/img/a.png",
    "https://[::1]/img/a.png",
    image.replace(".com/", ".com.evil.example/"),
    image.replace("https://", "https://user:pass@"),
    image.replace(".com/", ".com:8443/"),
    image + "?signature=secret",
    image.replace("/img/", "/private/"),
    image.replace("/img/", "/img/../private/"),
    image.replace("public.png", "a%2fsecret.png"),
    "blob:https://notes.example.test/secret",
    "data:image/png;base64,AAAA",
    "file:///tmp/a.png",
    "https://cdn.nlark.com/private/a.png",
    image.replace(".png", ".svg"),
  ]
  for (const candidate of invalid) {
    assert.equal(allowedExportImage(candidate), null, candidate)
    const state = fixture(`<img src="${candidate}">`)
    assert.equal((await state.call()).status, 422, candidate)
    assert.equal(state.calls.length, 0)
  }
})

test("HTML parsing preserves image order and removes Yuque metadata fragments for identity", async () => {
  const url = "https://cdn.nlark.com/yuque/0/2022/png/a.png#width=120&height=60"
  assert.deepEqual(
    publicImageSources(
      `<p>&lt;img src='ignored'&gt;</p><img src='${image}'><div><img src="${url}"></div>`,
    ),
    [image, url],
  )
  const state = fixture(`<img src="${image}"><img src="${url}">`)
  const result = await state.call("public-note/1")
  const canonical = url.split("#")[0]
  assert.equal(state.calls[0].url, canonical)
  assert.equal(
    result.headers.get("X-Howard-Image-Source-SHA256"),
    createHash("sha256").update(canonical).digest("hex"),
  )
})

test("redirects and upstream errors are rejected without following any location", async () => {
  for (const status of [301, 302, 307, 403, 404, 500]) {
    const state = fixture()
    state.setUpstream(
      () => new Response("upstream", { status, headers: { Location: "http://127.0.0.1/secret" } }),
    )
    assert.equal((await state.call()).status, 502)
    assert.equal(state.calls.length, 1)
  }
})

test("HTML, SVG and mismatched MIME or magic cannot become public image responses", async () => {
  const samples = [
    ["text/html", png],
    ["image/svg+xml", new TextEncoder().encode("<svg/>")],
    ["image/png", new TextEncoder().encode("<script>alert(1)</script>")],
    ["image/jpeg", png],
  ]
  for (const [type, body] of samples) {
    const state = fixture()
    state.setUpstream(() => new Response(body, { headers: { "Content-Type": type } }))
    assert.equal((await state.call()).status, 422)
  }
})

test("image byte limits apply to both declared size and the actual streamed body", async () => {
  const declared = fixture()
  declared.setUpstream(
    () =>
      new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(MAX_EXPORT_IMAGE_BYTES + 1),
        },
      }),
  )
  assert.equal((await declared.call()).status, 413)
  let canceled = false
  const streamed = fixture()
  streamed.setUpstream(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_EXPORT_IMAGE_BYTES + 1))
          },
          cancel() {
            canceled = true
          },
        }),
        { headers: { "Content-Type": "image/png", "Content-Length": "1" } },
      ),
  )
  assert.equal((await streamed.call()).status, 413)
  assert.equal(canceled, true)
})

test("upstream network failure is a bounded public error without source/credential details", async () => {
  const state = fixture()
  state.setUpstream(() => {
    throw new Error("synthetic upstream secret")
  })
  const result = await state.call()
  assert.equal(result.status, 502)
  assert.doesNotMatch(await result.text(), /synthetic|secret|public\.png/)
})
