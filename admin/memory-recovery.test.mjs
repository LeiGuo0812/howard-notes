import test from "node:test"
import assert from "node:assert/strict"
import { memoryRecoveryRecord, validatedMemoryRecovery } from "./memory-recovery.mjs"

test("memory recovery retains the exact original BOM/CRLF and complete old version baseline", () => {
  const memory = {
    id: "memory-123",
    version: 7,
    content: "\uFEFF# 原文\r\n\r\n正文\r\n",
    visibility: "PRIVATE",
    tags: ["原标签"],
    attachments: [{ fileId: "original-file" }],
    created: "2024-07-02",
    modified: "2025-08-31",
  }
  const record = memoryRecoveryRecord(memory, {
    content: memory.content.replaceAll("\r\n", "\n"),
    visibility: "PRIVATE",
    tags: ["编辑标签"],
    pendingTag: "未确认标签",
  })
  assert.equal(record.content, memory.content)
  assert.deepEqual(record.baseline, memory)
  assert.deepEqual(record.tags, ["编辑标签"])
  assert.equal(record.pendingTag, "未确认标签")
  memory.version = 8
  assert.equal(record.baseline.version, 7)
  const edited = memoryRecoveryRecord(record.baseline, {
    content: "\uFEFF# 原文\n\n新增正文\n",
    visibility: "PUBLIC",
    tags: [],
  })
  assert.equal(edited.content, "\uFEFF# 原文\r\n\r\n新增正文\r\n")
  assert.equal(edited.baseline.version, 7)
})

test("new memory recovery preserves stable idempotency key and defaults remain explicit", () => {
  const record = memoryRecoveryRecord(
    null,
    { content: "新记录", visibility: "PRIVATE", tags: ["新标签"] },
    { newRequestId: "new-record-id" },
  )
  assert.equal(record.memoryId, null)
  assert.equal(record.baseline, null)
  assert.equal(record.newRequestId, "new-record-id")
  assert.deepEqual(validatedMemoryRecovery(record), record)
})

test("memory recovery refuses cross-card baseline mismatch instead of rebasing an old edit", () => {
  assert.equal(
    validatedMemoryRecovery({
      kind: "memory",
      content: "编辑",
      visibility: "PRIVATE",
      tags: [],
      memoryId: "memory-one",
      baseline: { id: "memory-other", version: 9, content: "latest" },
    }),
    null,
  )
  assert.equal(
    validatedMemoryRecovery({
      kind: "memory",
      content: "编辑",
      visibility: "PRIVATE",
      tags: [],
      memoryId: "memory-one",
      baseline: { id: "memory-one", version: 0, content: "latest" },
    }),
    null,
  )
})
