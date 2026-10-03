import fs from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import YAML from "yaml"
import { readLibrary } from "../scripts/lib/library.mjs"
import { prepareProjection } from "../runtime/projection.mjs"
import { extractShell, renderPages } from "../quartz/runtime/render"
import { publicationChunks } from "../admin/runtime-publish.mjs"
import { synchronizeContent } from "./lib/content-sync-client.mjs"

const args = process.argv.slice(2)
const seedFile = args.includes("--seed-sql") ? args[args.indexOf("--seed-sql") + 1] : null
const config = JSON.parse(await fs.readFile("runtime/config.json", "utf8"))
const api = process.env.CONTENT_API || config.apiBase
const siteOrigin = new URL(api).origin
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
async function localGitHubToken() {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    // Older gh versions expose credentials only through their own local config.
    // Reuse the existing login in memory; never print or copy its secret to the repo.
    const directory =
      process.env.GH_CONFIG_DIR ||
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "gh")
    const data = YAML.parse(await fs.readFile(path.join(directory, "hosts.yml"), "utf8"))
    const host = data?.["github.com"]
    const accounts = Array.isArray(host) ? host : [host, ...Object.values(host?.users || {})]
    const token = accounts.find((value: any) => typeof value?.oauth_token === "string")?.oauth_token
    if (!token) throw new Error("请先使用 gh auth login 登录。")
    return token
  }
}
const token = seedFile
  ? ""
  : process.env.GITHUB_TOKEN || process.env.GH_TOKEN || (await localGitHubToken())
async function request(path: string, body?: unknown) {
  const response = await fetch(`${api}/${path}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    redirect: "error",
    headers: body
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(process.env.CONTENT_SYNC_KEY
            ? { "X-Howard-Sync-Key": process.env.CONTENT_SYNC_KEY }
            : {}),
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  })
  const data = (await response.json()) as any
  if (!response.ok)
    throw Object.assign(new Error(`内容同步失败 (${response.status}): ${data.error || "请重试"}`), {
      status: response.status,
    })
  return data
}
const { catalog, sources } = await readLibrary("library")
const settings = JSON.parse(await fs.readFile("library/site.json", "utf8"))
const entries = new Map(
  execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t")
      return [path, { sha: meta.split(" ")[2] }]
    }),
)
const localShell = async () =>
  extractShell(
    await fs.readFile(
      `public/notes/${catalog.articles.find((a: any) => a.published).id}.html`,
      "utf8",
    ),
    { basePath: "/howard-notes", origin: siteOrigin },
  )
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
if (seedFile) {
  const shell = await localShell()
  const projection = await prepareProjection({
    catalog,
    settings,
    sources,
    commit,
    entries,
    previous: {},
  })
  const pages = renderPages(projection, shell)
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`
  const sql = ["BEGIN TRANSACTION;"]
  for (const doc of projection.documents)
    sql.push(
      `INSERT OR REPLACE INTO public_documents(revision,id,source_sha,body) VALUES(1,${quote(doc.id)},${quote(doc.sourceSha)},${quote(JSON.stringify(doc))});`,
    )
  for (const page of pages)
    sql.push(
      `INSERT OR REPLACE INTO public_pages(revision,path,body,page_hash) VALUES(1,${quote(page.path)},${quote(page.html)},${quote(hash(page.html))});`,
    )
  for (const [name, value] of Object.entries({
    catalog: projection.catalog,
    settings,
    blogData: projection.blogData,
    contentIndex: projection.contentIndex,
    shell,
  }))
    sql.push(
      `INSERT OR REPLACE INTO public_payloads(revision,name,body) VALUES(1,${quote(name)},${quote(JSON.stringify(value))});`,
    )
  sql.push(
    `UPDATE content_state SET revision=1,commit_sha=${quote(commit)},updated_at=${Date.now()} WHERE id=1 AND revision=0;`,
  )
  sql.push("COMMIT;")
  await fs.writeFile(seedFile, sql.join("\n"))
  await fs.mkdir(".local/runtime-site", { recursive: true })
  for (const page of pages) {
    await fs.mkdir(`.local/runtime-site/${page.path.split("/").slice(0, -1).join("/")}`, {
      recursive: true,
    })
    await fs.writeFile(`.local/runtime-site/${page.path}.html`, page.html)
  }
  await fs.writeFile(
    ".local/runtime-projection.json",
    JSON.stringify({ ...projection, shell, pages }),
  )
  console.log(
    `Prepared ${projection.documents.length} public notes and ${pages.length} routes; raw Markdown unchanged.`,
  )
} else {
  const updateShell = args.includes("--update-shell")
  const result = await synchronizeContent({
    request,
    commit,
    updateShell,
    prepare: async ({ previous, shell: deployedShell, begun, now }: any) => {
      const shell = updateShell ? await localShell() : deployedShell
      shell.origin = siteOrigin
      const projection = await prepareProjection({
        catalog,
        settings,
        sources,
        commit,
        entries,
        previous,
        now,
      })
      const pages = renderPages(projection, shell)
      const oldDocs = new Map((previous.documents || []).map((d: any) => [d.id, d]))
      const reusable = new Set(begun.reusableDocuments || [])
      const docs = projection.documents.filter(
        (d: any) => !reusable.has(d.id) || JSON.stringify(oldDocs.get(d.id)) !== JSON.stringify(d),
      )
      const changedPages = pages.filter(
        (page) => previous.pageHashes?.[page.path] !== hash(page.html),
      )
      return {
        chunks: publicationChunks(docs, changedPages),
        metadata: [
          { contentIndex: projection.contentIndex },
          { blogData: projection.blogData },
          ...(updateShell ? [{ shell }] : []),
        ],
        summary: {
          documents: projection.documents.length,
          changedDocuments: docs.length,
          changedPages: changedPages.length,
        },
      }
    },
  })
  console.log(
    result.unchanged
      ? `Already synchronized revision ${result.revision}.`
      : `Synchronized ${result.documents} public notes, ${result.changedDocuments} changed documents and ${result.changedPages} changed pages; revision ${result.revision}.`,
  )
}
