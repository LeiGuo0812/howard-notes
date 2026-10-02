import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { publishPrivateAttachments, publicAttachmentMapping } from "./public-attachments.mjs"

const hex = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex")
const blobSha = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
function fixture() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(fs.readFileSync(new URL("personal-notes-schema.sql", import.meta.url), "utf8"))
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let values = []
      return {
        bind(...v) {
          values = v
          return this
        },
        async first() {
          return statement.get(...values) || null
        },
      }
    },
  }
  const objects = new Map(),
    entries = new Map(),
    blobs = new Map(),
    reads = []
  const env = {
    PERSONAL_FILES_BUCKET: {
      async get(key) {
        reads.push(key)
        const bytes = objects.get(key)
        return bytes
          ? {
              size: bytes.length,
              async arrayBuffer() {
                return bytes.slice().buffer
              },
            }
          : null
      },
    },
  }
  const settings = {
    imageHost: { repository: "owner/pictures", directory: "img/note-attachments", branch: "main" },
  }
  const state = {
    head: "1".repeat(40),
    requests: [],
    blobPosts: 0,
    refWrites: 0,
    pendingTree: null,
    nextCommit: null,
    loseAck: false,
    privateRepo: false,
    writable: true,
    truncated: false,
    incorrectBlobSha: false,
  }
  const token = "test-owner-not-a-real-token"
  const fetcher = async (url, options) => {
    const endpoint = new URL(url).pathname + new URL(url).search
    state.requests.push({ endpoint, method: options.method })
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    const body = options.body ? JSON.parse(options.body) : null
    const response = (value) => Response.json(value)
    if (endpoint === "/repos/owner/pictures")
      return response({ private: state.privateRepo, permissions: { push: state.writable } })
    if (endpoint === "/repos/owner/pictures/git/ref/heads/main")
      return response({ object: { sha: state.head } })
    if (endpoint.startsWith("/repos/owner/pictures/git/commits/") && options.method === "GET")
      return response({ tree: { sha: "pictures-tree" } })
    if (
      endpoint.startsWith("/repos/owner/pictures/git/trees/pictures-tree") &&
      options.method === "GET"
    )
      return response({
        tree: [...entries].map(([path, record]) => ({ path, ...record })),
        truncated: state.truncated,
      })
    if (endpoint === "/repos/owner/pictures/git/blobs" && options.method === "POST") {
      state.blobPosts++
      assert.equal(body.encoding, "base64")
      const bytes = new Uint8Array(Buffer.from(body.content, "base64")),
        sha = blobSha(bytes)
      blobs.set(sha, bytes)
      return response({ sha: state.incorrectBlobSha ? "f".repeat(40) : sha })
    }
    if (endpoint === "/repos/owner/pictures/git/trees" && options.method === "POST") {
      state.pendingTree = body.tree
      return response({ sha: "next-tree" })
    }
    if (endpoint === "/repos/owner/pictures/git/commits" && options.method === "POST") {
      state.nextCommit = hex("sha1", JSON.stringify(body) + state.refWrites)
      return response({ sha: state.nextCommit })
    }
    if (endpoint === "/repos/owner/pictures/git/refs/heads/main" && options.method === "PATCH") {
      assert.equal(body.force, false)
      for (const item of state.pendingTree)
        entries.set(item.path, { type: item.type, mode: item.mode, sha: item.sha })
      state.head = body.sha
      state.refWrites++
      if (state.loseAck) {
        state.loseAck = false
        throw new Error("accepted ref response lost")
      }
      return response({ object: { sha: state.head } })
    }
    throw new Error(`Unexpected attachment fixture request ${endpoint}`)
  }
  const client = { token, fetcher }
  const add = (id, bytes, name = "原始图片.png", aliases = []) => {
    const sha256 = hex("sha256", bytes),
      objectKey = `personal-files/${sha256}`
    objects.set(objectKey, bytes.slice())
    sqlite
      .prepare(
        "INSERT INTO personal_files(id,name,mime_type,size,sha256,object_key,complete,created_at,metadata) VALUES(?,?,?, ?,?,?,1,?,'{}')",
      )
      .run(
        id,
        name,
        name.endsWith(".pdf") ? "application/pdf" : "image/png",
        bytes.length,
        sha256,
        objectKey,
        Date.now(),
      )
    return {
      fileId: id,
      name,
      sha256,
      source: `/howard-notes/api/content/personal/files/${id}`,
      aliases,
      storage: { provider: "r2", key: objectKey, private: true },
      originalPrivatePath: "private/source/path",
    }
  }
  const publish = (attachments, consent = true, previous = []) =>
    publishPrivateAttachments(env, DB, client, { attachments }, settings, consent, previous)
  return { sqlite, DB, env, client, settings, state, objects, entries, blobs, reads, add, publish }
}

