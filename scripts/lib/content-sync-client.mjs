import { chinaDate } from "./activity.mjs"

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 })
}

export function needsDailyRefresh(blogData, now = new Date()) {
  return (
    blogData?.activity?.periods?.find((period) => period.id === "recent")?.asOf !== chinaDate(now)
  )
}

// Always render against the exact revision copied by begin. Each retry starts a
// new session and re-reads its base; partially uploaded pages are never reused.
export async function synchronizeContent({
  request,
  commit,
  prepare,
  updateShell = false,
  now = new Date(),
  attempts = 3,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const live = await request("status")
      const refresh = live.commit === commit && needsDailyRefresh(await request("blogData"), now)
      if (live.commit === commit && !refresh && !updateShell)
        return { ...live, status: "synchronized", unchanged: true }
      const begun = await request("sync/begin", { commit, force: updateShell || refresh })
      if (begun.status === "synchronized") {
        if (begun.commit !== commit) throw conflict("同步确认的 Git 版本不一致。")
        return { ...begun, unchanged: true }
      }
      if (!begun.syncId || !Number.isSafeInteger(begun.revision))
        throw new Error("同步会话不正确。")
      const [previous, shell] = await Promise.all([
        request("snapshot"),
        updateShell ? null : request("shell"),
      ])
      const confirmed = await request("status")
      if (
        previous.revision !== begun.revision - 1 ||
        previous.commit !== begun.currentCommit ||
        confirmed.revision !== previous.revision ||
        confirmed.commit !== previous.commit
      )
        throw conflict("线上内容在同步准备期间已有更新。")
      const prepared = await prepare({ previous, shell, begun, now })
      for (const chunk of prepared.chunks)
        await request("sync/chunk", { syncId: begun.syncId, ...chunk })
      for (const chunk of prepared.metadata)
        await request("sync/chunk", { syncId: begun.syncId, ...chunk })
      const result = await request("sync/finish", { syncId: begun.syncId })
      if (
        result.status !== "synchronized" ||
        result.commit !== commit ||
        result.revision !== begun.revision
      )
        throw new Error("服务器尚未确认同步结果，请重试。")
      return { ...result, ...prepared.summary }
    } catch (error) {
      if (error.status !== 409 || attempt + 1 >= attempts) throw error
      await wait(250 * (attempt + 1))
    }
  }
  throw new Error("同步重试次数已用尽。")
}
