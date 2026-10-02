import { test } from "node:test"
import assert from "node:assert/strict"
import { backupRequest } from "./backup-manager.mjs"

test("backup request never sends credentials to another origin or an arbitrary route", async () => {
  let calls = 0
  const client = {
    token: "fixture",
    siteBase: "https://notes.example/site/",
    endpoint: async () => "https://other.example/site/api/content",
    fetcher: async () => calls++,
  }
  await assert.rejects(backupRequest(client, "status"), /其他地址/)
  await assert.rejects(backupRequest(client, "../session"), /操作不正确/)
  assert.equal(calls, 0)
})

test("backup downloads preserve the binary response, refuse redirects and bypass caches", async () => {
  let actual
  const expected = new Response(new Uint8Array([1, 0, 255]))
  const client = {
    token: "fixture",
    siteBase: "https://notes.example/site/",
    endpoint: async () => "https://notes.example/site/api/content",
    fetcher: async (url, options) => {
      actual = { url, options }
      return expected
    },
  }
  assert.equal(await backupRequest(client, "download"), expected)
  assert.equal(actual.url, "https://notes.example/site/api/content/backups/download")
  assert.equal(actual.options.redirect, "error")
  assert.equal(actual.options.cache, "no-store")
  assert.equal(actual.options.credentials, "same-origin")
})
