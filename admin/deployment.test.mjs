import assert from "node:assert/strict"
import test from "node:test"
import { deploymentRun, trackDeployment } from "./deployment.mjs"
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

const settle = () => new Promise((resolve) => setImmediate(resolve))
function documentFixture() {
  const doc = new EventTarget()
  doc.hidden = false
  doc.createTextNode = (text) => ({ textContent: text })
  doc.createElement = () => ({})
  const element = { replaceChildren() {}, append() {}, hidden: true }
  return { doc, element }
}
test("deployment queries pause in hidden tabs, resume immediately, and stop on completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1 })
  const priorDocument = globalThis.document
  const { doc, element } = documentFixture()
  globalThis.document = doc
  const sha = "1".repeat(40)
  let calls = 0,
    completed = false
  const fetcher = async () => {
    calls++
    return Response.json({
      workflow_runs: [
        {
          head_sha: sha,
          path: ".github/workflows/deploy.yml",
          event: "push",
          status: completed ? "completed" : "queued",
          conclusion: "success",
        },
      ],
    })
  }
  const stop = trackDeployment(element, sha, fetcher)
  try {
    await settle()
    assert.equal(calls, 1)
    doc.hidden = true
    doc.dispatchEvent(new Event("visibilitychange"))
    t.mock.timers.tick(60_000)
    await settle()
    assert.equal(calls, 1)
    doc.hidden = false
    doc.dispatchEvent(new Event("visibilitychange"))
    await settle()
    assert.equal(calls, 2)
    completed = true
    t.mock.timers.tick(20_000)
    await settle()
    assert.equal(calls, 3)
    doc.hidden = true
    doc.dispatchEvent(new Event("visibilitychange"))
    doc.hidden = false
    doc.dispatchEvent(new Event("visibilitychange"))
    t.mock.timers.tick(20_000)
    await settle()
    assert.equal(calls, 3)
  } finally {
    stop()
    globalThis.document = priorDocument
  }
})

test("deployment visibility wakeups coalesce while one request is pending", async () => {
  const priorDocument = globalThis.document
  const { doc, element } = documentFixture()
  globalThis.document = doc
  let calls = 0,
    reply
  const stop = trackDeployment(element, "2".repeat(40), () => {
    calls++
    return new Promise((resolve) => (reply = resolve))
  })
  try {
    doc.dispatchEvent(new Event("visibilitychange"))
    doc.hidden = true
    doc.dispatchEvent(new Event("visibilitychange"))
    doc.hidden = false
    doc.dispatchEvent(new Event("visibilitychange"))
    assert.equal(calls, 1)
    stop()
    reply(Response.json({ workflow_runs: [] }))
    await settle()
    doc.dispatchEvent(new Event("visibilitychange"))
    assert.equal(calls, 1)
  } finally {
    stop()
    globalThis.document = priorDocument
  }
})

test("deployment does not start network work from a hidden tab", async () => {
  const priorDocument = globalThis.document
  const { doc, element } = documentFixture()
  doc.hidden = true
  globalThis.document = doc
  let calls = 0
  const stop = trackDeployment(element, "3".repeat(40), async () => {
    calls++
    return Response.json({ workflow_runs: [] })
  })
  try {
    await settle()
    assert.equal(calls, 0)
    doc.hidden = false
    doc.dispatchEvent(new Event("visibilitychange"))
    await settle()
    assert.equal(calls, 1)
  } finally {
    stop()
    globalThis.document = priorDocument
  }
})
