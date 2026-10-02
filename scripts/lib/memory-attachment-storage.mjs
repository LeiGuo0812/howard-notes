// Public attachment pointers pin an immutable GitHub commit. Credentials and
// arbitrary external redirect URLs never enter this storage adapter.
export function githubMemoryAttachmentUrl(storage) {
  if (
    storage?.provider !== "github" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(storage.repository || "") ||
    !/^[a-f0-9]{40}$/.test(storage.commit || "") ||
    !/^[a-f0-9]{64}$/.test(storage.sha256 || "") ||
    typeof storage.path !== "string" ||
    !storage.path.startsWith("img/memory/") ||
    storage.path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[a-zA-Z0-9._/-]+$/.test(storage.path) ||
    !["png", "jpg", "zip"].some((extension) =>
      storage.path.endsWith(`/${storage.sha256}.${extension}`),
    )
  )
    return null
  return `https://raw.githubusercontent.com/${storage.repository}/${storage.commit}/${storage.path}`
}
