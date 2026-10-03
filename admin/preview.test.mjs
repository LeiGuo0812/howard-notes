import assert from "node:assert/strict"
import test from "node:test"
import { Marked } from "marked"
import { createPreviewCompiler } from "./preview-compiler.mjs"
import { createDiagramCache, articleForLink, createPreview } from "./preview.mjs"

test("private Markdown links resolve in the merged library without intercepting external links", () => {
  const article = { id: "private-note", file: "notes/专题/目标.md", published: false }
  const context = {
    articles: [article],
    articleFile: "notes/专题/当前.md",
    siteBase: "https://notes.test/howard-notes/",
  }
  assert.equal(articleForLink("目标.md#section", context), article)
  assert.equal(articleForLink("../专题/目标.md", context), article)
  assert.equal(
    articleForLink("https://notes.test/howard-notes/notes/private-note", context),
    article,
  )
  assert.equal(
    articleForLink("https://external.test/howard-notes/notes/private-note", context),
    null,
  )
  assert.equal(articleForLink("javascript:alert(1)", context), null)
  assert.equal(articleForLink("#section", context), null)
  assert.equal(articleForLink("https://[broken", context), null)
})

test("unchanged diagrams reuse a pending render and its sanitized result", async () => {
  const cache = createDiagramCache()
  let renders = 0,
    release
  const render = () => {
    renders++
    return new Promise((resolve) => (release = resolve))
  }
  const first = cache.get("[0,diagram]", render)
  assert.equal(cache.get("[0,diagram]", render), first)
  await Promise.resolve()
  release("<svg>sanitized diagram</svg>")
  assert.equal(await first, "<svg>sanitized diagram</svg>")
  assert.equal(await cache.get("[0,diagram]", render), "<svg>sanitized diagram</svg>")
  assert.equal(renders, 1)
})

test("changed diagram positions and editor contexts get independent renders", async () => {
  const cache = createDiagramCache()
  let renders = 0
  const render = () => "<svg>" + ++renders + "</svg>"
  assert.equal(await cache.get("[0,A]", render), "<svg>1</svg>")
  assert.equal(await cache.get("[1,A]", render), "<svg>2</svg>")
  assert.equal(await cache.get("[0,B]", render), "<svg>3</svg>")
  cache.clear()
  assert.equal(await cache.get("[0,A]", render), "<svg>4</svg>")
})

test("diagram caches evict old output by entry count and decoded string memory", async () => {
  const entries = createDiagramCache({ maxEntries: 2 })
  let renders = 0
  const render = () => String(++renders)
  await entries.get("first", render)
  await entries.get("second", render)
  assert.equal(await entries.get("first", render), "1")
  await entries.get("third", render)
  assert.equal(await entries.get("first", render), "1")
  assert.equal(await entries.get("second", render), "4")
  const bytes = createDiagramCache({ maxBytes: 10 })
  await bytes.get("oversize", () => "six123")
  assert.equal(await bytes.get("oversize", () => "fresh"), "fresh")
})

test("failed renders retry and late completions cannot refill a cleared context", async () => {
  const cache = createDiagramCache({ maxBytes: 10 })
  await assert.rejects(cache.get("failed", () => Promise.reject(new Error("invalid"))))
  assert.equal(await cache.get("failed", () => "fixed"), "fixed")
  let release
  const pending = cache.get("old", () => new Promise((resolve) => (release = resolve)))
  await Promise.resolve()
  cache.clear()
  assert.equal(await cache.get("current", () => "ok"), "ok")
  release("an old, very large diagram")
  await pending
  assert.equal(await cache.get("current", () => "unexpected"), "ok")
})

test("cancelled diagram renders are not retained as cache hits", async () => {
  const cache = createDiagramCache()
  assert.equal(await cache.get("cancelled", () => null), null)
  assert.equal(await cache.get("cancelled", () => "<svg>retry</svg>"), "<svg>retry</svg>")
})

