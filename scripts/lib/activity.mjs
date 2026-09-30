import { execFileSync } from "node:child_process"
import fs from "node:fs"

const dayMs = 86400000
export function chinaDate(date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date)
}
export function buildActivity(timestamps, now = new Date()) {
  const today = chinaDate(now),
    end = Date.parse(today + "T00:00:00Z"),
    start = end - 364 * dayMs
  const counts = new Map()
  for (const timestamp of timestamps) {
    const date = chinaDate(new Date(Number(timestamp) * 1000))
    const instant = Date.parse(date + "T00:00:00Z")
    if (instant >= start && instant <= end) counts.set(date, (counts.get(date) || 0) + 1)
  }
  const first = start - new Date(start).getUTCDay() * dayMs
  const last = end + (6 - new Date(end).getUTCDay()) * dayMs
  const weeks = []
  for (let week = first; week <= last; week += 7 * dayMs) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const instant = week + d * dayMs,
        date = new Date(instant).toISOString().slice(0, 10),
        count = counts.get(date) || 0
      days.push({
        date,
        count,
        inRange: instant >= start && instant <= end,
        level: count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4,
      })
    }
    const firstOfMonth = days.find((day) => day.inRange && day.date.endsWith("-01"))
    weeks.push({ month: firstOfMonth ? `${Number(firstOfMonth.date.slice(5, 7))}月` : "", days })
  }
  return {
    asOf: today,
    from: new Date(start).toISOString().slice(0, 10),
    total: [...counts.values()].reduce((a, b) => a + b, 0),
    weeks,
  }
}
export function readActivity() {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    encoding: "utf8",
  }).trim()
  if (shallow === "true") {
    const shallowFile = execFileSync("git", ["rev-parse", "--git-path", "shallow"], {
      encoding: "utf8",
    }).trim()
    const reachable = new Set(
      execFileSync("git", ["rev-list", "HEAD"], { encoding: "utf8" }).trim().split("\n"),
    )
    if (
      fs
        .readFileSync(shallowFile, "utf8")
        .trim()
        .split("\n")
        .some((commit) => reachable.has(commit))
    )
      throw new Error("提交热图需要完整 Git 历史，请先运行 git fetch --unshallow。")
  }
  const timestamps = execFileSync("git", ["log", "HEAD", "--format=%ct"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .filter(Boolean)
  return buildActivity(timestamps)
}
