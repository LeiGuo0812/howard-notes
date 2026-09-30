import test from "node:test"
import assert from "node:assert/strict"
import { prepareImage, GitHubImageHost, MAX_IMAGE_BYTES } from "./images.mjs"
import {
  DEFAULT_IMAGE_HOST,
  imageHostSettings,
  imageLink,
  validateImageHost,
} from "../scripts/lib/image-host.mjs"
import { validateSite } from "../scripts/lib/site-settings.mjs"
import fs from "node:fs/promises"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FQAAAABJRU5ErkJggg==",
  "base64",
)
const file = (name = "图片.png", bytes = png) => new File([bytes], name, { type: "image/png" })
const headSha = "a".repeat(40),
  commitSha = "b".repeat(40)
function fixture({
  entries = [],
  status,
  privateRepo = false,
  push = true,
  race = false,
  blobFailure = false,
} = {}) {
  const calls = []
  const client = {
    async request(endpoint, method = "GET", body) {
      calls.push({ endpoint, method, body })
      if (status) {
        const error = new Error("upstream failure")
        error.status = status
        throw error
      }
      if (endpoint === "/repos/LeiGuo0812/pic_cloud_gl")
        return { private: privateRepo, permissions: { push } }
      if (endpoint.endsWith("/git/ref/heads/main")) return { object: { sha: headSha } }
      if (method === "GET" && endpoint.includes("/git/commits/"))
        return { tree: { sha: "current-tree" } }
      if (method === "GET" && endpoint.includes("/git/trees/"))
        return { truncated: false, tree: entries }
      if (endpoint.endsWith("/git/blobs") && method === "POST") {
        if (blobFailure) throw new Error("network failure")
        const bytes = Buffer.from(body.content, "base64")
        const prefix = Buffer.from(`blob ${bytes.length}\0`)
        const sha = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-1", Buffer.concat([prefix, bytes]))),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")
        return { sha }
      }
      if (endpoint.endsWith("/git/trees") && method === "POST") return { sha: "new-tree" }
      if (endpoint.endsWith("/git/commits") && method === "POST") return { sha: commitSha }
      if (endpoint.endsWith("/git/refs/heads/main") && method === "PATCH") {
        if (race) {
          const error = new Error("remote changed")
          error.status = 422
          throw error
        }
        return { object: { sha: body.sha } }
      }
      assert.fail("unexpected endpoint " + endpoint)
    },
  }
  return { client, calls, host: new GitHubImageHost(client, DEFAULT_IMAGE_HOST) }
}

