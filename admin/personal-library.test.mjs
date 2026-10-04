import test from "node:test"
import assert from "node:assert/strict"
import { PersonalLibrary } from "./personal-library.mjs"

const article = (id, published = false) => ({
  id,
  file: `notes/${id}.md`,
  title: id,
  category: "测试",
  date: "2026-10-02",
  published,
})
function fixture() {
  const publicArticle = article("public", true)
  const publicSnapshot = {
    commit: "git-commit",
    catalog: { version: 2, articles: [publicArticle] },
    entries: new Map([["library/notes/public.md", { sha: "public-sha" }]]),
    settings: {},
  }
  const rows = new Map(),
    versions = new Map(),
    calls = [],
    jobs = [],
    files = new Map()
  const git = {
    token: "test-token",
    snapshot: async () => publicSnapshot,
    settingsSnapshot: async () => ({
      ...publicSnapshot,
      tree: null,
      entries: new Map([["library/site.json", { sha: "settings-baseline" }]]),
      siteSha: "settings-baseline",
      settingsOnly: true,
    }),
    read: async () => ({ text: "公开原文\r\n", sha: "public-sha" }),
    save: () => assert.fail("private originals must never be committed to Git"),
  }
  const fetcher = async (url, options = {}) => {
    const route = new URL(url).pathname.split("/personal/")[1],
      body = typeof options.body === "string" ? JSON.parse(options.body) : options.body
    calls.push({ route, options, body })
    const response = (value, status = 200) => Response.json(value, { status })
    if (route === "jobs") {
      if (options.method === "POST") {
        const job = { id: crypto.randomUUID(), status: "queued", input: body }
        jobs.push(job)
        return response(job, 202)
      }
      return response({ jobs })
    }
    const query = new URL(url).searchParams
    const page = Number(query.get("page") || 1),
      pageSize = Number(query.get("pageSize") || 20)
    if (route === "drafts") return response({ drafts: [], total: 0, page, pageSize })
    if (route === "articles") {
      if (options.method === "POST") {
        const prior = rows.get(body.article.id)
        if (body.version !== (prior?.version || 0))
          return response({ error: "version conflict" }, 409)
        const version = body.version + 1,
          row = {
            article: body.article,
            raw: body.raw,
            version,
            sha: `pv:${version}`,
            status: "ACTIVE",
            publicLink: body.publicLink ?? prior?.publicLink,
          }
        rows.set(body.article.id, row)
        versions.set(`${row.article.id}:${version}`, structuredClone(row))
        return response(row)
      }
      const status = new URL(url).searchParams.get("status") || "ACTIVE"
      const values = [...rows.values()]
        .filter((row) => row.status === status)
        .map(({ raw, ...row }) => row)
      return response({
        articles: values.slice((page - 1) * pageSize, page * pageSize),
        total: values.length,
        page,
        pageSize,
      })
    }
    const historical = /^articles\/([^/]+)\/versions(?:\/(\d+)(?:\/(restore))?)?$/.exec(route)
    if (historical) {
      const [_, id, oldVersion, restoring] = historical
      if (!oldVersion)
        return response({
          id,
          version: rows.get(id).version,
          versions: [...versions.values()]
            .filter((row) => row.article.id === id)
            .map((row) => ({
              version: row.version,
              bytes: Buffer.byteLength(row.raw),
              savedAt: new Date().toISOString(),
            })),
        })
      const old = versions.get(`${id}:${oldVersion}`)
      if (!old) return response({ error: "expired history" }, 404)
      if (!restoring) return response(old)
      const current = rows.get(id)
      if (body.version !== current.version) return response({ error: "version conflict" }, 409)
      const restored = {
        ...structuredClone(old),
        version: current.version + 1,
        sha: `pv:${current.version + 1}`,
        status: "ACTIVE",
      }
      rows.set(id, restored)
      versions.set(`${id}:${restored.version}`, structuredClone(restored))
      return response(restored)
    }
    const note = /^articles\/([^/]+)(?:\/(delete|restore|purge))?$/.exec(route)
    if (note) {
      const row = rows.get(note[1])
      if (!row) return response({ error: "missing" }, 404)
      if (note[2]) {
        if (body.version !== row.version) return response({ error: "version conflict" }, 409)
        if (note[2] === "purge") {
          if (row.status !== "TRASH") return response({ error: "not trashed" }, 409)
          rows.delete(note[1])
          return response({ id: note[1], purged: true })
        }
        row.version++
        row.sha = `pv:${row.version}`
        row.status = note[2] === "delete" ? "TRASH" : "ACTIVE"
        row.deletedAt = new Date().toISOString()
      }
      return response(row)
    }
    if (route === "files") {
      files.set(body.file.id, body.file)
      return response({
        file: { ...body.file, url: `/api/content/personal/files/${body.file.id}`, complete: false },
      })
    }
    if (route.startsWith("files/")) {
      if (options.method === "PUT") {
        files.get(route.slice(6)).bytes = body
        return response({ complete: true })
      }
      return new Response(files.get(route.slice(6)).bytes)
    }
    return response({ error: `unhandled ${route}` }, 404)
  }
  const client = new PersonalLibrary("test-token", fetcher, {
    git,
    apiBase: "https://notes.test/api/content",
    siteBase: "https://notes.test/howard-notes/",
    tokenExpiresAt: Date.now() + 3600000,
  })
  return { client, git, rows, calls, jobs, files, publicArticle, publicSnapshot }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => (resolve = done))
  return { promise, resolve }
}
test("settings first-use reads no owner lists and leaves personal metadata explicitly pending", async () => {
  const { client, git, calls } = fixture()
  git.snapshot = () => assert.fail("settings must not fetch a complete library")
  const opened = await client.settingsSnapshot()
  assert.equal(opened.settingsOnly, true)
  assert.equal(opened.tree, null)
  assert.equal(opened.privateArticles.size, 0)
  assert.equal(client.personalReady, false)
  assert.deepEqual(calls, [])
  assert.equal(client.currentSnapshot, opened)
})
test("personal initialization shares one pending read, preserves private entries and leaves later refreshes fresh", async () => {
  const { client, git, calls, rows, publicSnapshot } = fixture(),
    gate = deferred()
  rows.set("private", {
    article: article("private"),
    raw: "私密原文",
    version: 2,
    sha: "pv:2",
    status: "ACTIVE",
  })
  client.privateCache.set("private", { version: 1, raw: "旧原文" })
  await client.settingsSnapshot()
  let fullReads = 0
  git.snapshot = async () => {
    fullReads++
    await gate.promise
    return publicSnapshot
  }
  const first = client.ensureSnapshot(),
    parallel = client.ensureSnapshot()
  assert.equal(first, parallel)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fullReads, 1)
  assert.equal(calls.length, 3)
  assert.equal(client.personalReady, false)
  gate.resolve()
  const loaded = await first
  assert.equal(client.personalReady, true)
  assert.equal(loaded.publicSnapshot, publicSnapshot)
  assert.equal(loaded.privateArticles.get("private").version, 2)
  assert.equal(loaded.entries.get("library/notes/private.md").sha, "pv:2")
  assert.equal(client.privateCache.has("private"), false)
  assert.equal(await client.ensureSnapshot(), loaded)
  assert.equal(fullReads, 1)
  assert.equal(calls.length, 3)
  await client.snapshot()
  assert.equal(fullReads, 2)
  assert.equal(calls.length, 6)
})
test("failed personal initialization preserves settings and retries instead of caching its error", async () => {
  const { client, git, publicSnapshot } = fixture(),
    opened = await client.settingsSnapshot()
  let reads = 0
  git.snapshot = async () => {
    if (++reads === 1) throw new Error("temporary read failure")
    return publicSnapshot
  }
  const first = client.ensureSnapshot()
  assert.equal(client.ensureSnapshot(), first)
  await assert.rejects(first, /temporary read failure/)
  assert.equal(client.currentSnapshot, opened)
  assert.equal(client.personalReady, false)
  assert.equal(client.snapshotPromise, null)
  assert.equal((await client.ensureSnapshot()).publicSnapshot, publicSnapshot)
  assert.equal(client.personalReady, true)
  assert.equal(reads, 2)
})
test("late personal or settings reads cannot restore data after their token is cleared or changed", async () => {
  for (const token of ["", "new-token"]) {
    const { client, git, publicSnapshot } = fixture(),
      opened = await client.settingsSnapshot(),
      gate = deferred()
    git.snapshot = async () => {
      await gate.promise
      return publicSnapshot
    }
    const pending = client.ensureSnapshot()
    client.token = token
    gate.resolve()
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(client.currentSnapshot, opened)
    assert.equal(client.personalReady, false)
    assert.deepEqual(client.recoveries, [])
    assert.deepEqual(client.jobs, [])
  }
  const { client, git, publicSnapshot } = fixture(),
    gate = deferred()
  git.settingsSnapshot = async () => {
    await gate.promise
    return publicSnapshot
  }
  const pending = client.settingsSnapshot()
  client.token = ""
  gate.resolve()
  await assert.rejects(pending, { name: "AbortError" })
  assert.equal(client.currentSnapshot, undefined)
  assert.equal(client.personalReady, false)
})
test("a successful settings save during personal initialization keeps its newer public baseline", async () => {
  const { client, git, rows, publicSnapshot } = fixture(),
    gate = deferred()
  await client.settingsSnapshot()
  rows.set("private", {
    article: article("private"),
    raw: "私密原文",
    version: 1,
    sha: "pv:1",
    status: "ACTIVE",
  })
  git.snapshot = async () => {
    await gate.promise
    return publicSnapshot
  }
  const pending = client.ensureSnapshot(),
    savedPublic = {
      ...publicSnapshot,
      commit: "accepted-settings-commit",
      tree: "complete-settings-tree",
      siteSha: "accepted-settings-sha",
      settings: { changed: true },
    }
  git.saveSettings = async () => ({ sha: savedPublic.commit, snapshot: savedPublic })
  const saved = await client.saveSettings({ openedSha: "settings-baseline", settings: {} })
  assert.equal(saved.snapshot.publicSnapshot, savedPublic)
  assert.equal(client.personalReady, false)
  assert.equal(saved.snapshot.settingsOnly, undefined)
  assert.equal(client.currentSnapshot.privateArticles.size, 0)
  gate.resolve()
  const loaded = await pending
  assert.equal(loaded.publicSnapshot, savedPublic)
  assert.deepEqual(loaded.settings, { changed: true })
  assert.equal(loaded.siteSha, savedPublic.siteSha)
  assert.equal(loaded.privateArticles.get("private").version, 1)
  assert.equal(client.personalReady, true)
})
test("an ordinary refresh remains fresh even after settings and owner initialization succeeded", async () => {
  const { client, git, publicSnapshot } = fixture()
  await client.settingsSnapshot()
  await client.ensureSnapshot()
  const nextPublic = { ...publicSnapshot, commit: "new-external-commit", settings: { next: true } }
  git.snapshot = async () => nextPublic
  assert.equal((await client.snapshot()).publicSnapshot, nextPublic)
  assert.equal(client.personalReady, true)
})

