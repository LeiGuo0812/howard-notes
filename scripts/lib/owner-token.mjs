import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import YAML from "yaml"

// Reuse the local owner login only in memory; never serialize credentials into exports.
export async function ownerToken() {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    const directory =
      process.env.GH_CONFIG_DIR ||
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "gh")
    const configuration = YAML.parse(await fs.readFile(path.join(directory, "hosts.yml"), "utf8"))
    const host = configuration?.["github.com"]
    const token = [host, ...Object.values(host?.users || {})].find(
      (account) => typeof account?.oauth_token === "string",
    )?.oauth_token
    if (!token) throw new Error("请先使用 GitHub CLI 登录维护账号。")
    return token
  }
}
export function contentEndpoint(site) {
  const url = new URL(site.endsWith("/") ? site : site + "/")
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("内容服务需要没有凭据、查询参数或片段的 HTTPS 网站地址。")
  return new URL("api/content/", url).href
}
export function ownerRequest(api, token, fetcher = fetch) {
  const base = new URL(api)
  return async (path, body) => {
    const target = new URL(path, base)
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith(base.pathname) ||
      target.username ||
      target.password ||
      target.hash
    )
      throw new Error("维护请求越出已配置的内容接口，未发送登录凭据。")
    const response = await fetcher(target, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(90000),
    })
    if (!response.ok) {
      const error = new Error(`维护接口请求失败（${response.status}）；未记录凭据或私密正文。`)
      error.status = response.status
      throw error
    }
    return response.json()
  }
}
