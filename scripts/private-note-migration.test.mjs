import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { privateMigrationNotes, byteHash } from "./lib/private-note-migration.mjs"
import { contentEndpoint, ownerRequest } from "./lib/owner-token.mjs"
import { personalNotesResponse } from "../content-service/personal-notes.mjs"

const original = Buffer.from(
  "\uFEFF---\r\ncreated: 2022-07-02\r\nmodified: 2025-08-31\r\ntags: [中文, 技术]\r\n---\r\n# 标题\r\n\r\n原文 **保持** `code`。 #额外标签\r\n",
  "utf8",
)
const project = new URL("../", import.meta.url).pathname
async function vaultFixture(files) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "private-migration-"))
  const vault = path.join(directory, "vault")
  await fs.mkdir(vault, { mode: 0o700 })
  const notes = []
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(vault, file)
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
    await fs.writeFile(target, bytes)
    notes.push({ path: file, state: "未上传", category: "个人库", sha256: byteHash(bytes) })
  }
  return {
    directory,
    vault,
    inventory: { notes },
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  }
}
function apiFixture() {
  const sqlite = new DatabaseSync(":memory:")
  for (const schema of ["memories-schema.sql", "personal-notes-schema.sql", "backups-schema.sql"])
    sqlite.exec(
      fsSync.readFileSync(new URL(`../content-service/${schema}`, import.meta.url), "utf8"),
    )
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
        async all() {
          return { results: statement.all(...values) }
        },
        async run() {
          return { meta: { changes: statement.run(...values).changes } }
        },
      }
    },
    async batch(statements) {
      sqlite.exec("BEGIN")
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  }
  const calls = []
  const api = contentEndpoint("https://notes.example/howard-notes/")
  const env = { DB, SITE_PREFIX: "/howard-notes/", FALLBACK_ORIGIN: "https://backup.example" }
  const authorize = async (request) => {
    assert.equal(request.headers.get("Authorization"), "Bearer fixture-owner")
    return "fixture-owner"
  }
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), method: options.method })
    const request = new Request(url, options)
    return personalNotesResponse(
      request,
      env,
      DB,
      new URL(url).pathname.slice("/howard-notes/api/content/".length),
      authorize,
    )
  }
  const request = ownerRequest(api, "fixture-owner", fetcher)
  return { sqlite, calls, request, fetcher }
}
test("migration preserves BOM, CRLF and every original byte without writing source files", async () => {
  const f = await vaultFixture({ "技术/原文.md": original })
  try {
    const file = path.join(f.vault, "技术/原文.md")
    const before = await fs.stat(file)
    const entries = await privateMigrationNotes(f.vault, f.inventory)
    assert.equal(entries.length, 1)
    assert.deepEqual(Buffer.from(entries[0].raw, "utf8"), original)
    assert.equal(entries[0].sourceHash, byteHash(original))
    assert.equal(entries[0].raw.codePointAt(0), 0xfeff)
    assert.deepEqual(await fs.readFile(file), original)
    assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs)
    assert.equal(entries[0].article.created, "2022-07-02")
    assert.equal(entries[0].article.modified, "2025-08-31")
    assert.equal(entries[0].article.published, false)
    assert.equal(entries[0].article.featured, false)
    assert.deepEqual(entries[0].article.tags, ["中文", "技术", "额外标签"])
    assert.equal(entries[0].metadata.originalPath, "技术/原文.md")
  } finally {
    await f.cleanup()
  }
})
test("different empty-file paths and equal-content originals have distinct stable article identities", async () => {
  const f = await vaultFixture({
    "A/空文件.md": Buffer.alloc(0),
    "B/空文件.md": Buffer.alloc(0),
    "A/同内容.md": original,
    "B/同内容.md": original,
  })
  try {
    const first = await privateMigrationNotes(f.vault, f.inventory)
    const reordered = await privateMigrationNotes(f.vault, {
      notes: [...f.inventory.notes].reverse(),
    })
    assert.equal(new Set(first.map((entry) => entry.article.id)).size, 4)
    assert.equal(first[0].sourceHash, first[1].sourceHash)
    assert.equal(first[2].sourceHash, first[3].sourceHash)
    assert.notEqual(first[0].article.id, first[1].article.id)
    const ids = new Map(first.map((entry) => [entry.metadata.originalPath, entry.article.id]))
    for (const entry of reordered)
      assert.equal(entry.article.id, ids.get(entry.metadata.originalPath))
  } finally {
    await f.cleanup()
  }
})
test("Unicode-equivalent file paths and duplicate inventory rows are rejected before import", async () => {
  const f = await vaultFixture({ "café.md": "one", "cafe\u0301.md": "two" })
  try {
    await assert.rejects(privateMigrationNotes(f.vault, f.inventory), /重复|碰撞|相同|不合法/)
    const single = f.inventory.notes[0]
    await assert.rejects(
      privateMigrationNotes(f.vault, { notes: [single, { ...single }] }),
      /重复|碰撞|相同|不合法/,
    )
  } finally {
    await f.cleanup()
  }
})
test("invalid UTF-8, escaping paths, generated copies and symlinks fail closed", async () => {
  const f = await vaultFixture({
    "valid.md": original,
    "invalid.md": Buffer.from([0xff, 0xfe, 0x00]),
  })
  try {
    await assert.rejects(privateMigrationNotes(f.vault, f.inventory), /UTF|encoded|valid/i)
    const note = f.inventory.notes[0]
    for (const file of [
      "../outside.md",
      "/outside.md",
      "hidden/.private.md",
      "C:\\outside.md",
      "博客发布/copy.md",
    ])
      await assert.rejects(
        privateMigrationNotes(f.vault, { notes: [{ ...note, path: file }] }),
        /路径/,
      )
    await fs.symlink(path.join(f.vault, "valid.md"), path.join(f.vault, "link.md"))
    await assert.rejects(
      privateMigrationNotes(f.vault, { notes: [{ ...note, path: "link.md" }] }),
      /符号链接/,
    )
    await fs.writeFile(path.join(f.directory, "outside.md"), original)
    await fs.symlink(f.directory, path.join(f.vault, "escape"), "dir")
    await assert.rejects(
      privateMigrationNotes(f.vault, { notes: [{ ...note, path: "escape/outside.md" }] }),
      /越出/,
    )
  } finally {
    await f.cleanup()
  }
})
test("only explicitly unuploaded originals enter the private plan", async () => {
  const f = await vaultFixture({
    "private.md": original,
    "public.md": original,
    "known-draft.md": "draft",
  })
  try {
    f.inventory.notes[1].state = "已公开"
    f.inventory.notes[2].state = "仓库中未公开"
    const entries = await privateMigrationNotes(f.vault, f.inventory)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].metadata.originalPath, "private.md")
    assert.equal(entries[0].article.published, false)
  } finally {
    await f.cleanup()
  }
})
test("CLI preflights every original before any remote request, including beyond a trial limit", async () => {
  const f = await vaultFixture({ "first.md": original, "last.md": "inventoried" })
  try {
    const inventory = path.join(f.directory, "inventory.json")
    await fs.writeFile(inventory, JSON.stringify(f.inventory))
    await fs.writeFile(path.join(f.vault, "last.md"), "changed since inventory")
    const calls = path.join(f.directory, "requests.txt")
    const preload = path.join(f.directory, "fetch-preload.mjs")
    await fs.writeFile(
      preload,
      `import fs from 'node:fs'; globalThis.fetch=async()=>{fs.appendFileSync(${JSON.stringify(calls)},'request\\n');return Response.json({})}`,
    )
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/import-private-notes.mjs",
        "--vault",
        f.vault,
        "--inventory",
        inventory,
        "--site",
        "https://notes.example/howard-notes/",
        "--apply",
        "--limit",
        "1",
      ],
      { cwd: project, encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "fixture-owner" } },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /盘点后已有变化/)
    assert.equal(fsSync.existsSync(calls), false)
    assert.deepEqual(await fs.readFile(path.join(f.vault, "first.md")), original)
    assert.equal(
      await fs.readFile(path.join(f.vault, "last.md"), "utf8"),
      "changed since inventory",
    )
  } finally {
    await f.cleanup()
  }
})
test("CLI defaults to a private dry run with no login or fetch and no plaintext in its report", async () => {
  const f = await vaultFixture({ "private.md": original })
  try {
    const inventory = path.join(f.directory, "inventory.json"),
      report = path.join(f.directory, "report.json"),
      calls = path.join(f.directory, "requests.txt"),
      preload = path.join(f.directory, "fetch-preload.mjs")
    await fs.writeFile(inventory, JSON.stringify(f.inventory))
    await fs.writeFile(
      preload,
      `import fs from 'node:fs'; globalThis.fetch=async()=>{fs.appendFileSync(${JSON.stringify(calls)},'request\\n');throw new Error('should never fetch')}`,
    )
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/import-private-notes.mjs",
        "--vault",
        f.vault,
        "--inventory",
        inventory,
        "--report",
        report,
      ],
      { cwd: project, encoding: "utf8" },
    )
    assert.equal(result.status, 0, result.stderr)
    const value = JSON.parse(await fs.readFile(report, "utf8"))
    assert.equal(value.apply, false)
    assert.equal(value.private, true)
    assert.equal(value.notes, 1)
    assert.equal(fsSync.existsSync(calls), false)
    assert.equal(JSON.stringify(value).includes(original.toString("utf8")), false)
    assert.equal(result.stdout.includes("原文 **保持**"), false)
    assert.equal((await fs.stat(report)).mode & 0o777, 0o600)
  } finally {
    await f.cleanup()
  }
})
test("planned originals import byte-exactly as private, retries are idempotent, web edits cannot be overwritten", async () => {
  const f = await vaultFixture({ "private.md": original, "empty.md": Buffer.alloc(0) })
  const api = apiFixture()
  try {
    const entries = await privateMigrationNotes(f.vault, f.inventory)
    for (const entry of entries) {
      const input = {
        article: { ...entry.article, source: entry.metadata },
        raw: entry.raw,
        sourceHash: entry.sourceHash,
        requestId: randomUUID(),
      }
      const imported = await api.request("personal/articles/import", { articles: [input] })
      assert.equal(imported.articles[0].imported, true)
      const saved = await api.request(`personal/articles/${entry.article.id}`)
      assert.equal(saved.storage, "private")
      assert.equal(saved.article.published, false)
      assert.equal(saved.version, 1)
      assert.equal(byteHash(Buffer.from(saved.raw, "utf8")), entry.sourceHash)
      const replay = await api.request("personal/articles/import", {
        articles: [{ ...input, requestId: randomUUID() }],
      })
      assert.equal(replay.articles[0].imported, false)
      assert.equal(replay.articles[0].version, 1)
      assert.equal(
        api.sqlite
          .prepare("SELECT COUNT(*) count FROM personal_article_versions WHERE article_id=?")
          .get(entry.article.id).count,
        1,
      )
      const updated = await api.request(`personal/articles/${entry.article.id}/save`, {
        article: input.article,
        raw: "网页新版本\r\n",
        version: 1,
        requestId: randomUUID(),
      })
      assert.equal(updated.version, 2)
      await assert.rejects(
        api.request("personal/articles/import", {
          articles: [{ ...input, requestId: randomUUID() }],
        }),
        (error) => error.status === 409,
      )
      const latest = await api.request(`personal/articles/${entry.article.id}`)
      assert.equal(latest.raw, "网页新版本\r\n")
      assert.equal(latest.version, 2)
      assert.equal(latest.sourceHash, entry.sourceHash)
    }
    assert.equal(api.sqlite.prepare("SELECT COUNT(*) count FROM personal_articles").get().count, 2)
    assert.equal(
      api.sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'public_%'").get(),
      undefined,
    )
    assert.ok(
      api.calls.every((call) =>
        call.url.startsWith("https://notes.example/howard-notes/api/content/personal/"),
      ),
    )
  } finally {
    api.sqlite.close()
    await f.cleanup()
  }
})
test("owner requests refuse alternate origins and paths outside the fixed content API before sending credentials", async () => {
  const api = contentEndpoint("https://notes.example/howard-notes/")
  const calls = []
  const request = ownerRequest(api, "fixture-owner", async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization })
    return Response.json({ ok: true })
  })
  for (const target of [
    "https://evil.example/collect",
    "//evil.example/collect",
    "../../outside",
    "../session",
  ])
    await assert.rejects(request(target), /origin|路径|同源|来源|API|接口/)
  assert.equal(calls.length, 0)
  await request("personal/articles?page=2")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, api + "personal/articles?page=2")
  assert.equal(calls[0].authorization, "Bearer fixture-owner")
  for (const site of [
    "http://notes.example/",
    "https://name:secret@notes.example/",
    "https://notes.example/?key=value",
    "https://notes.example/#fragment",
  ])
    assert.throws(() => contentEndpoint(site), /HTTPS/)
})

