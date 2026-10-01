import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { TRASH_PREFIX, trashExpired, trashRecordPath, trashPaths } from "../admin/trash.mjs"

async function walkFiles(directory) {
  const files = []
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name)
    if (item.isSymbolicLink()) throw new Error("回收站内含符号链接，已保留此组记录。")
    if (item.isDirectory()) files.push(...(await walkFiles(file)))
    else if (item.isFile()) files.push(file)
    else throw new Error("回收站内含未知文件类型，已保留此组记录。")
  }
  return files
}

function blobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
}

// The filesystem routine only ever removes validated archive files, never their original
// notes, catalog, shared assets, or any unrelated files found inside an archive directory.
export async function pruneTrashDirectory(repository, { now = Date.now(), write = false } = {}) {
  const directory = path.join(repository, TRASH_PREFIX)
  const result = { removed: [], expired: [], retained: [], warnings: [] }
  let groups
  try {
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("回收站根目录不是普通目录。")
    groups = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return result
    throw error
  }
  for (const group of groups) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(group.name)) {
      result.warnings.push(`保留无法识别的回收站条目：${group.name}`)
      continue
    }
    try {
      if (!group.isDirectory() || group.isSymbolicLink()) throw new Error("不是普通存档目录。")
      const manifestPath = trashRecordPath(group.name)
      const groupDirectory = path.join(repository, TRASH_PREFIX, group.name)
      const files = await walkFiles(groupDirectory)
      const record = JSON.parse(await fs.readFile(path.join(repository, manifestPath), "utf8"))
      if (record.id !== group.name) throw new Error("记录编号与目录不一致。")
      if (!trashExpired(record, now)) {
        result.retained.push(group.name)
        continue
      }
      const expected = trashPaths(record)
      const relative = files.map((file) =>
        path.relative(repository, file).split(path.sep).join("/"),
      )
      if (relative.length !== expected.length || expected.some((file) => !relative.includes(file)))
        throw new Error("记录中存在未声明或缺失文件。")
      for (const item of record.articles)
        if (blobSha(await fs.readFile(path.join(repository, item.sourcePath))) !== item.sha)
          throw new Error("存档正文与保留的 Git blob 不一致。")
      result.expired.push(group.name)
      if (!write) continue
      for (const file of expected) {
        await fs.unlink(path.join(repository, file))
        result.removed.push(file)
      }
      // Git only tracks files. Empty archive directories can disappear on the next checkout.
    } catch (error) {
      result.warnings.push(`保留回收站记录 ${group.name}：${error.message}`)
    }
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await pruneTrashDirectory(process.cwd(), {
    write: process.argv.includes("--write"),
  })
  for (const warning of result.warnings) console.warn(warning)
  console.log(
    `Trash expiry: ${result.expired.length} expired groups, ${result.removed.length} removed files; ${result.retained.length} retained groups.`,
  )
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${result.removed.length > 0}\n`)
}
