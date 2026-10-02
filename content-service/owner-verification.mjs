/** A bounded success-only permission cache; keys are token digests, never credentials. */
export function createOwnerVerificationCache({ now = Date.now, maxEntries = 128 } = {}) {
  const entries = new Map()
  return async function verify(key, callback, lifetime = 0) {
    const ttl = Math.max(0, Math.min(60_000, lifetime))
    if (!ttl) return callback()
    const previous = entries.get(key)
    if (previous && (previous.pending || previous.expires > now())) return previous.promise
    const entry = { pending: true, expires: 0 }
    entry.promise = Promise.resolve()
      .then(callback)
      .then(
        () => {
          entry.pending = false
          entry.expires = now() + ttl
        },
        (error) => {
          if (entries.get(key) === entry) entries.delete(key)
          throw error
        },
      )
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    return entry.promise
  }
}