function previewFixture({ pendingLoad = false, pendingRender = false, imageContext = {} } = {}) {
  const originalDocument = globalThis.document
  const nodes = []
  const element = {
    isConnected: true,
    scrollTop: 31,
    theme: "light",
    children: [],
    replaceChildren() {
      for (const child of this.children) {
        child.isConnected = false
        if (child.code) child.code.isConnected = false
      }
      this.children = []
      this.html = ""
    },
    set innerHTML(value) {
      this.replaceChildren()
      this.html = value
      for (const match of value.matchAll(
        /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
      )) {
        const pre = {
          isConnected: true,
          replaceWith(host) {
            this.isConnected = this.code.isConnected = false
            host.isConnected = true
            element.children.splice(element.children.indexOf(this), 1, host)
          },
          after(host) {
            host.isConnected = true
            element.children.push(host)
          },
        }
        pre.code = {
          isConnected: true,
          parentElement: pre,
          textContent: match[1].replace(
            /&(?:amp|lt|gt|quot|#39);/g,
            (entity) =>
              ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity],
          ),
        }
        this.children.push(pre)
      }
      for (const match of value.matchAll(/<img\s+[^>]*src="([^"]*)"[^>]*>/g)) {
        const attributes = new Map([["src", match[1]]])
        this.children.push({
          isImage: true,
          isConnected: true,
          getAttribute: (name) => attributes.get(name) ?? null,
          removeAttribute: (name) => attributes.delete(name),
          set src(value) {
            attributes.set("src", value)
          },
          get src() {
            return attributes.get("src")
          },
        })
      }
    },
    querySelectorAll(selector) {
      if (selector === "img") return this.children.filter((child) => child.isImage)
      return selector === "pre > code.language-mermaid, pre > code.mermaid"
        ? this.children.filter((child) => child.code?.isConnected).map((child) => child.code)
        : []
    },
    append(node) {
      node.isConnected = true
      this.children.push(node)
    },
  }
  globalThis.document = {
    createElement(tagName) {
      const node = { tagName, isConnected: false }
      nodes.push(node)
      return node
    },
  }
  const renders = [],
    mounts = [],
    deferred = []
  let observer = null,
    observers = 0,
    removedObservers = 0,
    releaseLoad
  const module = {
    diagramThemeKey: () => element.theme,
    observeDiagramTheme(_element, callback) {
      observers++
      observer = callback
      return () => {
        removedObservers++
        observer = null
      }
    },
    async renderDiagram(source, options) {
      const call = { source, theme: element.theme, options }
      renders.push(call)
      if (pendingRender) await new Promise((resolve) => deferred.push(resolve))
      return options.isCurrent() ? `<svg>${call.theme}:${source}</svg>` : null
    },
    mountDiagram(host, options) {
      const call = { host, ...options, destroyed: false }
      mounts.push(call)
      return {
        destroy() {
          call.destroyed = true
          // Global overlays and raw source closures are released by the shared viewer.
          call.source = null
        },
      }
    },
  }
  const preview = createPreview(
    element,
    () => ({
      articles: [],
      images: [],
      siteBase: "https://notes.test/site/",
      ...imageContext,
    }),
    {
      compiler: {
        render: async ({ raw, siteBase }) => {
          assert.equal(typeof siteBase, "string", "worker input must never contain a URL instance")
          return { html: new Marked().parse(raw) }
        },
      },
      sanitize: (html) => html,
      loadViewer: async (base) => {
        assert.equal(base, "https://notes.test/site/")
        if (pendingLoad) await new Promise((resolve) => (releaseLoad = resolve))
        return module
      },
    },
  )
  return {
    preview,
    element,
    renders,
    mounts,
    nodes,
    releaseLoad: () => releaseLoad(),
    releaseRender: () => deferred.shift()(),
    changeTheme(theme) {
      element.theme = theme
      observer?.()
    },
    observation: () => ({ observers, removedObservers, active: !!observer }),
    cleanup() {
      preview.destroy()
      globalThis.document = originalDocument
    },
  }
}

