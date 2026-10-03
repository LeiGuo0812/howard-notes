import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"

export function changeKind(files) {
  if (
    files.length &&
    files.every((file) =>
      /^(?:docs\/|\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\/)|(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|LICENSE)(?:\.[^/]*)?$/i.test(
        file,
      ),
    )
  )
    return "docs"
  if (files.length && files.every((file) => file.startsWith("library/"))) return "content"
  return "code"
}
if (process.argv[1]?.endsWith("ci-change-kind.mjs")) {
  const event = process.env.GITHUB_EVENT_NAME
  let kind = "code"
  if (event === "schedule") kind = "content"
  else if (["push", "pull_request"].includes(event)) {
    const data = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
    const base = event === "pull_request" ? data.pull_request.base.sha : data.before
    if (base && !/^0+$/.test(base)) {
      const files = execFileSync(
        "git",
        ["diff", "--name-only", "-z", `${base}${event === "pull_request" ? "..." : ".."}HEAD`],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean)
      kind = changeKind(files)
    }
  }
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `kind=${kind}\n`)
  console.log(`Build category: ${kind}`)
}
