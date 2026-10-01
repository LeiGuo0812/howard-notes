import { createWorkspace } from "./workspace.mjs"
import { resumeSignIn, signIn } from "./auth.mjs"
import { mountFrostedSpotlight } from "../scripts/lib/frosted-spotlight.mjs"
import { mountAdminTheme } from "./theme.mjs"

mountAdminTheme(document.getElementById("admin-theme"))
mountFrostedSpotlight(document)
const root = document.body
const status = root.querySelector("#status")
const fail = (error) => {
  status.hidden = false
  status.className = "error"
  status.textContent = error.message || "登录失败，请重新登录。"
}
let connecting = false
const workspace = createWorkspace(root, {
  siteBase: new URL("../", location.href),
  onReauthenticate: async () => {
    if (connecting || workspace.isBusy()) return
    connecting = true
    try {
      status.hidden = false
      status.className = ""
      status.textContent = "等待 GitHub 登录…"
      await workspace.connect(await signIn({ preservePage: !!workspace.getSession() }))
    } catch (error) {
      fail(error)
    } finally {
      connecting = false
    }
  },
})
void resumeSignIn()
  .then((credentials) => workspace.connect(credentials))
  .catch(fail)
