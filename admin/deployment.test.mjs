import assert from "node:assert/strict"
import test from "node:test"
import { deploymentRun } from "./deployment.mjs"
test("deployment status matches the saved commit and actual Pages workflow", () => {
  const run = {
    head_sha: "saved",
    path: ".github/workflows/deploy.yml",
    event: "push",
    status: "queued",
  }
  assert.equal(
    deploymentRun(
      {
        workflow_runs: [
          { ...run, head_sha: "other" },
          { ...run, path: ".github/workflows/other.yml" },
          { ...run, event: "schedule" },
          run,
        ],
      },
      "saved",
    ),
    run,
  )
  assert.equal(deploymentRun({ workflow_runs: [run] }, "missing"), null)
  assert.equal(deploymentRun(null, "saved"), null)
})
