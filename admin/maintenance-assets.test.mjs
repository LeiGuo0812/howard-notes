import test from "node:test"
import assert from "node:assert/strict"
import { createMaintenanceAssetLoader } from "./maintenance-assets.mjs"

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function documentFixture() {
  const nodes = []
  const doc = {
    head: {
      append(link) {
        nodes.push(link)
      },
    },
    querySelectorAll: () => nodes,
    createElement() {
      const link = new EventTarget()
      link.setAttribute = () => {}
      link.remove = () => {
        const index = nodes.indexOf(link)
        if (index >= 0) nodes.splice(index, 1)
      }
      return link
    },
  }
  return { doc, nodes }
}

test("construction is idle; prepare immediately starts one public template request and both style hints", async () => {
  const f = documentFixture(),
    gate = deferred(),
    requests = []
  const loader = createMaintenanceAssetLoader({
    siteBase: "https://notes.test/howard-notes/",
    version: "version-a",
    doc: f.doc,
    fetcher(url, options) {
      requests.push({ url: String(url), options })
      return gate.promise
    },
  })
  assert.equal(requests.length, 0)
  assert.equal(f.nodes.length, 0)
  const first = loader.prepare(),
    second = loader.prepare()
  assert.equal(first.templatePromise, second.templatePromise)
  assert.deepEqual(requests, [
    {
      url: "https://notes.test/howard-notes/maintenance-assets/workspace.txt",
      options: { credentials: "omit" },
    },
  ])
  assert.deepEqual(
    f.nodes.map((link) => ({ rel: link.rel, as: link.as, href: link.href })),
    [
      {
        rel: "preload",
        as: "style",
        href: "https://notes.test/howard-notes/maintenance-assets/workspace.css?v=version-a",
      },
      {
        rel: "preload",
        as: "style",
        href: "https://notes.test/howard-notes/admin/katex/katex.min.css?v=version-a",
      },
    ],
  )
  gate.resolve(new Response("<main>shared template</main>"))
  assert.equal(await first.templatePromise, "<main>shared template</main>")
  assert.equal(await loader.prepare().templatePromise, "<main>shared template</main>")
  assert.equal(requests.length, 1)
  assert.equal(f.nodes.length, 2)
})

test("failed templates are observed even if import never consumes them and a subsequent opening retries", async () => {
  const f = documentFixture(),
    gate = deferred()
  let attempts = 0
  const loader = createMaintenanceAssetLoader({
    siteBase: "https://notes.test/site/",
    version: "v",
    doc: f.doc,
    fetcher: () =>
      ++attempts === 1 ? gate.promise : Promise.resolve(new Response("retry template")),
  })
  const first = loader.prepare().templatePromise
  gate.reject(new Error("synthetic template failure"))
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(first, /synthetic template failure/)
  assert.equal(await loader.prepare().templatePromise, "retry template")
  assert.equal(attempts, 2)
  assert.equal(f.nodes.length, 2)
})

test("preload failures retry independently while successful template bytes and other style hints remain shared", async () => {
  const f = documentFixture()
  let requests = 0
  const options = {
    siteBase: "https://notes.test/site/",
    version: "v",
    doc: f.doc,
    fetcher: async () => {
      requests++
      return new Response("template")
    },
  }
  const first = createMaintenanceAssetLoader(options)
  const template = first.prepare().templatePromise
  await template
  const failed = f.nodes[0],
    kept = f.nodes[1]
  failed.dispatchEvent(new Event("error"))
  assert.deepEqual(f.nodes, [kept])
  assert.equal(first.prepare().templatePromise, template)
  assert.equal(f.nodes.length, 2)
  assert.notEqual(f.nodes[1], failed)
  const second = createMaintenanceAssetLoader(options)
  await second.prepare().templatePromise
  assert.equal(f.nodes.length, 2, "another loader in the same document must reuse existing hints")
  assert.equal(requests, 2, "template caches are limited to their controller instance")
})

test("style preloads never delay template availability and non-browser environments can omit the document", async () => {
  const f = documentFixture()
  const loader = createMaintenanceAssetLoader({
    siteBase: "https://notes.test/site/",
    version: "v",
    doc: f.doc,
    fetcher: async () => new Response("template"),
  })
  assert.equal(await loader.prepare().templatePromise, "template")
  assert.equal(f.nodes.length, 2, "no load event is required from either style hint")
  const standalone = createMaintenanceAssetLoader({
    siteBase: "https://notes.test/site/",
    version: "v",
    doc: null,
    fetcher: async () => new Response("standalone"),
  })
  assert.equal(await standalone.prepare().templatePromise, "standalone")
})

test("non-OK, empty and oversized template responses are retryable instead of retained as usable forms", async () => {
  for (const response of [
    new Response("not found", { status: 404 }),
    new Response("  "),
    new Response("x".repeat(512 * 1024 + 1)),
  ]) {
    let attempts = 0
    const loader = createMaintenanceAssetLoader({
      siteBase: "https://notes.test/site/",
      version: "v",
      doc: null,
      fetcher: async () => (++attempts === 1 ? response : new Response("valid")),
    })
    await assert.rejects(loader.prepare().templatePromise, /维护界面未能加载/)
    assert.equal(await loader.prepare().templatePromise, "valid")
    assert.equal(attempts, 2)
  }
})

test("the shared preload registry stays bounded when a document hosts multiple asset versions", async () => {
  const f = documentFixture()
  for (let version = 0; version < 12; version++) {
    const loader = createMaintenanceAssetLoader({
      siteBase: "https://notes.test/site/",
      version,
      doc: f.doc,
      fetcher: async () => new Response("template"),
    })
    await loader.prepare().templatePromise
    assert.ok(f.nodes.length <= 8)
  }
  assert.ok(f.nodes.some((link) => link.href.endsWith("v=11")))
})
