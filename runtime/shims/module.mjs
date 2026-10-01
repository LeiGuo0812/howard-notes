export function createRequire() {
  return () => {
    throw new Error("Node-only modules cannot run in the live content compiler.")
  }
}
