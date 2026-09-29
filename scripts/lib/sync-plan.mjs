import { hash } from "./library.mjs"

const digest = (map, file) => (map.has(file) ? hash(map.get(file)) : null)
export function planSync(base, local, remote, { allowDelete = false } = {}) {
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
    if (b && (!l || !r) && l !== r && !allowDelete) {
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
