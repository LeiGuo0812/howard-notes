import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createHash } from "node:crypto"
import http from "node:http"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
const run = promisify(execFile)
import {
  assetReferences,
  captureDeployedAssets,
  localAssetManifest,
  retainedGenerations,
  generationIdentity,
  assertInitialSiteEmpty,
  initialResumeMode,
  waitForDeploymentManifest,
} from "./lib/deployment-assets.mjs"

const site = "https://notes.example/howard-notes/",
  api = `${site}api/content`
const sha = (body) => createHash("sha256").update(body).digest("hex")
function fixture({ manifest = false } = {}) {
  const assets = new Map([
    [
      `${api}/shell`,
      JSON.stringify({
        head: '<script src="/howard-notes/prescript-aaa.js"></script><link href="/howard-notes/index-old.css">',
        postscript: '<script src="/howard-notes/postscript-bbb.js"></script>',
      }),
    ],
    [`${site}admin/`, '<script src="admin-AAA.js"></script>'],
    [
      `${site}maintenance-assets/manifest.json`,
      JSON.stringify({
        entry: "maintenance-AAA.js",
        workerEntry: "maintenance-assets/worker/publish-AAA.js",
      }),
    ],
    [`${site}memory-assets/manifest.json`, JSON.stringify({ entry: "memory-AAA.js" })],
    [`${site}prescript-aaa.js`, "console.log('old prescript')"],
    [`${site}postscript-bbb.js`, 'import("./static/graph-AAA.js")'],
    [`${site}index-old.css`, '@font-face{src:url("./static/fonts/text.woff2")}'],
    [`${site}static/fonts/text.woff2`, "font bytes"],
    [`${site}static/graph-AAA.js`, "export default {}"],
    [`${site}admin/admin-AAA.js`, 'import "./chunks/lazy-AAA.js"'],
    [`${site}admin/chunks/lazy-AAA.js`, "export const lazy = true"],
    [`${site}maintenance-assets/maintenance-AAA.js`, "export const maintenance = true"],
    [`${site}maintenance-assets/worker/publish-AAA.js`, "export const worker = true"],
    [`${site}memory-assets/memory-AAA.js`, "export const memory = true"],
  ])
  if (manifest) {
    assets.set(`${site}maintenance-assets/unreferenced-lazy-CCC.js`, "export const dynamic = true")
    assets.set(
      `${site}deployment-manifest.json`,
      JSON.stringify({
        version: 1,
        files: [
          {
            path: "maintenance-assets/unreferenced-lazy-CCC.js",
            bytes: 27,
            sha256: sha("export const dynamic = true"),
          },
        ],
      }),
    )
    const value = JSON.parse(assets.get(`${site}deployment-manifest.json`))
    value.files[0].bytes = Buffer.byteLength(
      assets.get(`${site}maintenance-assets/unreferenced-lazy-CCC.js`),
    )
    assets.set(`${site}deployment-manifest.json`, JSON.stringify(value))
  }
  return {
    assets,
    fetcher: async (url) =>
      new Response(assets.get(String(url)) ?? "missing", {
        status: assets.has(String(url)) ? 200 : 404,
      }),
  }
}

