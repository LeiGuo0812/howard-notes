import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"

test("sync initializes exact copies, merges independent edits and preserves files on conflict or build failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "howard-sync-test-"))
  const project = path.join(root, "project"),
    remote = path.join(root, "remote.git")
  const mirror = path.join(root, "obsidian"),
    web = path.join(root, "web")
  const run = (cwd, command, args) =>
    execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
  const git = (cwd, ...args) => run(cwd, "git", args)
  const sync = (...args) => run(project, process.execPath, ["scripts/sync-notes.mjs", ...args])
  const write = async (root, file, text) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), text)
  }
  const read = (root, file) => fs.readFile(path.join(root, file), "utf8")
  const identify = (cwd) => {
    git(cwd, "config", "user.name", "Sync test")
    git(cwd, "config", "user.email", "sync-test@example.invalid")
  }
  try {
    await fs.mkdir(project)
    git(root, "init", "--bare", "--initial-branch=main", remote)
    git(project, "init", "--initial-branch=main")
    identify(project)
    await fs.cp("scripts/lib", path.join(project, "scripts/lib"), { recursive: true })
    await fs.copyFile("scripts/sync-notes.mjs", path.join(project, "scripts/sync-notes.mjs"))
    await fs.symlink(path.resolve("node_modules"), path.join(project, "node_modules"), "dir")
    await write(project, ".gitignore", ".local/\n.sync/\nnode_modules/\n")
    await write(project, ".gitattributes", "library/** -text\n")
    await write(project, ".local/sync-config.json", JSON.stringify({ directory: mirror }))
    await write(
      project,
      "package.json",
      JSON.stringify({
        type: "module",
        scripts: { build: "node scripts/build.mjs", "verify:site": 'node -e "process.exit(0)"' },
      }),
    )
    await write(
      project,
      "scripts/build.mjs",
      "import fs from 'node:fs'; if(fs.existsSync('.local/fail-build')) process.exit(1)\n",
    )
    const articles = ["a", "b"].map((id) => ({
      id,
      file: `notes/${id}.md`,
      title: id,
      category: "测试",
      date: "2026-09-30",
      tags: [],
      published: true,
    }))
    await write(project, "library/catalog.json", JSON.stringify({ version: 2, articles }))
    const siteSettings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
    await write(project, "library/site.json", JSON.stringify(siteSettings))
    await write(project, "library/notes/a.md", "原文 A\r\n")
    await write(project, "library/notes/b.md", "原文 B\r\n")
    git(project, "add", ".")
    git(project, "commit", "-m", "Fixture")
    const expected = "https://github.com/LeiGuo0812/howard-notes.git"
    git(project, "remote", "add", "origin", expected)
    git(project, "config", `url.file://${remote}.insteadOf`, expected)
    git(project, "push", "-u", "origin", "main")
    sync("--init", "--apply")
    assert.equal(await read(mirror, "notes/a.md"), "原文 A\r\n")
    git(root, "clone", remote, web)
    identify(web)
    const webEdit = async (text) => {
      await write(web, "library/notes/b.md", text)
      git(web, "add", "library")
      git(web, "commit", "-m", "Web edit")
      git(web, "push", "origin", "main")
    }
    await write(mirror, "notes/a.md", "本地更新 A\r\n")
    siteSettings.footer = "网页页脚"
    await write(web, "library/site.json", JSON.stringify(siteSettings))
    await webEdit("网页更新 B\r\n")
    sync("--apply")
    assert.equal(await read(mirror, "notes/a.md"), "本地更新 A\r\n")
    assert.equal(await read(mirror, "notes/b.md"), "网页更新 B\r\n")
    assert.equal(git(project, "show", "origin/main:library/notes/a.md"), "本地更新 A\r\n")
    assert.equal(JSON.parse(await read(mirror, "site.json")).footer, "网页页脚")
    siteSettings.home.layout = "split"
    await write(mirror, "site.json", JSON.stringify(siteSettings))
    sync("--apply")
    assert.equal(
      JSON.parse(git(project, "show", "origin/main:library/site.json")).home.layout,
      "split",
    )
    assert.equal(await read(mirror, "notes/a.md"), "本地更新 A\r\n")
    assert.match(sync(), /"changes": \[\]/)
    git(web, "pull", "--ff-only")
    await webEdit("网页冲突 B\r\n")
    await write(mirror, "notes/b.md", "本地冲突 B\r\n")
    const beforeConflict = git(project, "rev-parse", "HEAD")
    assert.throws(() => sync("--apply"), /两端同时修改/)
    assert.equal(git(project, "rev-parse", "HEAD"), beforeConflict)
    assert.equal(await read(mirror, "notes/b.md"), "本地冲突 B\r\n")
    const [conflict] = await fs.readdir(path.join(project, ".sync/conflicts"))
    assert.equal(
      await read(project, `.sync/conflicts/${conflict}/REMOTE/notes/b.md`),
      "网页冲突 B\r\n",
    )
    assert.equal(
      await read(project, `.sync/conflicts/${conflict}/LOCAL/notes/b.md`),
      "本地冲突 B\r\n",
    )
    await write(mirror, "notes/b.md", "网页冲突 B\r\n")
    sync("--apply")
    const baseline = await fs.readFile(path.join(project, ".sync/base/notes/a.md"))
    const previous = await fs.readFile(path.join(project, "library/notes/a.md"))
    await write(mirror, "notes/a.md", "构建失败时也不能丢失的本地编辑\r\n")
    await write(project, ".local/fail-build", "1")
    assert.throws(() => sync("--apply"), /构建或检查失败/)
    assert.deepEqual(await fs.readFile(path.join(project, "library/notes/a.md")), previous)
    assert.deepEqual(await fs.readFile(path.join(project, ".sync/base/notes/a.md")), baseline)
    assert.equal(await read(mirror, "notes/a.md"), "构建失败时也不能丢失的本地编辑\r\n")
    assert.equal(git(project, "status", "--porcelain").trim(), "")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
