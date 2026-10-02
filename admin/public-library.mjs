// Public layout, preview and publication follow Git authority, even while the
// owner's merged library contains private documents shadowing the same IDs.
export function publicLibrarySnapshot(snapshot) {
  const publicSnapshot = snapshot?.publicSnapshot || snapshot
  return publicSnapshot !== snapshot && snapshot.client
    ? { ...publicSnapshot, client: snapshot.client }
    : publicSnapshot
}