test("unapproved private attachments make zero public repository calls or private file reads", async () => {
  const f = fixture(),
    attachment = f.add("file-one", Uint8Array.from([0, 1, 2, 255]))
  for (const consent of [false, "yes", 1])
    await assert.rejects(f.publish([attachment], consent), { status: 409 })
  await assert.rejects(
    publishPrivateAttachments(
      f.env,
      f.DB,
      f.client,
      { attachments: [attachment] },
      f.settings,
      undefined,
    ),
    { status: 409 },
  )
  assert.equal(f.state.requests.length, 0)
  assert.equal(f.reads.length, 0)
  assert.equal(f.state.refWrites, 0)
  assert.equal(f.state.blobPosts, 0)
})

test("explicitly approved attachments upload one immutable original per step and resume from public-only checkpoint", async () => {
  const f = fixture(),
    bytes1 = Uint8Array.from([137, 80, 78, 71, 0, 128, 255, 42]),
    bytes2 = new TextEncoder().encode("%PDF-1.7\n测试原文\n%%EOF\n")
  const first = f.add("file-one", bytes1, "图片.PNG", ["图片.PNG", "assets/图片.PNG"]),
    second = f.add("file-two", bytes2, "文献.pdf")
  const one = await f.publish([first, second])
  assert.equal(one.complete, false)
  assert.equal(one.mappings.length, 1)
  assert.equal(f.state.blobPosts, 1)
  assert.equal(f.state.refWrites, 1)
  assert.equal(f.reads.length, 1)
  assert.equal(one.mappings[0].source, first.source)
  assert.deepEqual(Object.keys(one.mappings[0]).sort(), ["aliases", "publicUrl", "source"])
  assert.deepEqual(one.mappings[0].aliases, first.aliases)
  assert.deepEqual(f.blobs.get(blobSha(bytes1)), bytes1)
  assert(one.mappings[0].publicUrl.endsWith(`/${first.sha256}.png`))
  assert(one.mappings[0].publicUrl.includes(`/${f.state.head}/`))
  const checkpoint = JSON.parse(JSON.stringify(one.mappings))
  const two = await f.publish([first, second], true, checkpoint)
  assert.equal(two.complete, true)
  assert.equal(two.mappings.length, 2)
  assert.equal(f.state.blobPosts, 2)
  assert.equal(f.state.refWrites, 2)
  assert.equal(f.reads.length, 2)
  assert.equal(two.mappings[0].publicUrl, one.mappings[0].publicUrl)
  assert(two.mappings[1].publicUrl.endsWith(`/${second.sha256}.pdf`))
  assert.deepEqual(f.blobs.get(blobSha(bytes2)), bytes2)
  assert.equal(f.entries.get(`img/note-attachments/${second.sha256}.pdf`).sha, blobSha(bytes2))
  const done = await f.publish([first, second], false, two.mappings)
  assert.equal(done.complete, true)
  assert.deepEqual(done.mappings, two.mappings)
  assert.equal(f.state.refWrites, 2)
  assert.equal(f.state.blobPosts, 2)
})

test("a lost accepted attachment ref acknowledgement retries without another blob or commit", async () => {
  const f = fixture(),
    bytes = Uint8Array.from([0, 128, 255, 10, 13]),
    attachment = f.add("file-one", bytes, "归档.zip")
  f.state.loseAck = true
  await assert.rejects(f.publish([attachment]), /accepted ref response lost/)
  assert.equal(f.state.refWrites, 1)
  assert.equal(f.state.blobPosts, 1)
  const resumed = await f.publish([attachment], true, [])
  assert.equal(resumed.complete, true)
  assert.equal(f.state.refWrites, 1)
  assert.equal(f.state.blobPosts, 1)
  assert(resumed.mappings[0].publicUrl.endsWith(`/${attachment.sha256}.zip`))
})