test("parallel private lists discover the runtime endpoint once without caching authenticated requests", async () => {
  const { git, publicSnapshot } = fixture()
  const configCalls = [],
    personalCalls = []
  let releaseConfig
  const configReady = new Promise((resolve) => {
    releaseConfig = resolve
  })
  const client = new PersonalLibrary(
    "test-token",
    async (url, options) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith("runtime-config.json")) {
        configCalls.push({ url: parsed.href, options })
        await configReady
        return Response.json({ enabled: true, apiBase: "https://notes.test/api/content/" })
      }
      personalCalls.push({ url: parsed.href, options })
      const route = parsed.pathname.split("/personal/")[1]
      if (route === "jobs") return Response.json({ jobs: [] })
      return Response.json({
        [route]: [],
        total: 0,
        page: Number(parsed.searchParams.get("page")),
        pageSize: Number(parsed.searchParams.get("pageSize")),
      })
    },
    { git, siteBase: "https://notes.test/howard-notes/", tokenExpiresAt: 123456789 },
  )
  const snapshot = client.snapshot()
  assert.deepEqual(configCalls, [
    {
      url: "https://notes.test/howard-notes/runtime-config.json",
      options: { cache: "no-store", credentials: "omit" },
    },
  ])
  assert.equal(personalCalls.length, 0)
  releaseConfig()
  assert.equal((await snapshot).publicSnapshot, publicSnapshot)
  assert.equal(personalCalls.length, 3)
  assert.equal(await client.endpoint(), "https://notes.test/api/content")
  assert.equal(configCalls.length, 1)
  client.token = "refreshed-token"
  await client.personalRequest("jobs")
  assert.equal(personalCalls.length, 4)
  assert.equal(personalCalls[3].options.headers.Authorization, "Bearer refreshed-token")
  assert.equal(personalCalls[3].options.cache, "no-store")
  assert.equal(client.tokenExpiresAt, 123456789)
})

