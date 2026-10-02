import { editorSourceText } from "./article-recovery.mjs"

export function memoryRecoveryRecord(
  memory,
  form,
  { original = memory?.content || "", newRequestId } = {},
) {
  return {
    kind: "memory",
    memoryId: memory?.id || null,
    baseline: memory ? structuredClone(memory) : null,
    content: editorSourceText(original, form.content),
    visibility: form.visibility,
    tags: [...form.tags],
    pendingTag: form.pendingTag || "",
    newRequestId: newRequestId || null,
  }
}

export function validatedMemoryRecovery(value) {
  if (
    !value ||
    value.kind !== "memory" ||
    typeof value.content !== "string" ||
    !["PRIVATE", "PROTECTED", "PUBLIC"].includes(value.visibility) ||
    !Array.isArray(value.tags) ||
    value.tags.some((tag) => typeof tag !== "string") ||
    (value.pendingTag != null && typeof value.pendingTag !== "string") ||
    (value.memoryId != null &&
      (typeof value.memoryId !== "string" ||
        !value.baseline ||
        value.baseline.id !== value.memoryId ||
        !Number.isSafeInteger(value.baseline.version) ||
        value.baseline.version < 1 ||
        typeof value.baseline.content !== "string"))
  )
    return null
  return structuredClone(value)
}
