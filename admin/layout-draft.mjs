import { validateSite } from "../scripts/lib/site-settings.mjs"
const KEY = "howard-notes:layout-draft:v1"
export function readLayoutDraft(storage) {
  try {
    const raw = storage.getItem(KEY)
    if (!raw || raw.length > 200000) return null
    const value = JSON.parse(raw)
    if (value.version !== 1 || typeof value.openedSha !== "string") return null
    validateSite(value.settings)
    return value
  } catch {
    return null
  }
}
export function writeLayoutDraft(storage, openedSha, settings) {
  storage.setItem(
    KEY,
    JSON.stringify({ version: 1, openedSha, settings, savedAt: new Date().toISOString() }),
  )
}
export function clearLayoutDraft(storage) {
  storage.removeItem(KEY)
}