test("an explicit API endpoint needs no runtime configuration request", async () => {
  const client = new PersonalLibrary("test-token", () => assert.fail("unexpected config request"), {
    git: { token: "test-token" },
    apiBase: "https://notes.test/api/content",
    siteBase: "https://notes.test/howard-notes/",
  })
  assert.deepEqual(await Promise.all([client.endpoint(), client.endpoint()]), [
    "https://notes.test/api/content",
    "https://notes.test/api/content",
  ])
})

test("endpoint discovery remains isolated between clients and site origins", async () => {
  const calls = []
  const fetcher = async (url) => {
    calls.push(new URL(url).origin)
    return Response.json({ enabled: true, apiBase: "/api/content" })
  }
  const clients = ["https://notes.test/", "https://other-notes.test/"].map(
    (siteBase) =>
      new PersonalLibrary("test-token", fetcher, { git: { token: "test-token" }, siteBase }),
  )
  assert.deepEqual(
    await Promise.all(clients.flatMap((client) => [client.endpoint(), client.endpoint()])),
    [
      "https://notes.test/api/content",
      "https://notes.test/api/content",
      "https://other-notes.test/api/content",
      "https://other-notes.test/api/content",
    ],
  )
  assert.deepEqual(calls, ["https://notes.test", "https://other-notes.test"])
})

