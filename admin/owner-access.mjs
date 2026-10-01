// Optional feature bundles reuse the verified owner session through a synchronous
// request/reply bridge. Credentials remain in memory and are never persisted here.
export function requestOwnerAccess() {
  let access = null
  document.dispatchEvent(
    new CustomEvent("howard-owner-access-request", {
      detail: {
        reply(value) {
          access = value
        },
      },
    }),
  )
  return access
}