test("image settings accept legacy site settings and reject escaping or invalid destinations", async () => {
  const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
  delete settings.imageHost
  assert.equal(validateSite(settings), settings)
  assert.deepEqual(imageHostSettings(settings), DEFAULT_IMAGE_HOST)
  for (const directory of [
    "../img",
    "/img",
    "img/..",
    "img//x",
    "img\\x",
    "img/%2e%2e",
    "img?raw=1",
    "img\nsecret",
  ]) {
    assert.throws(() => validateImageHost({ ...DEFAULT_IMAGE_HOST, directory }))
  }
  for (const branch of [
    "../main",
    "main..next",
    "main.lock",
    "main/",
    "main@{1}",
    "main\n",
    "main?x",
  ]) {
    assert.throws(() => validateImageHost({ ...DEFAULT_IMAGE_HOST, branch }))
  }
  assert.throws(() =>
    validateImageHost({ ...DEFAULT_IMAGE_HOST, repository: "https://github.com/owner/repo" }),
  )
  assert.equal(
    validateImageHost({ ...DEFAULT_IMAGE_HOST, directory: "图片/文章", branch: "media/photos" })
      .directory,
    "图片/文章",
  )
  assert.equal(validateImageHost({ ...DEFAULT_IMAGE_HOST, directory: "" }).directory, "")
})
test("images preserve original bytes, use content names, and reject empty, oversized or disguised files", async () => {
  const image = await prepareImage(file("[摄影]\\作品.png"))
  assert.deepEqual(Buffer.from(image.base64, "base64"), png)
  assert.match(image.file, /^[a-f0-9]{64}\.png$/)
  assert.equal(image.alt, "摄影作品.png")
  assert.equal((await prepareImage(file("另一名称.png"))).file, image.file)
  await assert.rejects(
    prepareImage(file("not-a-png.png", Buffer.from("<html>fake image</html>"))),
    /请选择/,
  )
  await assert.rejects(prepareImage(file("empty.png", Buffer.alloc(0))), /非空/)
  await assert.rejects(prepareImage({ size: MAX_IMAGE_BYTES + 1 }), /10 MiB/)
})
test("external image links pin the committed version and encode configurable directories", async () => {
  const image = await prepareImage(file())
  const url = imageLink({ ...DEFAULT_IMAGE_HOST, directory: "摄影 图/随笔" }, commitSha, image.file)
  assert.equal(new URL(url).origin, "https://raw.githubusercontent.com")
  assert.ok(url.includes("/" + commitSha + "/%E6%91%84%E5%BD%B1%20%E5%9B%BE/"))
  assert.ok(url.endsWith(image.file))
  assert.throws(() => imageLink(DEFAULT_IMAGE_HOST, "main", image.file))
})
test("a batch uploads to the image repo in one atomic commit without changing the notes repo", async () => {
  const one = await prepareImage(file()),
    two = await prepareImage(file("two.png", Buffer.concat([png, Buffer.from("second")]))),
    { host, calls } = fixture()
  const links = await host.upload([one, two, one])
  assert.equal(links.length, 3)
  assert.equal(links[0].url, links[2].url)
  assert.ok(calls.every((call) => call.endpoint.startsWith("/repos/LeiGuo0812/pic_cloud_gl")))
  assert.equal(calls.filter((call) => call.endpoint.endsWith("/git/blobs")).length, 2)
  const tree = calls.find((call) => call.endpoint.endsWith("/git/trees") && call.method === "POST")
  assert.deepEqual(
    tree.body.tree.map((item) => item.path),
    ["img/" + one.file, "img/" + two.file],
  )
  assert.ok(tree.body.tree.every((item) => item.sha && !item.content))
  assert.deepEqual(
    calls.find((call) => call.endpoint.endsWith("/git/commits") && call.method === "POST").body
      .parents,
    [headSha],
  )
  assert.deepEqual(calls.at(-1).body, { sha: commitSha, force: false })
  assert.ok(links.every((image) => image.url.includes("/" + commitSha + "/img/")))
})
test("reuploading identical content reuses the existing image without making a commit", async () => {
  const image = await prepareImage(file()),
    { host, calls } = fixture({
      entries: [{ path: "img/" + image.file, type: "blob", sha: image.blobSha }],
    })
  const result = await host.upload([image])
  assert.ok(result[0].url.includes("/" + headSha + "/img/"))
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0)
})
test("path collisions are detected before any image blob or branch write", async () => {
  const image = await prepareImage(file()),
    { host, calls } = fixture({
      entries: [{ path: "img/" + image.file, type: "blob", sha: "different" }],
    })
  await assert.rejects(host.upload([image]), /未覆盖/)
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0)
})
test("branch races and blob failures return no links and never force-update", async () => {
  const image = await prepareImage(file())
  const race = fixture({ race: true })
  await assert.rejects(race.host.upload([image]), /remote changed/)
  assert.equal(race.calls.filter((call) => call.method === "PATCH").length, 1)
  assert.equal(race.calls.at(-1).body.force, false)
  const failure = fixture({ blobFailure: true })
  await assert.rejects(failure.host.upload([image]), /network failure/)
  assert.equal(failure.calls.filter((call) => call.method === "PATCH").length, 0)
})
test("private, read-only and unauthorized repositories cannot accept uploads; expired credentials are preserved", async () => {
  const image = await prepareImage(file())
  for (const options of [
    { privateRepo: true },
    { push: false },
    { status: 403 },
    { status: 404 },
  ]) {
    const { host, calls } = fixture(options)
    await assert.rejects(host.upload([image]), /公开|权限|仓库/)
    assert.equal(calls.filter((call) => call.method !== "GET").length, 0)
  }
  await assert.rejects(
    fixture({ status: 401 }).host.upload([image]),
    (error) => error.status === 401 && error.code !== "IMAGE_PERMISSION",
  )
})