test("failed endpoint discovery is shared only in flight and allows a later retry", async (t) => {
  const cases = [
    { name: "network unavailable", failure: new Error("offline"), error: /offline/ },
    {
      name: "content service disabled",
      config: { enabled: false, apiBase: "/api/content" },
      error: /需要内容服务/,
    },
    {
      name: "configuration unavailable",
      config: { enabled: true, apiBase: "/api/content" },
      status: 503,
      error: /需要内容服务/,
    },
    ...[
      "http://other-notes.test/api/content",
      "https://user:password@other-notes.test/api/content",
      "https://other-notes.test/api/content?redirect=1",
      "https://other-notes.test/api/content#fragment",
      "https://other-notes.test/unrelated",
    ].map((apiBase) => ({
      name: `rejected URL: ${apiBase}`,
      config: { enabled: true, apiBase },
      error: /服务地址不正确/,
    })),
  ]
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let calls = 0
      const client = new PersonalLibrary(
        "test-token",
        async (url, options) => {
          assert.equal(new URL(url).href, "https://notes.test/howard-notes/runtime-config.json")
          assert.deepEqual(options, { cache: "no-store", credentials: "omit" })
          if (++calls === 1) {
            if (scenario.failure) throw scenario.failure
            return Response.json(scenario.config, { status: scenario.status || 200 })
          }
          return Response.json({ enabled: true, apiBase: "/api/content/" })
        },
        { git: { token: "test-token" }, siteBase: "https://notes.test/howard-notes/" },
      )
      const results = await Promise.allSettled([
        client.endpoint(),
        client.endpoint(),
        client.endpoint(),
      ])
      assert.equal(calls, 1)
      for (const result of results) {
        assert.equal(result.status, "rejected")
        assert.match(result.reason.message, scenario.error)
      }
      assert.equal(client.apiBase, null)
      assert.equal(client.endpointPromise, null)
      assert.deepEqual(await Promise.all([client.endpoint(), client.endpoint()]), [
        "https://notes.test/api/content",
        "https://notes.test/api/content",
      ])
      assert.equal(calls, 2)
      assert.equal(client.endpointPromise, null)
    })
  }
})

test("private originals retain exact bytes and never enter the public snapshot", async () => {
  const { client, rows, publicSnapshot, calls } = fixture()
  await client.snapshot()
  const raw = "\uFEFF私密原文\r\n<script>keep source, sanitize only rendering</script>\r\n"
  const saved = await client.save({
    opened: null,
    openedSha: null,
    edited: article("private"),
    text: raw,
  })
  assert.equal(saved.private, true)
  assert.equal(rows.get("private").raw, raw)
  assert.equal(saved.snapshot.catalog.articles.length, 2)
  assert.equal(saved.snapshot.publicSnapshot, publicSnapshot)
  assert.deepEqual(
    saved.snapshot.publicSnapshot.catalog.articles.map((a) => a.id),
    ["public"],
  )
  assert.equal(saved.snapshot.entries.get("library/notes/private.md").sha, "pv:1")
  assert.equal(saved.snapshot.catalog.articles[1].storage, undefined)
  assert.equal((await client.read(saved.snapshot.catalog.articles[1], saved.snapshot)).text, raw)
  assert.equal(
    calls.find((call) => call.route === "articles" && call.options.method === "POST").options
      .headers.Authorization,
    "Bearer test-token",
  )
})

