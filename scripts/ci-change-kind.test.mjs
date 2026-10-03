import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { changeKind } from "./ci-change-kind.mjs"
test("only documentation skips site build; article changes still update fallback Pages", () => {
  assert.equal(changeKind(["docs/webfirst-maintenance.md", "README.md"]), "docs")
  assert.equal(changeKind(["library/site.json", "library/articles/a.md"]), "content")
  for (const files of [
    ["quartz/components/BlogView.tsx"],
    [".github/workflows/deploy.yml"],
    ["site/about.md"],
    ["docs/foo.md", "admin/app.mjs"],
    [],
  ])
    assert.equal(changeKind(files), "code")
})

test("every site deployment passes tests and type checking even after content-only pushes", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  )
  for (const command of [
    "npm run test:publish",
    "npx tsc --noEmit",
    "npm run build",
    "npm run verify:site",
  ]) {
    assert.ok(
      workflow.includes(`- run: ${command}\n        if: steps.changes.outputs.kind != 'docs'`),
      command,
    )
  }
  assert.match(workflow, /needs: build/)
})
