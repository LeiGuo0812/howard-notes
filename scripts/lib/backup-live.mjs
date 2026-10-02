/** Drive the owner's bounded backup API; never restart a job while polling. */
export async function captureLiveBackup({
  request,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = Date.now,
  timeout = 15 * 60_000,
  maxSteps = 500,
  interval = 1500,
  onProgress = () => {},
}) {
  const initial = await request("backups/status")
  if (!initial.configured) throw new Error("Encrypted owner backup is not configured.")
  const started = clock()
  const first = await request("backups/run", { action: "start" })
  if (first.status === "disabled") throw new Error("Encrypted owner backup is disabled.")
  let steps = 1
  while (clock() - started < timeout && steps <= maxSteps) {
    await wait(interval)
    const status = await request("backups/status")
    if (status.latest?.id && status.latest.id !== initial.latest?.id && !status.progress)
      return { latest: status.latest, steps }
    if (status.error && status.checkedAt !== initial.checkedAt && !status.progress)
      throw new Error("The backup stopped before completion; previous snapshots remain available.")
    if (status.progress) {
      onProgress({
        step: steps,
        tables: status.progress.copiedTables,
        totalTables: status.progress.totalTables,
        rows: status.progress.rows,
        privateBytes: status.progress.privateBytes || 0,
      })
      await request("backups/run", { action: "continue" })
      steps++
    }
  }
  throw new Error(
    "Bounded backup did not complete in time; keep its saved checkpoint and retry later.",
  )
}
