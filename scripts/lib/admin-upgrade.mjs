// Only runs when a newly loaded, cached HTML page still asks for the old admin.js.
// Existing editor sessions never load this entry and are not interrupted.
export function upgradeAdmin(version) {
  const target = new URL(window.location.href)
  if (target.searchParams.get("app") !== version) {
    target.searchParams.set("app", version)
    // Keep the OAuth return channel, fragment and sessionStorage claim proof intact.
    window.location.replace(target.href)
    return
  }
  // A proxy or edge can still serve old HTML after navigation. Avoid a reload loop.
  const button = document.getElementById("login-button")
  if (button) button.disabled = true
  const status = document.getElementById("status") || document.createElement("p")
  status.hidden = false
  status.textContent = "登录页面仍在更新，请稍后重新加载。 "
  const retry = document.createElement("a")
  target.searchParams.set("reload", String(Date.now()))
  retry.href = target.href
  retry.textContent = "加载最新登录页面"
  status.append(retry)
  if (!status.isConnected) document.body.append(status)
}
