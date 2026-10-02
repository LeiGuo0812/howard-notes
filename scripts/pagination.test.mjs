import test from "node:test"
import assert from "node:assert/strict"
import { paginationNumbers, paginationTarget } from "./lib/pagination.mjs"

test("pagination windows keep both ends and current neighbors without duplicates", () => {
  assert.deepEqual(paginationNumbers(1, 1), [1])
  assert.deepEqual(paginationNumbers(1, 9), [1, 2, null, 9])
  assert.deepEqual(paginationNumbers(5, 9), [1, null, 4, 5, 6, null, 9])
  assert.deepEqual(paginationNumbers(9, 9), [1, null, 8, 9])
  assert.deepEqual(paginationNumbers(3, 4), [1, 2, 3, 4])
})

test("page input validates integers and clamps out-of-range jumps", () => {
  for (const value of ["", " ", "2.5", "1e2", "3oops", "Infinity", "9007199254740992"])
    assert.equal(paginationTarget(value, 24), null)
  assert.equal(paginationTarget(" 12 ", 24), 12)
  assert.equal(paginationTarget("-3", 24), 1)
  assert.equal(paginationTarget("0", 24), 1)
  assert.equal(paginationTarget("99", 24), 24)
})

test("empty results and invalid server totals remain on a valid single page", () => {
  for (const total of [0, -1, NaN, Infinity, 1.5]) {
    assert.deepEqual(paginationNumbers(100, total), [1])
    assert.equal(paginationTarget("100", total), 1)
  }
})
