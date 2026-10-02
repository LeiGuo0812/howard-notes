import assert from "node:assert/strict"
import test from "node:test"
import {
  exportFilename,
  markdownBytes,
  canShareFile,
  shareFile,
  usesMobileShare,
  downloadFile,
} from "./article-share-core.mjs"

test("Markdown default exports preserve original UTF-8 bytes including BOM, CRLF and trailing blank lines", () => {
  const source =
    "\ufeff---\r\ntitle: 原笔记\r\n---\r\n# 标题\r\n\r\n```js\r\nconst x = 1\r\n```\r\n\r\n"
  assert.deepEqual(markdownBytes(source), new TextEncoder().encode(source))
  const withLink = markdownBytes(source, {
    includeSource: true,
    url: "https://notes.invalid/notes/a#title",
  })
  assert.deepEqual(withLink.slice(0, markdownBytes(source).length), markdownBytes(source))
  assert.match(
    new TextDecoder().decode(withLink),
    /原文链接：<https:\/\/notes.invalid\/notes\/a>\r\n$/,
  )
})
test("Export filenames cannot carry path separators and fit normal filesystem limits", () => {
  assert.equal(exportFilename("../../文章:<测试>? ", "md"), "_.._文章__测试__.md")
  assert.ok(new TextEncoder().encode(exportFilename("汉".repeat(200), "pdf")).length < 255)
  assert.equal(exportFilename("...", "png"), "文章.png")
})
test("Mobile file share requires actual file capability and never adds a URL by default", async () => {
  const file = new File(["test"], "文章.md", { type: "text/markdown" })
  let received, probe
  const device = {
    canShare(data) {
      probe = data
      return true
    },
    share(data) {
      received = data
      return Promise.resolve()
    },
  }
  assert.equal(canShareFile(file, device), true)
  assert.deepEqual(Object.keys(probe), ["files"])
  await shareFile(file, { title: "文章" }, device)
  assert.deepEqual(received, { files: [file], title: "文章" })
  await shareFile(
    file,
    { title: "文章", includeSource: true, url: "https://notes.invalid/notes/a" },
    device,
  )
  assert.equal(received.url, "https://notes.invalid/notes/a")
  assert.equal(
    canShareFile(file, {
      share() {},
      canShare() {
        throw Error("blocked")
      },
    }),
    false,
  )
})
test("Native share cancellation is returned to the UI without initiating download", async () => {
  const error = Object.assign(new Error("cancel"), { name: "AbortError" })
  await assert.rejects(
    shareFile(
      {},
      { title: "文章" },
      {
        share() {
          return Promise.reject(error)
        },
      },
    ),
    (e) => e === error,
  )
})
test("Desktop browsers keep downloads even when Web Share exists", () => {
  assert.equal(
    usesMobileShare({ userAgentData: { mobile: false }, userAgent: "Chrome" }, () => ({
      matches: true,
    })),
    false,
  )
  assert.equal(
    usesMobileShare({ userAgent: "Android Chrome" }, () => ({ matches: false })),
    true,
  )
  assert.equal(
    usesMobileShare({ userAgent: "Safari" }, () => ({ matches: true })),
    true,
  )
})
test("Downloads bypass the SPA router and release their temporary URL", () => {
  let clicked = false,
    removed = false,
    revoked
  const anchor = {
    style: {},
    dataset: {},
    click() {
      assert.equal(this.dataset.routerIgnore, "")
      assert.equal(this.download, "文章.md")
      clicked = true
    },
    remove() {
      removed = true
    },
  }
  const cleanup = downloadFile(
    { name: "文章.md" },
    {
      document: { createElement: () => anchor, body: { append() {} } },
      urls: {
        createObjectURL: () => "blob:synthetic",
        revokeObjectURL: (url) => (revoked = url),
      },
    },
  )
  assert.equal(clicked, true)
  assert.equal(removed, true)
  cleanup()
  assert.equal(revoked, "blob:synthetic")
})