test("authenticated export detects intervening edits across pages and table types", async () => {
  const f = await vaultFixture({ "private.md": original })
  const api = apiFixture()
  try {
    const [entry] = await privateMigrationNotes(f.vault, f.inventory)
    await api.request("personal/articles/import", {
      articles: [{ ...entry, requestId: randomUUID() }],
    })
    const first = await api.request("personal/export?type=articles&page=1")
    assert.ok(Number.isSafeInteger(first.generation))
    assert.equal(first.records[0].raw, original.toString("utf8"))
    const unchanged = await api.request(
      `personal/export?type=files&page=1&generation=${first.generation}`,
    )
    assert.equal(unchanged.generation, first.generation)
    api.sqlite
      .prepare("UPDATE personal_articles SET raw=?,version=version+1 WHERE id=?")
      .run("changed on another device", entry.article.id)
    await assert.rejects(
      api.request(`personal/export?type=articles&page=2&generation=${first.generation}`),
      (error) => error.status === 409,
    )
    await assert.rejects(
      api.request(`personal/export?type=attachments&page=1&generation=${first.generation}`),
      (error) => error.status === 409,
    )
    const latest = await api.request("personal/export?type=articles&page=1")
    assert.ok(latest.generation > first.generation)
    assert.equal(latest.records[0].raw, "changed on another device")
  } finally {
    api.sqlite.close()
    await f.cleanup()
  }
})

