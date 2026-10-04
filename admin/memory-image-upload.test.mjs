import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import {
  clipboardMemoryImages,
  validateMemoryImageBatch,
  moveMemoryImageAnchor,
  createMemoryImageUploader,
  loadMemoryImageHostSettings,
} from "./memory-image-upload.mjs"
import { gitBlobSha } from "./github.mjs"

const file = (name = "image.png", size = 50) => ({ name, size })
const pause = () => new Promise((resolve) => setTimeout(resolve, 10))
const deferred = () => {
  let resolve
  const promise = new Promise((reply) => (resolve = reply))
  return { promise, resolve }
}
function textarea(value, selectionStart = 0) {
  return {
    value,
    selectionStart,
    setRangeText(text, start, end, selectionMode) {
      assert.equal(selectionMode, "preserve")
      assert.equal(start, end, "uploads insert without replacing previously selected text")
      this.value = this.value.slice(0, start) + text + this.value.slice(end)
    },
  }
}
function fixture(options = {}) {
  const input = textarea("before|after", 6)
  const notices = [],
    counts = [],
    images = [
      { alt: "image.png", url: "https://raw.githubusercontent.com/owner/images/abc/img.png" },
    ]
  const controller = createMemoryImageUploader({
    textarea: input,
    getHost: async () => ({ upload: async () => images }),
    isCurrent: () => true,
    notify: (...args) => notices.push(args),
    onPending: (count) => counts.push(count),
    prepare: async (file) => ({ alt: file.name }),
    ...options,
  })
  return { input, notices, counts, controller, images }
}

test("image-only paste is intercepted; plain text, mixed text and HTML paste stay normal", () => {
  const image = file()
  const items = [
    { kind: "file", type: "image/png", getAsFile: () => image },
    { kind: "file", type: "application/pdf", getAsFile: () => file("other.pdf") },
  ]
  assert.deepEqual(clipboardMemoryImages({ items, getData: () => "" }), [image])
  assert.deepEqual(clipboardMemoryImages({ items, getData: () => "ordinary copied text" }), [])
  assert.deepEqual(
    clipboardMemoryImages({
      items,
      getData: (type) => (type === "text/html" ? "<b>copied</b>" : ""),
    }),
    [],
  )
  assert.deepEqual(clipboardMemoryImages(null), [])
})

test("image batches enforce per-file and aggregate limits before reading or uploading bytes", () => {
  assert.equal(validateMemoryImageBatch([file()]).length, 1)
  assert.throws(() => validateMemoryImageBatch([]), /1–20/)
  assert.throws(() => validateMemoryImageBatch(Array.from({ length: 21 }, () => file())), /1–20/)
  assert.throws(() => validateMemoryImageBatch([file("empty", 0)]), /10 MiB/)
  assert.throws(() => validateMemoryImageBatch([file("huge", 10 * 1024 * 1024 + 1)]), /10 MiB/)
  assert.throws(
    () =>
      validateMemoryImageBatch(Array.from({ length: 6 }, () => file("large", 10 * 1024 * 1024))),
    /50 MiB/,
  )
})

test("anchors follow typing before their position and retain text inserted at that position", () => {
  assert.equal(moveMemoryImageAnchor(6, "before|after", "XXbefore|after"), 8)
  assert.equal(moveMemoryImageAnchor(6, "before|after", "beforeNEW|after"), 6)
  assert.equal(moveMemoryImageAnchor(6, "before|after", "before|afterNEW"), 6)
  assert.equal(moveMemoryImageAnchor(6, "before|after", "XXafter"), 2)
  assert.equal(moveMemoryImageAnchor(100, "abc", "abcd"), 3)
})

test("async upload inserts at the tracked original caret and preserves intervening edits", async () => {
  const network = deferred()
  const state = fixture({ getHost: async () => ({ upload: () => network.promise }) })
  const result = state.controller.enqueue([file()])
  assert.equal(state.controller.pending, 1)
  await pause()
  state.input.value = "XXbefore|after"
  state.controller.observe()
  state.input.value = "XXbeforeNEW|after"
  state.controller.observe()
  state.input.value += " typed later"
  state.controller.observe()
  network.resolve(state.images)
  assert.equal(await result, true)
  assert.match(state.input.value, /^XXbefore\n!\[image\.png\]/)
  assert.ok(state.input.value.endsWith("\nNEW|after typed later"))
  assert.equal(state.controller.pending, 0)
  assert.deepEqual(state.counts, [1, 0])
})