test("publishing an edited public article saves an independent D1 draft and its original baseline", async () => {
  const { client, jobs, rows, publicArticle } = fixture()
  await client.snapshot()
  const result = await client.save({
    opened: publicArticle,
    openedSha: "public-sha",
    edited: { ...publicArticle, title: "changed" },
    text: "修改\r\n",
  })
  assert.equal(result.pending, true)
  assert.notEqual(result.privateId, publicArticle.id)
  assert.equal(result.articleId, publicArticle.id)
  assert.equal(rows.get(result.privateId).raw, "修改\r\n")
  assert.equal(jobs[0].input.kind, "publish-private")
  assert.deepEqual(jobs[0].input.publicBaseline, { article: publicArticle, sha: "public-sha" })
  assert.equal(jobs[0].input.privateVersion, 1)
  assert.equal(jobs[0].input.tokenExpiresAt, client.tokenExpiresAt)
})

test("changing public visibility preserves current edits and uses the opened public baseline", async () => {
  const { client, jobs, rows, publicArticle } = fixture()
  await client.snapshot()
  await client.save({
    opened: publicArticle,
    openedSha: "public-sha",
    edited: { ...publicArticle, published: false },
    text: "私密后的修改\r\n",
  })
  assert.equal(rows.get("public").raw, "私密后的修改\r\n")
  assert.equal(jobs[0].input.kind, "privatize-public")
  assert.equal(jobs[0].input.publicBaseline.sha, "public-sha")
})

test("a stale private version cannot overwrite an edit made on another device", async () => {
  const { client, rows } = fixture()
  await client.snapshot()
  const opened = article("private"),
    saved = await client.save({ opened: null, openedSha: null, edited: opened, text: "original" })
  rows.get("private").version = 2
  await assert.rejects(client.save({ opened, openedSha: "pv:1", edited: opened, text: "stale" }), {
    status: 409,
  })
  assert.equal(rows.get("private").raw, "original")
  assert.equal(saved.snapshot.publicSnapshot.catalog.articles.length, 1)
})

