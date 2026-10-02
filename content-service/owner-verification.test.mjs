import test from "node:test"
import assert from "node:assert/strict"
import { createOwnerVerificationCache } from "./owner-verification.mjs"

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test("concurrent permission checks coalesce while unrelated keys remain independent", async () => {
  const cache = createOwnerVerificationCache()
  const gate = deferred()
  let checks = 0
  const verify = () => {
    checks++
    return gate.promise
  }
  const requests = Array.from({ length: 20 }, () => cache("owner:repo:digest", verify, 60_000))
  await cache("other-owner:repo:digest", () => checks++, 60_000)
  assert.equal(checks, 2)
  gate.resolve()
  await Promise.all(requests)
  await cache("owner:repo:digest", verify, 60_000)
  assert.equal(checks, 2)
})

test("only successful completion starts the TTL, with an exact expiry boundary", async () => {
  let now = 1_000
  const cache = createOwnerVerificationCache({ now: () => now })
  const gate = deferred()
  let checks = 0
  const pending = cache(
    "digest",
    () => {
      checks++
      return gate.promise
    },
    1_000,
  )
  await Promise.resolve()
  now = 10_000
  await cache("independent", () => {}, 1_000)
  gate.resolve()
  await pending
  now = 10_999
  await cache("digest", () => checks++, 1_000)
  assert.equal(checks, 1)
  now = 11_000
  await cache("digest", () => checks++, 1_000)
  assert.equal(checks, 2)
})

test("a rejected shared check is never cached and the next check can succeed", async () => {
  const cache = createOwnerVerificationCache()
  const gate = deferred()
  const denied = new Error("fixture permission denied")
  let checks = 0
  const requests = Array.from({ length: 8 }, () =>
    cache(
      "digest",
      () => {
        checks++
        return gate.promise
      },
      60_000,
    ),
  )
  const settled = Promise.allSettled(requests)
  await Promise.resolve()
  assert.equal(checks, 1)
  gate.reject(denied)
  for (const result of await settled) {
    assert.equal(result.status, "rejected")
    assert.equal(result.reason, denied)
  }
  await cache("digest", () => checks++, 60_000)
  await cache("digest", () => checks++, 60_000)
  assert.equal(checks, 2)
})

test("a synchronous verification exception is not cached", async () => {
  const cache = createOwnerVerificationCache()
  let checks = 0
  const verify = () => {
    checks++
    throw new Error("fixture synchronous failure")
  }
  await assert.rejects(cache("digest", verify, 60_000), /synchronous failure/)
  await assert.rejects(cache("digest", verify, 60_000), /synchronous failure/)
  assert.equal(checks, 2)
})

test("cache lifetime is capped at 60 seconds even if configured longer", async () => {
  let now = 100
  const cache = createOwnerVerificationCache({ now: () => now })
  let checks = 0
  await cache("digest", () => checks++, 3_600_000)
  now = 60_099
  await cache("digest", () => checks++, 3_600_000)
  assert.equal(checks, 1)
  now = 60_100
  await cache("digest", () => checks++, 3_600_000)
  assert.equal(checks, 2)
})

test("disabled or invalid TTL performs a fresh verification even if the key was cached", async () => {
  const cache = createOwnerVerificationCache()
  let checks = 0
  await cache("digest", () => checks++, 60_000)
  for (const ttl of [0, -1, NaN, undefined]) await cache("digest", () => checks++, ttl)
  assert.equal(checks, 5)
  await cache("digest", () => checks++, 60_000)
  assert.equal(checks, 5)
})

test("the default 128-entry bound evicts old keys without evicting recent successful entries", async () => {
  const cache = createOwnerVerificationCache()
  let checks = 0
  for (let index = 0; index < 128; index++) await cache(`digest-${index}`, () => checks++, 60_000)
  await cache("digest-0", () => checks++, 60_000)
  assert.equal(checks, 128)
  await cache("digest-128", () => checks++, 60_000)
  await cache("digest-127", () => checks++, 60_000)
  assert.equal(checks, 129)
  await cache("digest-0", () => checks++, 60_000)
  assert.equal(checks, 130)
  await cache("digest-128", () => checks++, 60_000)
  assert.equal(checks, 130)
})

test("a stale evicted failure cannot erase a newer pending check for the same key", async () => {
  const cache = createOwnerVerificationCache({ maxEntries: 1 })
  const oldGate = deferred(),
    newGate = deferred()
  let checks = 0
  const oldCheck = cache(
    "digest",
    () => {
      checks++
      return oldGate.promise
    },
    60_000,
  )
  const oldResult = assert.rejects(oldCheck, /old failure/)
  await cache("another-digest", () => checks++, 60_000)
  const newCheck = cache(
    "digest",
    () => {
      checks++
      return newGate.promise
    },
    60_000,
  )
  await Promise.resolve()
  assert.equal(checks, 3)
  oldGate.reject(new Error("old failure"))
  await oldResult
  const joined = cache("digest", () => checks++, 60_000)
  newGate.resolve()
  await Promise.all([newCheck, joined])
  assert.equal(checks, 3)
})