test("an occupied immutable SHA path with other bytes or nonblob entry is never overwritten", async () => {
  for (const type of ["blob", "tree"]) {
    const f = fixture(),
      attachment = f.add("file-one", Uint8Array.from([0, 1, 2]))
    f.entries.set(`img/note-attachments/${attachment.sha256}.png`, {
      type,
      sha: "c".repeat(40),
      mode: type === "tree" ? "040000" : "100644",
    })
    await assert.rejects(f.publish([attachment]), { status: 409 })
    assert.equal(f.state.refWrites, 0)
    assert.equal(f.state.blobPosts, 0)
    assert.equal(f.entries.get(`img/note-attachments/${attachment.sha256}.png`).sha, "c".repeat(40))
  }
})

test("private SHA-256 and size mismatch fail before writing any public blob", async () => {
  const f = fixture(),
    attachment = f.add("file-one", Uint8Array.from([0, 1, 2]))
  f.objects.set(`personal-files/${attachment.sha256}`, Uint8Array.from([0, 1, 3]))
  await assert.rejects(f.publish([attachment]), { status: 409 })
  assert.equal(f.state.refWrites, 0)
  assert.equal(f.state.blobPosts, 0)
  f.objects.set(`personal-files/${attachment.sha256}`, Uint8Array.from([0, 1]))
  await assert.rejects(f.publish([attachment]), { status: 409 })
  assert.equal(f.state.blobPosts, 0)
})

test("Git blob SHA-1 acknowledgement must match exact private original bytes", async () => {
  const f = fixture(),
    attachment = f.add("file-one", Uint8Array.from([0, 1, 2, 255]))
  f.state.incorrectBlobSha = true
  await assert.rejects(f.publish([attachment]), { status: 409 })
  assert.equal(f.state.blobPosts, 1)
  assert.equal(f.state.refWrites, 0)
  assert.equal(f.entries.size, 0)
})

test("public mappings contain no R2 identity or private provenance and reject unsafe URLs", () => {
  const mapping = publicAttachmentMapping({
    source: "original.png",
    publicUrl:
      "https://raw.githubusercontent.com/owner/pictures/" + "a".repeat(40) + "/img/image.png",
    aliases: ["原图.png", 17, "a".repeat(2001)],
    fileId: "private-id",
    storage: { key: "private-object" },
    originalPrivatePath: "private-original",
  })
  assert.deepEqual(Object.keys(mapping).sort(), ["aliases", "publicUrl", "source"])
  assert.deepEqual(mapping.aliases, ["原图.png"])
  assert(!JSON.stringify(mapping).includes("private-id"))
  assert(!JSON.stringify(mapping).includes("private-object"))
  assert(!JSON.stringify(mapping).includes("private-original"))
  for (const publicUrl of [
    "http://example.test/image.png",
    "javascript:alert(1)",
    "https://user:secret@example.test/img.png",
    "https://example.test/howard-notes/api/content/personal/files/id",
  ])
    assert.throws(() => publicAttachmentMapping({ source: "image.png", publicUrl }), {
      status: 409,
    })
})

test("missing private file or unapproved destination permissions preserve private source without public ref writes", async () => {
  for (const kind of ["missing", "private-repository", "no-write", "truncated-tree"]) {
    const f = fixture(),
      attachment = f.add("file-one", Uint8Array.from([0, 1, 2]))
    if (kind === "missing") f.sqlite.exec("DELETE FROM personal_files")
    if (kind === "private-repository") f.state.privateRepo = true
    if (kind === "no-write") f.state.writable = false
    if (kind === "truncated-tree") f.state.truncated = true
    await assert.rejects(f.publish([attachment]), { status: 409 })
    assert.equal(f.state.refWrites, 0)
    assert.equal(f.state.blobPosts, 0)
    assert.equal(f.objects.size, 1)
  }
})