test("private attachments upload exact binary and require explicit public consent", async () => {
  const { client, files, jobs, rows } = fixture()
  await client.snapshot()
  const file = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" })
  file.name = "image.png"
  const [uploaded] = await client.uploadPrivateImages([file])
  assert.deepEqual([...files.get(uploaded.attachment.fileId).bytes], [1, 2, 3, 4])
  assert.match(uploaded.url, /^https:\/\/notes.test\/api\/content\/personal\/files\//)
  assert.equal(uploaded.attachment.source, uploaded.url)
  const edited = { ...article("with-image", true), attachments: [uploaded.attachment] }
  await assert.rejects(
    client.save({ opened: null, openedSha: null, edited, text: `![x](${uploaded.url})` }),
    /明确同意/,
  )
  assert.equal(rows.get("with-image").article.published, false)
  assert.equal(jobs.length, 0)
  const privateArticle = rows.get("with-image").article
  await client.save({
    opened: privateArticle,
    openedSha: "pv:1",
    edited,
    text: `![x](${uploaded.url})`,
    publishAttachments: true,
  })
  assert.equal(jobs[0].input.publishAttachments, true)
  assert.deepEqual(
    [...new Uint8Array(await (await client.readPrivateFile(uploaded.url)).arrayBuffer())],
    [1, 2, 3, 4],
  )
  await assert.rejects(
    client.readPrivateFile("https://evil.test/api/content/personal/files/x"),
    /地址不正确/,
  )
})

test("private deletion and restoration remain version guarded and retain a 30-day recovery", async () => {
  const { client, rows } = fixture()
  await client.snapshot()
  const opened = article("private")
  await client.save({ opened: null, openedSha: null, edited: opened, text: "recover me" })
  const removed = await client.removeDraft({ opened, openedSha: "pv:1" })
  assert.equal(removed.record.private, true)
  assert.equal(rows.get("private").status, "TRASH")
  assert.equal(
    removed.snapshot.catalog.articles.some((a) => a.id === "private"),
    false,
  )
  assert.equal(
    Date.parse(removed.record.expiresAt) - Date.parse(removed.record.deletedAt),
    30 * 86400000,
  )
  await client.restoreTrash(removed.record, removed.snapshot)
  assert.equal(rows.get("private").raw, "recover me")
  assert.equal(rows.get("private").status, "ACTIVE")
  await assert.rejects(client.removeDraft({ opened, openedSha: "pv:1" }), { status: 409 })
})

test("accepted private purges need no follow-up reads and allow another deletion from the same snapshot", async () => {
  const { client, git, rows, calls } = fixture()
  for (const id of ["first", "second", "active"])
    rows.set(id, {
      article: article(id),
      raw: `原文 ${id}`,
      version: 2,
      sha: "pv:2",
      status: id === "active" ? "ACTIVE" : "TRASH",
      deletedAt: new Date().toISOString(),
    })
  const opened = await client.snapshot(),
    fetcher = client.fetcher,
    start = calls.length
  client.privateCache.set("first", structuredClone(rows.get("first")))
  client.privateCache.set("active", structuredClone(rows.get("active")))
  git.snapshot = () => assert.fail("an accepted purge must not refresh Git")
  client.fetcher = async (url, options) => {
    if (options.method === "GET") throw new Error("metadata service unavailable")
    return fetcher(url, options)
  }
  let snapshot = opened
  for (const id of ["first", "second"]) {
    const result = await client.purgeTrash(client.trashRecord(rows.get(id)), snapshot)
    snapshot = result.snapshot
    assert.equal(snapshot, opened)
    assert.equal(rows.has(id), false)
    assert.ok(snapshot.privateArticles.has("active"))
    assert.equal(client.personalReady, true)
  }
  assert.equal(client.privateCache.has("first"), false)
  assert.equal(client.privateCache.has("active"), true)
  const mutations = calls.slice(start)
  assert.deepEqual(
    mutations.map(({ route }) => route),
    ["articles/first/purge", "articles/second/purge"],
  )
  assert.ok(
    mutations.every(({ body }) => body.version === 2 && /^[a-f0-9-]{36}$/.test(body.requestId)),
  )
  assert.notEqual(mutations[0].body.requestId, mutations[1].body.requestId)
})

test("an interrupted purge acknowledgement retries the same version and operation key without a metadata refresh", async () => {
  const { client, git } = fixture(),
    opened = await client.snapshot(),
    mutations = []
  git.snapshot = () => assert.fail("an acknowledged purge must not reload metadata")
  client.fetcher = async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/content/personal/articles/trash/purge")
    assert.equal(options.method, "POST")
    mutations.push(JSON.parse(options.body))
    if (mutations.length === 1) throw new Error("response lost after deletion")
    return Response.json({ id: "trash", purged: true, replayed: true })
  }
  const result = await client.purgeTrash({ private: true, articleId: "trash", version: 7 }, opened)
  assert.equal(result.snapshot, opened)
  assert.equal(mutations.length, 2)
  assert.deepEqual(mutations[0], mutations[1])
  assert.equal(mutations[0].version, 7)
  assert.match(mutations[0].requestId, /^[a-f0-9-]{36}$/)
})

test("accepted cloud recovery purges remove only the named editor and keep partial readiness pending", async () => {
  const { client, git } = fixture(),
    opened = await client.settingsSnapshot(),
    recoveries = [
      { editorId: "article:first", id: "same-original", version: 2 },
      { editorId: "article:second", id: "same-original", version: 3 },
    ],
    calls = []
  client.recoveries = recoveries
  opened.cloudRecoveries = recoveries
  git.snapshot = () => assert.fail("a recovery purge must not fetch the whole library")
  client.personalRequest = async (path, method, body) => {
    calls.push({ path, method, body })
    assert.equal(method, "POST")
    assert.equal(body.version, 2)
    return { editorId: "article:first", purged: true }
  }
  const result = await client.purgeTrash(
    { cloudDraft: true, editorId: "article:first", version: 2 },
    opened,
  )
  assert.deepEqual(client.recoveries, [recoveries[1]])
  assert.deepEqual(result.snapshot.cloudRecoveries, [recoveries[1]])
  assert.equal(result.snapshot.settingsOnly, true)
  assert.equal(result.snapshot.publicSnapshot, opened.publicSnapshot)
  assert.equal(client.personalReady, false)
  assert.equal(calls[0].path, "drafts/article%3Afirst/purge")
  assert.match(calls[0].body.requestId, /^[a-f0-9-]{36}$/)
})