test("a session change rejects late successful uploads without inserting into the new session", async () => {
  const network = deferred()
  let identity = "session-a"
  const state = fixture({
    scope: () => identity,
    getHost: async () => ({ upload: () => network.promise }),
  })
  const result = state.controller.enqueue([file()])
  await pause()
  identity = "session-b"
  network.resolve(state.images)
  assert.equal(await result, false)
  assert.equal(state.input.value, "before|after")
  assert.equal(state.controller.pending, 0)
  assert.ok(!state.notices.some(([, kind]) => kind === "done"))
})

test("switching cards aborts old jobs and lets the new card upload without waiting", async () => {
  const network = deferred()
  let calls = 0,
    oldSignal
  const state = fixture({
    getHost: async (signal) => {
      if (++calls === 1) {
        oldSignal = signal
        return { upload: () => network.promise }
      }
      return { upload: async () => [{ alt: "new", url: "https://example.com/new.png" }] }
    },
  })
  const oldResult = state.controller.enqueue([file()])
  await pause()
  state.controller.reset()
  assert.equal(oldSignal.aborted, true)
  state.input.value = "second card"
  state.input.selectionStart = 6
  assert.equal(await state.controller.enqueue([file()]), true)
  assert.match(state.input.value, /^second\n!\[new\]/)
  const accepted = state.input.value
  network.resolve(state.images)
  assert.equal(await oldResult, false)
  assert.equal(state.input.value, accepted)
})

test("failed uploads preserve text, release publishing and allow a retry", async () => {
  let fail = true
  const state = fixture({
    getHost: async () => ({
      async upload() {
        if (fail) throw new Error("permission denied")
        return [{ alt: "retry", url: "https://example.com/retry.png" }]
      },
    }),
  })
  assert.equal(await state.controller.enqueue([file()]), false)
  assert.equal(state.input.value, "before|after")
  assert.equal(state.controller.pending, 0)
  assert.ok(state.notices.some(([text, kind]) => text === "permission denied" && kind === "error"))
  fail = false
  assert.equal(await state.controller.enqueue([file()]), true)
  assert.match(state.input.value, /!\[retry\]/)
})

test("queued batches at the same original caret retain their upload order", async () => {
  let count = 0
  const state = fixture({
    getHost: async () => ({
      upload: async () => [{ alt: String(++count), url: `https://example.com/${count}.png` }],
    }),
  })
  const first = state.controller.enqueue([file()]),
    second = state.controller.enqueue([file()])
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  assert.ok(state.input.value.indexOf("![1]") < state.input.value.indexOf("![2]"))
  assert.ok(state.input.value.endsWith("\n|after"))
})

test("the upload queue is bounded and disposing prevents late effects", async () => {
  const network = deferred()
  const state = fixture({ getHost: async () => ({ upload: () => network.promise }) })
  const results = Array.from({ length: 3 }, () => state.controller.enqueue([file()]))
  assert.equal(await state.controller.enqueue([file()]), false)
  assert.equal(state.controller.pending, 3)
  await pause()
  state.controller.destroy()
  network.resolve(state.images)
  assert.deepEqual(await Promise.all(results), [false, false, false])
  assert.equal(state.controller.pending, 0)
  assert.equal(state.input.value, "before|after")
})

test("image settings read only a fresh ref and a validated immutable site file", async () => {
  const text = await fs.readFile(new URL("../library/site.json", import.meta.url), "utf8")
  const site = JSON.parse(text)
  const sha = await gitBlobSha(text),
    commit = "a".repeat(40),
    calls = []
  const client = {
    branch: "main",
    async repo(endpoint) {
      calls.push(endpoint)
      return endpoint.startsWith("git/ref/")
        ? { object: { sha: commit } }
        : {
            type: "file",
            path: "library/site.json",
            sha,
            encoding: "base64",
            content: Buffer.from(text).toString("base64"),
          }
    },
  }
  assert.deepEqual(await loadMemoryImageHostSettings(client), site.imageHost)
  assert.deepEqual(calls, ["git/ref/heads/main", `contents/library/site.json?ref=${commit}`])
  client.repo = async () => ({ object: { sha: "main" } })
  await assert.rejects(() => loadMemoryImageHostSettings(client), /版本不正确/)
  client.repo = async (endpoint) =>
    endpoint.startsWith("git/ref/")
      ? { object: { sha: commit } }
      : {
          type: "file",
          path: "library/site.json",
          sha: "b".repeat(40),
          encoding: "base64",
          content: Buffer.from(text).toString("base64"),
        }
  await assert.rejects(() => loadMemoryImageHostSettings(client), /版本不匹配/)
})