const diagramMarkdown = "```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```"
test("workspace URL objects are normalized before crossing the preview worker boundary", async () => {
  const f = previewFixture({ imageContext: { siteBase: new URL("https://notes.test/site/") } })
  try {
    await f.preview.render("# Synthetic plain preview")
  } finally {
    f.cleanup()
  }
})
const until = async (condition) => {
  for (let turn = 0; turn < 50; turn++) {
    if (condition()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail("preview operation did not settle")
}

test("editor diagrams use the shared viewer and theme-specific sanitized cache", async () => {
  const f = previewFixture()
  try {
    await f.preview.render(diagramMarkdown)
    assert.equal(f.renders.length, 1)
    assert.equal(f.mounts.length, 1)
    assert.match(f.mounts[0].source, /A\[开始\] --> B\[完成\]/)
    assert.equal(f.mounts[0].isCurrent(), true)
    assert.equal(f.element.scrollTop, 31)
    await f.preview.render(diagramMarkdown)
    assert.equal(f.renders.length, 1)
    assert.equal(f.mounts[0].destroyed, true)
    assert.equal(f.mounts[0].isCurrent(), false)
    assert.equal(f.observation().observers, 1)
    f.changeTheme("dark")
    await until(() => f.mounts.length === 3)
    assert.equal(f.renders.length, 2)
    assert.match(f.mounts.at(-1).svg, /^<svg>dark:/)
    assert.equal(f.mounts[1].destroyed, true)
    f.changeTheme("light")
    await until(() => f.mounts.length === 4)
    assert.equal(f.renders.length, 2)
    assert.match(f.mounts.at(-1).svg, /^<svg>light:/)
    f.preview.clear()
    assert.equal(f.element.children.length, 0)
    assert.equal(f.mounts.at(-1).destroyed, true)
    assert.equal(f.mounts.at(-1).source, null)
    assert.equal(f.mounts.at(-1).isCurrent(), false)
    assert.deepEqual(f.observation(), { observers: 1, removedObservers: 1, active: false })
    await f.preview.render(diagramMarkdown)
    assert.equal(f.renders.length, 3)
    assert.equal(f.observation().observers, 2)
  } finally {
    f.cleanup()
  }
})

test("unchanged previews reuse an in-flight render while only the current DOM can mount it", async () => {
  const f = previewFixture({ pendingRender: true })
  try {
    const first = f.preview.render(diagramMarkdown)
    await until(() => f.renders.length === 1)
    const second = f.preview.render(diagramMarkdown)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(f.renders.length, 1)
    assert.equal(f.renders[0].options.isCurrent(), true)
    assert.equal(f.renders[0].options.signal.aborted, false)
    f.releaseRender()
    await Promise.all([first, second])
    assert.equal(f.mounts.length, 1)
    assert.equal(f.mounts[0].isCurrent(), true)
  } finally {
    f.cleanup()
  }
})

test("clearing during lazy module loading cannot install an observer or private diagram", async () => {
  const f = previewFixture({ pendingLoad: true })
  try {
    const pending = f.preview.render(diagramMarkdown)
    await until(() => f.element.children.length > 0)
    f.preview.clear()
    f.releaseLoad()
    await pending
    assert.equal(f.renders.length, 0)
    assert.equal(f.mounts.length, 0)
    assert.equal(f.observation().active, false)
    assert.equal(f.element.children.length, 0)
  } finally {
    f.cleanup()
  }
})

test("destroying during a diagram render prevents all late mounts and future previews", async () => {
  const f = previewFixture({ pendingRender: true })
  try {
    const pending = f.preview.render(diagramMarkdown)
    await until(() => f.renders.length === 1)
    f.preview.destroy()
    assert.equal(f.renders[0].options.isCurrent(), false)
    assert.equal(f.renders[0].options.signal.aborted, true)
    f.releaseRender()
    await pending
    await f.preview.render(diagramMarkdown)
    assert.equal(f.mounts.length, 0)
    assert.equal(f.renders.length, 1)
    assert.equal(f.element.children.length, 0)
    assert.equal(f.observation().active, false)
  } finally {
    f.cleanup()
  }
})

test("clearing aborts active diagram measurements and creates a new context signal", async () => {
  const f = previewFixture({ pendingRender: true })
  try {
    const first = f.preview.render(diagramMarkdown)
    await until(() => f.renders.length === 1)
    const oldSignal = f.renders[0].options.signal
    assert.equal(oldSignal.aborted, false)
    f.preview.clear()
    assert.equal(oldSignal.aborted, true)
    const second = f.preview.render(diagramMarkdown)
    await until(() => f.renders.length === 2)
    assert.notEqual(f.renders[1].options.signal, oldSignal)
    assert.equal(f.renders[1].options.signal.aborted, false)
    f.releaseRender()
    await first
    assert.equal(f.mounts.length, 0)
    f.releaseRender()
    await second
    assert.equal(f.mounts.length, 1)
    assert.equal(f.mounts[0].isCurrent(), true)
  } finally {
    f.cleanup()
  }
})

test("replacing diagrams with ordinary Markdown releases the theme listener and viewer", async () => {
  const f = previewFixture()
  try {
    await f.preview.render(diagramMarkdown)
    await f.preview.render("普通文章")
    assert.equal(f.mounts[0].destroyed, true)
    assert.equal(f.observation().active, false)
    f.changeTheme("dark")
    assert.equal(f.renders.length, 1)
    assert.match(f.element.html, /普通文章/)
  } finally {
    f.cleanup()
  }
})

test("clearing a preview prevents delayed private attachment URLs from starting a read", async () => {
  let release,
    reads = 0
  const f = previewFixture({
    imageContext: {
      attachments: [{ source: "private.png", fileId: "private-file" }],
      client: {
        privateFileUrl: () => new Promise((resolve) => (release = resolve)),
        readPrivateFile: async () => {
          reads++
          return new Blob(["private-image-fixture"])
        },
      },
    },
  })
  try {
    const pending = f.preview.render("![附件](private.png)")
    await until(() => typeof release === "function")
    f.preview.clear()
    release("https://notes.test/site/api/content/personal/files/private-file")
    await pending
    assert.equal(reads, 0)
    assert.equal(f.element.children.length, 0)
  } finally {
    f.cleanup()
  }
})

test("private image previews still use owner reads and revoke their Blob URL on clear", async () => {
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL,
    revoked = []
  let reads = 0
  URL.createObjectURL = () => "blob:preview-private-fixture"
  URL.revokeObjectURL = (url) => revoked.push(url)
  const f = previewFixture({
    imageContext: {
      attachments: [{ source: "private.png", fileId: "private-file" }],
      client: {
        privateFileUrl: async () =>
          "https://notes.test/site/api/content/personal/files/private-file",
        readPrivateFile: async () => {
          reads++
          return new Blob(["private-image-fixture"])
        },
      },
    },
  })
  try {
    await f.preview.render("![附件](private.png)")
    assert.equal(reads, 1)
    assert.equal(f.element.querySelectorAll("img")[0].src, "blob:preview-private-fixture")
    await f.preview.render("![附件](private.png)")
    assert.equal(reads, 1)
    f.preview.clear()
    await Promise.resolve()
    assert.deepEqual(revoked, ["blob:preview-private-fixture"])
  } finally {
    f.cleanup()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test("preview compilation coalesces edits and releases stale originals on clear", async () => {
  const workers = []
  class FakeWorker {
    sent = []
    constructor() {
      workers.push(this)
    }
    postMessage(message) {
      this.sent.push(message)
    }
    terminate() {
      this.terminated = true
    }
  }
  const compiler = createPreviewCompiler({
    siteBase: "https://notes.test/site/",
    WorkerClass: FakeWorker,
  })
  const a = compiler.render({ raw: "old" })
  const b = compiler.render({ raw: "middle" })
  const c = compiler.render({ raw: "latest" })
  assert.equal(await a, null)
  assert.equal(await b, null)
  assert.equal(workers[0].sent.length, 1)
  workers[0].onmessage({ data: { id: 1, result: { html: "old" } } })
  assert.equal(workers[0].sent.length, 2)
  assert.equal(workers[0].sent[1].input.raw, "latest")
  workers[0].onmessage({ data: { id: 3, result: { html: "latest" } } })
  assert.deepEqual(await c, { html: "latest" })
  const pending = compiler.render({ raw: "private" })
  compiler.clear()
  assert.equal(await pending, null)
  assert.equal(workers[0].terminated, true)
  const next = compiler.render({ raw: "new-context" })
  assert.equal(workers.length, 2)
  compiler.destroy()
  assert.equal(await next, null)
})
