import test from "node:test"
import assert from "node:assert/strict"
import { readPersonalPages } from "./personal-pages.mjs"

test("owner metadata traverses beyond 5000 entries with bounded requests and preserved filters", async () => {
  for (const key of ["articles", "drafts"]) {
    const calls = []
    const result = await readPersonalPages(async (path) => {
      const url = new URL(path, "https://example.test")
      const page = Number(url.searchParams.get("page"))
      const pageSize = Number(url.searchParams.get("pageSize"))
      assert.equal(url.searchParams.has("all"), false)
      assert.equal(url.searchParams.get("status"), "TRASH")
      calls.push(page)
      const total = 5001
      return {
        total,
        page,
        pageSize,
        owner: true,
        [key]: Array.from({ length: Math.min(pageSize, total - (page - 1) * pageSize) }, (_, i) => {
          const id = `item-${(page - 1) * pageSize + i}`
          return key === "articles" ? { article: { id } } : { editorId: id }
        }),
      }
    }, `${key}?all=1&status=TRASH`)
    assert.equal(calls.length, 26)
    assert.equal(result[key].length, 5001)
    assert.equal(result.owner, true)
  }
})

test("changed, malformed or interrupted metadata never looks like a complete catalogue", async () => {
  for (const failure of ["duplicate", "total", "short", "missing-total"]) {
    await assert.rejects(
      readPersonalPages(
        async (path) => {
          const page = Number(new URL(path, "https://example.test").searchParams.get("page"))
          return {
            total:
              failure === "missing-total" ? undefined : failure === "total" && page === 2 ? 4 : 3,
            page,
            pageSize: 2,
            articles:
              page === 1
                ? [{ article: { id: "a" } }, { article: { id: "b" } }]
                : failure === "short"
                  ? []
                  : [{ article: { id: failure === "duplicate" ? "b" : "c" } }],
          }
        },
        "articles",
        { pageSize: 2 },
      ),
      /变化/,
    )
  }
  let current = true,
    calls = 0
  await assert.rejects(
    readPersonalPages(
      async () => {
        calls++
        current = false
        return { drafts: [], total: 0, page: 1, pageSize: 200 }
      },
      "drafts",
      { isCurrent: () => current },
    ),
    { name: "AbortError" },
  )
  assert.equal(calls, 1)
})
