const RUNS = "https://api.github.com/repos/LeiGuo0812/howard-notes/actions/runs"
export function deploymentRun(data, sha) {
  return (
    data?.workflow_runs?.find(
      (run) =>
        run.head_sha === sha && run.path === ".github/workflows/deploy.yml" && run.event === "push",
    ) || null
  )
}
export function trackDeployment(element, sha, fetcher = fetch) {
  if (!/^[a-f0-9]{40}$/i.test(sha)) return () => {}
  let stopped = false,
    timer
  const deadline = Date.now() + 600000
  const controller = new AbortController()
  const show = (text, url = "https://github.com/LeiGuo0812/howard-notes/actions") => {
    element.hidden = false
    element.replaceChildren(document.createTextNode(text + " "))
    const link = document.createElement("a")
    link.textContent = "部署进度 ↗"
    link.href = url
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    element.append(link)
  }
  const poll = async () => {
    if (stopped) return
    try {
      const response = await fetcher(`${RUNS}?head_sha=${sha}&per_page=10`, {
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/vnd.github+json" },
      })
      if (!response.ok) throw new Error()
      const run = deploymentRun(await response.json(), sha)
      if (stopped) return
      if (run?.status === "completed") {
        show(
          run.conclusion === "success" ? "已部署上线" : "已保存至 GitHub，部署未成功",
          run.html_url,
        )
        return
      }
      show(
        run?.status === "in_progress" ? "已保存至 GitHub，正在部署" : "已保存至 GitHub，等待部署",
        run?.html_url,
      )
    } catch {
      if (!stopped) show("已保存至 GitHub，部署状态暂时无法读取")
    }
    if (!stopped && Date.now() < deadline) timer = setTimeout(poll, 20000)
  }
  show("已保存至 GitHub，等待部署")
  void poll()
  return () => {
    stopped = true
    clearTimeout(timer)
    controller.abort()
  }
}
