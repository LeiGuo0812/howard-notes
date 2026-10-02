import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd()

try {
  const { values } = parseArgs({
    options: {
      repository: { type: "string" },
      checkout: { type: "string" },
      guide: { type: "string" },
    },
  })
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repository || "") ||
    !values.checkout ||
    !values.guide
  )
    throw new Error("Use repository, checkout and guide paths.")
  const checkout = path.resolve(values.checkout)
  const metadata = JSON.parse(run("gh", ["api", `repos/${values.repository}`]))
  if (metadata.private !== true || metadata.full_name !== values.repository)
    throw new Error("A matching private repository is required.")
  const remote = run("git", ["remote", "get-url", "origin"], checkout)
  if (remote !== `https://github.com/${values.repository}.git`)
    throw new Error("Checkout origin does not match the private repository.")
  const target = "handoff/笔记网站搭建与Codex复用指南.md"
  const status = run("git", ["-c", "core.quotepath=false", "status", "--porcelain"], checkout)
  if (status && status.split("\n").some((line) => line.slice(3) !== target))
    throw new Error("Checkout contains unrelated changes.")
  run("git", ["fetch", "origin", "main"], checkout)
  run("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], checkout)
  const stat = await fs.stat(values.guide)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Invalid guide file.")
  const guide = await fs.readFile(values.guide, "utf8")
  if (
    /\/mnt\/[a-z]\//i.test(guide) ||
    /\/(?:home|Users)\/[^\s<>/]+\//.test(guide) ||
    /\b[A-Z]:[\\/]/.test(guide) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(guide) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(guide)
  )
    throw new Error("Guide contains machine-specific paths or credentials.")
  await fs.mkdir(path.dirname(path.join(checkout, target)), { recursive: true })
  await fs.writeFile(path.join(checkout, target), guide)
  const changes = run("git", ["-c", "core.quotepath=false", "status", "--porcelain"], checkout)
  if (!changes) {
    console.log(JSON.stringify({ private: true, updated: false }))
  } else {
    run("git", ["add", "--", target], checkout)
    const staged = run(
      "git",
      ["-c", "core.quotepath=false", "diff", "--cached", "--name-only"],
      checkout,
    )
    if (staged !== target) throw new Error("Refusing to commit unrelated files.")
    run("git", ["commit", "-m", "Update maintenance reproduction guide"], checkout)
    run("git", ["push", "origin", "HEAD:main"], checkout)
    console.log(JSON.stringify({ private: true, updated: true }))
  }
} catch {
  console.error(
    "Private handoff synchronization did not complete. Check owner login, matching private checkout, clean files and generic guide paths. Existing commits were not overwritten.",
  )
  process.exitCode = 1
}