test("fresh-machine bootstrap retains root scripts and transitive lazy scripts and fonts across repeated preparation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-assets-"))
  try {
    const { fetcher } = fixture()
    for (const name of ["first", "second", "fresh-machine"]) {
      const destination = path.join(dir, name)
      await captureDeployedAssets({
        site,
        api,
        destination,
        caches: [path.join(dir, "unrelated-local-build")],
        fetcher,
      })
      for (const resource of [
        "prescript-aaa.js",
        "postscript-bbb.js",
        "index-old.css",
        "static/graph-AAA.js",
        "admin/chunks/lazy-AAA.js",
        "static/fonts/text.woff2",
        "maintenance-assets/worker/publish-AAA.js",
      ])
        assert.ok((await fs.readFile(path.join(destination, resource))).length)
      await assert.rejects(fs.access(path.join(destination, "notes/removed.html")), {
        code: "ENOENT",
      })
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("hashed sample previews retain their HTML and runtime dependencies without retaining content HTML", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-sample-assets-"))
  try {
    const { assets, fetcher } = fixture()
    assets.set(
      `${site}admin/admin-AAA.js`,
      'const sample = "admin/site-preview-0123456789abcdef.html"; const note = "notes/removed.html"',
    )
    assets.set(
      `${site}admin/site-preview-0123456789abcdef.html`,
      '<link href="../index-old.css"><script src="./sample-AAA.js"></script>',
    )
    assets.set(`${site}admin/sample-AAA.js`, "export const sample = true")
    await captureDeployedAssets({ site, api, destination: dir, fetcher })
    for (const name of [
      "admin/site-preview-0123456789abcdef.html",
      "admin/sample-AAA.js",
      "index-old.css",
      "static/fonts/text.woff2",
    ])
      assert.ok((await fs.readFile(path.join(dir, name))).length)
    await fs.writeFile(path.join(dir, "admin/ordinary.html"), "excluded")
    const manifest = await localAssetManifest(dir)
    assert.ok(
      manifest.files.some((entry) => entry.path === "admin/site-preview-0123456789abcdef.html"),
    )
    assert.equal(
      manifest.files.some((entry) => entry.path === "admin/ordinary.html"),
      false,
    )
    assert.equal(
      assetReferences(
        '"notes/removed.html" "admin/ordinary.html"',
        `${site}admin/admin-AAA.js`,
        site,
      ).length,
      0,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("manifest retains lazy chunks and validates integrity rather than trusting local caches", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-assets-"))
  try {
    const { assets, fetcher } = fixture({ manifest: true })
    await captureDeployedAssets({ site, api, destination: dir, fetcher })
    assert.equal(
      await fs.readFile(path.join(dir, "maintenance-assets/unreferenced-lazy-CCC.js"), "utf8"),
      "export const dynamic = true",
    )
    assets.set(`${site}maintenance-assets/unreferenced-lazy-CCC.js`, "wrong bytes")
    await assert.rejects(
      captureDeployedAssets({ site, api, destination: dir, fetcher }),
      /完整性不匹配/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("unavailable deployed dependencies fail closed and do not silently publish a broken asset set", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-assets-"))
  try {
    const { assets, fetcher } = fixture()
    assets.delete(`${site}prescript-aaa.js`)
    await assert.rejects(
      captureDeployedAssets({ site, api, destination: dir, fetcher }),
      /无法保留线上资源/,
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("resource discovery only retains same-origin paths inside the site", () => {
  assert.deepEqual(
    assetReferences(
      '"https://third-party.example/x.js" "../../../private/x.js" "maintenance-assets/x.js"',
      `${site}admin/chunks/a.js`,
      site,
    ),
    [`${site}maintenance-assets/x.js`],
  )
})

test("deployment manifest excludes HTML, originals and images while hashing all emitted runtime assets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-assets-"))
  try {
    await fs.writeFile(path.join(dir, "prescript-old.js"), "js")
    await fs.writeFile(path.join(dir, "index.html"), "html")
    await fs.writeFile(path.join(dir, "private.md"), "md")
    await fs.writeFile(path.join(dir, "photo.png"), "png")
    assert.deepEqual((await localAssetManifest(dir, "commit")).files, [
      { path: "prescript-old.js", bytes: 2, sha256: sha("js") },
    ])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("bootstrap ignores bundle module labels, grammar scope names, regexes and JSON filenames", () => {
  const code = `"node_modules/extend/index.js" "runtime-config.json" "flexsearch.bundle.module.min.js" "comment.line.double-slash.js" t=!/^maintenance-[A-Z0-9]+/.js/; import("./chunks/lazy-ABCD1234.js")`
  assert.deepEqual(assetReferences(code, `${site}static/scripts/main.js`, site), [
    `${site}static/scripts/chunks/lazy-ABCD1234.js`,
  ])
})

test("asset preparation survives two local builds and emits only the new build inventory", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-prepare-assets-"))
  const { assets } = fixture()
  const server = http.createServer((request, response) => {
    const body = assets.get(`https://notes.example${request.url}`)
    response.writeHead(body === undefined ? 404 : 200)
    response.end(body ?? "missing")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const put = async (name, body) => {
    const file = path.join(dir, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
  }
  try {
    await run("git", ["init", "-q"], { cwd: dir })
    await run(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        "fixture",
      ],
      { cwd: dir },
    )
    await put(
      "runtime/config.json",
      JSON.stringify({
        apiBase: `http://127.0.0.1:${server.address().port}/howard-notes/api/content`,
      }),
    )
    const script = new URL("./prepare-cloudflare-assets.mjs", import.meta.url).pathname
    for (const generation of ["one", "two"]) {
      await fs.rm(path.join(dir, "public"), { recursive: true, force: true })
      await put(`public/new-${generation}.js`, generation)
      await put("public/index.html", generation)
      await run(process.execPath, [script], { cwd: dir, env: { ...process.env, CONTENT_API: "" } })
      const output = path.join(dir, ".local/cloudflare-assets/howard-notes")
      assert.equal(
        await fs.readFile(path.join(output, "prescript-aaa.js"), "utf8"),
        "console.log('old prescript')",
      )
      assert.equal(
        await fs.readFile(path.join(output, "index-old.css"), "utf8"),
        '@font-face{src:url("./static/fonts/text.woff2")}',
      )
      const manifest = JSON.parse(
        await fs.readFile(path.join(output, "deployment-manifest.json"), "utf8"),
      )
      assert.deepEqual(
        manifest.files.map((file) => file.path),
        [`new-${generation}.js`],
      )
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("A to B to C deployments retain an already-open A tab's lazy code and matching hashed workspace", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-generations-"))
  const now = Date.parse("2026-10-03T12:00:00Z")
  const make = (id, at) => {
    const script = `maintenance-assets/chunks/editor-${id.repeat(8)}.js`,
      template = `maintenance-assets/workspace-${id.toLowerCase().repeat(16)}.txt`
    const records = [
      [script, `export const version="${id}"`],
      [template, `<main>${id}</main>`],
    ]
    return {
      version: 1,
      commit: id,
      createdAt: new Date(at).toISOString(),
      files: records.map(([path, body]) => ({
        path,
        bytes: Buffer.byteLength(body),
        sha256: sha(body),
      })),
      records,
    }
  }
  const a = make("A", now - 7200000),
    b = make("B", now - 3600000),
    c = make("C", now)
  try {
    const assets = new Map(
      [...a.records, ...b.records, ...c.records].map(([name, body]) => [site + name, body]),
    )
    assets.set(`${api}/shell`, JSON.stringify({ head: "" }))
    assets.set(`${site}admin/`, "<html></html>")
    assets.set(`${site}maintenance-assets/manifest.json`, "{}")
    assets.set(`${site}memory-assets/manifest.json`, "{}")
    const fetcher = async (url) =>
      new Response(assets.get(String(url)) ?? "missing", {
        status: assets.has(String(url)) ? 200 : 404,
      })
    for (const [current, previous] of [
      [b, [a]],
      [c, [b, a]],
    ]) {
      assets.set(
        `${site}deployment-manifest.json`,
        JSON.stringify({ ...current, previousGenerations: previous }),
      )
      const output = path.join(dir, current.commit)
      const result = await captureDeployedAssets({ site, api, destination: output, fetcher, now })
      assert.equal(
        result.generations.some(
          (generation) => generationIdentity(generation) === generationIdentity(a),
        ),
        true,
      )
      for (const [name, body] of a.records)
        assert.equal(await fs.readFile(path.join(output, name), "utf8"), body)
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
test("generation history covers the session window with an explicit cap and preserves the latest few after expiry", () => {
  const now = Date.parse("2026-10-03T12:00:00Z")
  const generation = (index, age) => ({
    commit: String(index),
    createdAt: new Date(now - age).toISOString(),
    files: [{ path: `asset-${index}.js`, bytes: 1, sha256: sha(String(index)) }],
  })
  const current = generation(0, 0),
    previous = Array.from({ length: 7 }, (_, index) => generation(index + 1, (index + 1) * 3600000))
  const recent = retainedGenerations({ ...current, previousGenerations: previous }, now)
  assert.equal(recent.generations.length, 7)
  assert.equal(recent.historyLimited, true)
  const expired = retainedGenerations(
    {
      ...current,
      previousGenerations: previous.map((item) => ({
        ...item,
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })),
    },
    now,
  )
  assert.equal(expired.generations.length, 2)
  const resumed = retainedGenerations(
    {
      ...current,
      previousGenerations: previous.map((item) => ({
        ...item,
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })),
    },
    now,
    current,
  )
  assert.deepEqual(
    resumed.generations.map((generation) => generation.commit),
    ["1", "2"],
  )
})
test("runtime inventory and reference discovery include only immutable workspace templates", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "howard-workspace-manifest-"))
  try {
    await fs.mkdir(path.join(dir, "maintenance-assets"))
    for (const name of ["workspace-0123456789abcdef.txt", "workspace.txt", "private-note.txt"])
      await fs.writeFile(path.join(dir, "maintenance-assets", name), "template")
    const manifest = await localAssetManifest(dir, "test")
    assert.deepEqual(
      manifest.files.map((entry) => entry.path),
      ["maintenance-assets/workspace-0123456789abcdef.txt"],
    )
    assert.deepEqual(
      assetReferences(
        '"maintenance-assets/workspace-0123456789abcdef.txt" "private-note.txt"',
        `${site}maintenance-assets/chunks/editor-AAAA.js`,
        site,
      ),
      [`${site}maintenance-assets/workspace-0123456789abcdef.txt`],
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("initial deployment refuses a live site, unavailable status or network failure", async () => {
  const empty = async () => new Response("missing", { status: 404 })
  assert.equal(await assertInitialSiteEmpty({ site, api, fetcher: empty }), true)
  for (const fetcher of [
    async (url) => (String(url) === site ? new Response("existing page") : empty()),
    async (url) =>
      String(url).endsWith("/status")
        ? Response.json({ revision: 1, commit: "published" })
        : empty(),
    async (url) =>
      String(url).endsWith("/status") ? new Response("unavailable", { status: 503 }) : empty(),
    async () => {
      throw new Error("unreachable")
    },
  ])
    await assert.rejects(assertInitialSiteEmpty({ site, api, fetcher }))
})

test("interrupted initial deployment resumes only its exact recorded assets and known content state", () => {
  const manifest = { version: 1, commit: "initial", files: [] }
  assert.equal(
    initialResumeMode(manifest, structuredClone(manifest), { revision: 0, commit: null }),
    "empty",
  )
  assert.equal(
    initialResumeMode(manifest, structuredClone(manifest), { revision: 1, commit: "initial" }),
    "published",
  )
  assert.throws(() =>
    initialResumeMode(manifest, { ...manifest, commit: "other" }, { revision: 0 }),
  )
  assert.throws(() => initialResumeMode(manifest, manifest, { error: "unavailable" }))
})

test("deployment waits for exact manifest propagation and refuses mismatched or unavailable assets", async () => {
  const expected = { commit: "new", files: [{ path: "new.js", sha256: sha("new") }] }
  const old = { ...expected, commit: "old" }
  const delays = []
  let reads = 0
  await waitForDeploymentManifest(
    expected,
    async () => (++reads < 3 ? old : expected),
    async (ms) => delays.push(ms),
  )
  assert.equal(reads, 3)
  assert.deepEqual(delays, [1000, 2000])
  reads = 0
  await assert.rejects(
    waitForDeploymentManifest(
      expected,
      async () => {
        reads++
        return { ...expected, files: [] }
      },
      async () => {},
    ),
    /暂不切换/,
  )
  assert.equal(reads, 8)
  await assert.rejects(
    waitForDeploymentManifest(
      expected,
      async () => {
        throw new Error("network unavailable")
      },
      async () => {},
    ),
    /network unavailable/,
  )
})