test("accepted Git archive purges carry their exact committed baseline without private or Git rereads", async () => {
  const { client, git, rows, publicSnapshot } = fixture()
  rows.set("active", { article: article("active"), version: 4, sha: "pv:4", status: "ACTIVE" })
  publicSnapshot.entries.set("library/trash/first/source.md", { sha: "first-source" })
  publicSnapshot.entries.set("library/trash/second/source.md", { sha: "second-source" })
  let snapshot = await client.snapshot()
  const recoveries = [{ editorId: "keep-recovery", version: 1 }],
    baselines = []
  client.recoveries = recoveries
  git.snapshot = () => assert.fail("purge acknowledgement must not wait for another Git read")
  client.personalRequest = () =>
    assert.fail("purge acknowledgement must not depend on owner list availability")
  git.purgeTrash = async (record, baseline) => {
    baselines.push(baseline.commit)
    const committed = {
      ...baseline,
      commit: `purged-${record.id}`,
      entries: new Map(baseline.entries),
    }
    committed.entries.delete(`library/trash/${record.id}/source.md`)
    return { sha: committed.commit, snapshot: committed, trashId: record.id }
  }
  for (const id of ["first", "second"]) {
    const result = await client.purgeTrash({ id }, snapshot)
    snapshot = result.snapshot
    assert.equal(result.sha, `purged-${id}`)
    assert.equal(snapshot.publicSnapshot, result.publicSnapshot)
    assert.equal(snapshot.commit, result.sha)
    assert.equal(snapshot.entries.has(`library/trash/${id}/source.md`), false)
    assert.equal(snapshot.privateArticles.get("active").version, 4)
    assert.equal(snapshot.entries.get("library/notes/active.md").sha, "pv:4")
    assert.deepEqual(snapshot.cloudRecoveries, recoveries)
    assert.equal(client.personalReady, true)
  }
  assert.deepEqual(baselines, ["git-commit", "purged-first"])
})

test("rejected purge versions preserve the current snapshot and recovery records", async () => {
  const { client, rows } = fixture()
  rows.set("trash", { article: article("trash"), version: 3, sha: "pv:3", status: "TRASH" })
  const opened = await client.snapshot(),
    cached = { version: 3, raw: "保留缓存" }
  client.privateCache.set("trash", cached)
  await assert.rejects(
    client.purgeTrash({ private: true, articleId: "trash", version: 2 }, opened),
    { status: 409 },
  )
  assert.equal(client.currentSnapshot, opened)
  assert.equal(client.privateCache.get("trash"), cached)
  assert.equal(rows.has("trash"), true)
  const recoveries = [{ editorId: "article:trash", version: 3 }]
  client.recoveries = recoveries
  client.personalRequest = async () => {
    throw Object.assign(new Error("version conflict"), { status: 409 })
  }
  await assert.rejects(
    client.purgeTrash({ cloudDraft: true, editorId: "article:trash", version: 2 }, opened),
    { status: 409 },
  )
  assert.equal(client.recoveries, recoveries)
  assert.equal(client.currentSnapshot, opened)
})

test("late purge acknowledgements cannot update metadata after logout or account change", async () => {
  for (const record of [
    { private: true, articleId: "trash", version: 2 },
    { cloudDraft: true, editorId: "article:trash", version: 2 },
    { id: "git-trash" },
  ]) {
    const { client, git, publicSnapshot } = fixture(),
      opened = await client.snapshot(),
      gate = deferred(),
      recoveries = [{ editorId: "article:trash", version: 2 }],
      cached = { version: 2, raw: "保留缓存" }
    client.recoveries = recoveries
    client.privateCache.set("trash", cached)
    client.personalRequest = async () => {
      await gate.promise
      return { purged: true }
    }
    git.purgeTrash = async () => {
      await gate.promise
      return { snapshot: { ...publicSnapshot, commit: "late-purge" } }
    }
    const pending = client.purgeTrash(record, opened)
    client.token = record.cloudDraft ? "new-token" : ""
    gate.resolve()
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(client.currentSnapshot, opened)
    assert.equal(client.recoveries, recoveries)
    assert.equal(client.privateCache.get("trash"), cached)
  }
})