test("readable CLI export is byte-exact, owner-only, read-only and never overwrites a prior export", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-export-cli-"))
  try {
    const preload = path.join(directory, "fetch-preload.mjs")
    await fs.writeFile(
      preload,
      `
      const raw=${JSON.stringify(original.toString("utf8"))};
      globalThis.fetch=async(url,options)=>{
        if(options.method!=='GET'||options.redirect!=='error'||options.headers.Authorization!=='Bearer fixture-owner')throw new Error('Invalid readonly owner request');
        const search=new URL(url).searchParams,type=search.get('type'),page=Number(search.get('page'));
        const records=type==='articles'?[{id:'private',article:JSON.stringify({id:'private',file:'notes/private.md',published:false}),raw}]:[];
        return Response.json({generation:17,type,records,page,nextPage:null});
      };
    `,
    )
    const output = path.join(directory, "export")
    const args = [
      "--import",
      preload,
      "scripts/export-personal-notes.mjs",
      "--site",
      "https://notes.example/howard-notes/",
      "--output",
      output,
    ]
    const result = spawnSync(process.execPath, args, {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, GITHUB_TOKEN: "fixture-owner" },
    })
    assert.equal(result.status, 0, result.stderr)
    const markdown = path.join(output, "markdown/notes/private.md")
    assert.deepEqual(await fs.readFile(markdown), original)
    const manifest = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"))
    assert.equal(manifest.consistent, true)
    assert.equal(manifest.generation, 17)
    assert.equal(manifest.private, true)
    assert.equal(manifest.binaryAttachments, "use-encrypted-backup")
    assert.equal((await fs.stat(markdown)).mode & 0o777, 0o600)
    assert.equal((await fs.stat(output)).mode & 0o777, 0o700)
    assert.equal(result.stdout.includes("fixture-owner"), false)
    assert.equal(
      (await fs.readFile(path.join(output, "articles.json"), "utf8")).includes("fixture-owner"),
      false,
    )
    const second = spawnSync(process.execPath, args, {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, GITHUB_TOKEN: "fixture-owner" },
    })
    assert.notEqual(second.status, 0)
    assert.deepEqual(await fs.readFile(markdown), original)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("CLI export refuses both mid-export and final-generation races without a success manifest", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-export-race-"))
  try {
    const preload = path.join(directory, "fetch-preload.mjs")
    await fs.writeFile(
      preload,
      `
      const raw=${JSON.stringify(original.toString("utf8"))};let calls=0;
      globalThis.fetch=async(url,options)=>{
        if(options.method!=='GET')throw new Error('Export must never write');
        calls++;
        const type=new URL(url).searchParams.get('type');
        const records=type==='articles'?[{id:'private',article:JSON.stringify({file:'notes/private.md'}),raw}]:[];
        return Response.json({generation:calls===Number(process.env.CHANGE_AT)?18:17,type,records,page:1,nextPage:null});
      };
    `,
    )
    for (const changeAt of [2, 7]) {
      const output = path.join(directory, `export-${changeAt}`)
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          preload,
          "scripts/export-personal-notes.mjs",
          "--site",
          "https://notes.example/howard-notes/",
          "--output",
          output,
        ],
        {
          cwd: project,
          encoding: "utf8",
          env: { ...process.env, GITHUB_TOKEN: "fixture-owner", CHANGE_AT: String(changeAt) },
        },
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /远端已有修改|远端已有|远端|内容已有|修改/)
      assert.equal(fsSync.existsSync(path.join(output, "manifest.json")), false)
      assert.equal(result.stdout.includes('"readonly":true'), false)
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
