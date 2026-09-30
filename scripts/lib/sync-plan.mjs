import { hash } from "./library.mjs"

const digest = (map, file) => (map.has(file) ? hash(map.get(file)) : null)
export function retiredWebDrafts(base, remote) {
  if (!base.has("catalog.json") || !remote.has("catalog.json")) return new Set()
  const previous = JSON.parse(base.get("catalog.json").toString()).articles
  const current = JSON.parse(remote.get("catalog.json").toString()).articles
  return new Set(
    previous
      .filter(
        (article) =>
          article.published === false &&
          /^notes\/(网页新建|网页草稿)\//.test(article.file) &&
          !current.some((item) => item.id === article.id || item.file === article.file) &&
          !remote.has(article.file),
      )
      .map((article) => article.file),
  )
}

export function planSync(
  base,
  local,
  remote,
  { allowDelete = false, allowDeleteFiles = new Set() } = {},
) {
  const merged = new Map(),
    conflicts = [],
    changes = []
  for (const file of [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort()) {
    const b = digest(base, file),
      l = digest(local, file),
      r = digest(remote, file)
    let selected
    if (l === r) selected = local.get(file)
    else if (l === b) selected = remote.get(file)
    else if (r === b) selected = local.get(file)
    else {
      conflicts.push({ file, reason: "两端同时修改" })
      continue
    }
    if (b && (!l || !r) && l !== r && !allowDelete && !allowDeleteFiles.has(file)) {
      conflicts.push({ file, reason: "检测到删除，需要显式 --allow-delete" })
      continue
    }
    if (selected !== undefined) merged.set(file, selected)
    if (l !== r)
      changes.push({
        file,
        direction: l === b ? "网页 → Obsidian" : "Obsidian → 网页",
        delete: selected === undefined,
      })
  }
  return { merged, conflicts, changes }
}