test("repeated public/private changes reuse archived D1 versions without trusting an obsolete archive SHA", async () => {
  const { client, rows, jobs, publicSnapshot } = fixture()
  publicSnapshot.catalog.articles = []
  publicSnapshot.entries.clear()
  await client.snapshot()
  const initial = article("cycle")
  await client.save({ opened: null, openedSha: null, edited: initial, text: "原文\r\n" })
  await client.save({
    opened: initial,
    openedSha: "pv:1",
    edited: { ...initial, published: true },
    text: "原文\r\n",
  })
  const simulatePublished = (sha) => {
    const row = rows.get("cycle"),
      published = { ...row.article, published: true }
    row.status = "PUBLISHED"
    row.publicLink = { sourceSha: "older-archive-source" }
    publicSnapshot.catalog.articles = [published]
    publicSnapshot.entries.set(`library/${published.file}`, { sha })
    return published
  }
  const firstPublic = simulatePublished("first-public-sha")
  await client.snapshot()
  await client.save({
    opened: firstPublic,
    openedSha: "first-public-sha",
    edited: { ...firstPublic, published: false },
    text: "第一次撤下后的修改\r\n",
  })
  publicSnapshot.catalog.articles = []
  publicSnapshot.entries.clear()
  await client.snapshot()
  const privateNote = structuredClone(rows.get("cycle"))
  await client.save({
    opened: privateNote.article,
    openedSha: privateNote.sha,
    edited: { ...privateNote.article, published: true },
    text: privateNote.raw,
  })
  const secondPublic = simulatePublished("second-public-sha")
  await client.snapshot()
  await client.save({
    opened: secondPublic,
    openedSha: "second-public-sha",
    edited: { ...secondPublic, published: false },
    text: "第二次撤下后的修改\r\n",
  })
  assert.equal(rows.get("cycle").raw, "第二次撤下后的修改\r\n")
  assert.deepEqual(
    jobs.map((job) => job.input.kind),
    ["publish-private", "privatize-public", "publish-private", "privatize-public"],
  )
  assert.equal(jobs.at(-1).input.publicBaseline.sha, "second-public-sha")
})

test("a saved modification draft can make its related public article private without losing either original", async () => {
  const { client, rows, jobs, publicArticle } = fixture()
  await client.snapshot()
  const draft = {
    ...article("draft-edit"),
    draft: true,
    draftOf: publicArticle.id,
    draftBaseline: { article: publicArticle, sha: "public-sha" },
  }
  await client.save({ opened: null, openedSha: null, edited: draft, text: "私密修改稿\r\n" })
  const result = await client.save({
    opened: draft,
    openedSha: "pv:1",
    edited: { ...draft, draft: false },
    text: "撤下时的修改\r\n",
  })
  assert.equal(result.privateId, publicArticle.id)
  assert.equal(rows.get(publicArticle.id).raw, "撤下时的修改\r\n")
  assert.equal(rows.get(publicArticle.id).article.draftOf, undefined)
  assert.equal(rows.get("draft-edit").raw, "私密修改稿\r\n")
  assert.equal(jobs[0].input.kind, "privatize-public")
  assert.equal(jobs[0].input.publicBaseline.sha, "public-sha")
})

test("history previews are read only and explicit restoration creates a guarded new private version", async () => {
  const { client, rows, publicSnapshot } = fixture()
  await client.snapshot()
  const note = article("history"),
    raw = "\uFEFF原始\r\n"
  await client.save({ opened: null, openedSha: null, edited: note, text: raw })
  await client.save({ opened: note, openedSha: "pv:1", edited: note, text: "修改\r\n" })
  const old = await client.articleHistory(note.id, 1)
  assert.equal(old.raw, raw)
  assert.equal(rows.get(note.id).raw, "修改\r\n")
  const restored = await client.restoreArticleVersion({
    opened: note,
    openedSha: "pv:2",
    version: 1,
  })
  assert.equal(restored.note.raw, raw)
  assert.equal(restored.note.sha, "pv:3")
  assert.equal(restored.snapshot.publicSnapshot, publicSnapshot)
  assert.equal(
    publicSnapshot.catalog.articles.some((article) => article.id === note.id),
    false,
  )
  await assert.rejects(
    client.restoreArticleVersion({ opened: note, openedSha: "pv:2", version: 2 }),
    { status: 409 },
  )
  assert.equal(rows.get(note.id).raw, raw)
})
