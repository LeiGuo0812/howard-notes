import test from "node:test"
import assert from "node:assert/strict"
import { groupTimelineItems, paginateItems, timelineDateField, timelineMonth } from "./browsing"

test("timeline includes every matching article beyond the twenty-item list page", () => {
  const articles = Array.from({ length: 47 }, (_, id) => ({
    id,
    date: id < 25 ? "2026-10-01" : "2026-09-30",
  }))
  assert.equal(paginateItems(articles, 1).items.length, 20)
  const groups = groupTimelineItems(articles, (article) => article.date)
  assert.deepEqual(
    groups.map((group) => [group.month, group.entries.length]),
    [
      ["2026-10", 25],
      ["2026-09", 22],
    ],
  )
  assert.equal(groups.flatMap((group) => group.entries).length, articles.length)
  assert.equal(paginateItems(articles, 3).items.length, 7)
})

test("month ordering supports both directions across years and keeps missing dates last", () => {
  const dates = ["2025-12-01", undefined, "2026-02-01", "2026-01-01"]
  assert.deepEqual(
    groupTimelineItems(dates, (date) => date).map((group) => group.month),
    ["2026-02", "2026-01", "2025-12", "undated"],
  )
  assert.deepEqual(
    groupTimelineItems(dates, (date) => date, "asc").map((group) => group.month),
    ["2025-12", "2026-01", "2026-02", "undated"],
  )
})

test("calendar validation prevents invalid leap days from being assigned to a month", () => {
  assert.equal(timelineMonth("2024-02-29"), "2024-02")
  for (const date of ["2025-02-29", "2026-02-30", "2026-13-01", "invalid", undefined])
    assert.equal(timelineMonth(date), "undated")
})

test("grouping preserves caller ordering within months and uses the selected date field", () => {
  const articles = [
    { title: "A", created: "2026-01-02", modified: "2026-02-02" },
    { title: "B", created: "2026-01-01", modified: "2026-02-01" },
  ]
  const field = timelineDateField("created-asc")
  const groups = groupTimelineItems(articles, (article) => article[field])
  assert.deepEqual(
    groups[0].entries.map((article) => article.title),
    ["A", "B"],
  )
  assert.equal(timelineDateField("title-desc"), "created")
  assert.equal(timelineDateField("modified-desc"), "modified")
  assert.equal(groupTimelineItems(articles, (article) => article.modified)[0].label, "2026 年 2 月")
  assert.deepEqual(
    groupTimelineItems([], () => undefined),
    [],
  )
})
