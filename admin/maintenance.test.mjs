import test from "node:test"
import assert from "node:assert/strict"
import { createMaintenance } from "./maintenance.mjs"

test("session restoration exposes owner controls without fetching editor template or catalogue", async () => {
  const names = [
    "document",
    "window",
    "location",
    "localStorage",
    "sessionStorage",
    "fetch",
    "performance",
    "setTimeout",
    "clearTimeout",
  ]
  const original = new Map(
    names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  const storage = () => {
    const map = new Map()
    return {
      getItem: (key) => map.get(key) || null,
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    }
  }
  const control = () => ({ hidden: true, removeAttribute() {} })
  const login = control(),
    status = control(),
    toolbar = control(),
    label = control()
  const events = [],
    requests = []
  const now = Date.now()
  let clock = 0,
    loads = 0,
    activeAccess = null,
    expire,
    expiryDelay,
    connectionGate,
    releaseConnection,
    performed = 0
  const commands = new Map()
  const globals = {
    performance: { now: () => clock },
    setTimeout(callback, delay) {
      expire = callback
      expiryDelay = delay
      return { unref() {} }
    },
    clearTimeout() {},
    window: { scrollY: 0 },
    location: new URL("https://notes.test/site/"),
    localStorage: storage(),
    sessionStorage: storage(),
    document: {
      getElementById: () => null,
      querySelectorAll(selector) {
        return selector.includes("data-maintenance-login")
          ? [login]
          : selector.includes("data-maintenance-status")
            ? [status]
            : selector === ".maintenance-account"
              ? [label]
              : [toolbar]
      },
      dispatchEvent: (event) => events.push(event),
    },
    async fetch(input, options = {}) {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("runtime-config.json"))
        return Response.json({ enabled: true, apiBase: "https://notes.test/site/api/content" })
      if (url.endsWith("/session"))
        return Response.json(
          options.method === "GET"
            ? { token: "synthetic-owner-token", expiresAt: now + 300000, serverTime: now }
            : { status: "remembered", expiresAt: now + 300000 },
        )
      if (url === "https://api.github.com/user") return Response.json({ login: "owner" })
      throw new Error(`Unexpected eager request: ${url}`)
    },
  }
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  try {
    const runtime = await createMaintenance({
      siteBase: "https://notes.test/site/",
      version: "fixture",
      loadWorkspace: async () => ({
        createMaintenanceWorkspace: async ({ onSession }) => {
          loads++
          return {
            async connect(value) {
              if (connectionGate) await connectionGate
              activeAccess = { account: value.login, token: value.token }
              const accepted = onSession(
                { account: value.login, expiresAt: value.expiresAt, serverTime: value.serverTime },
                activeAccess,
              )
              if (accepted === false) activeAccess = null
            },
            getOwnerAccess: () => activeAccess,
            registerCommand(name, callback) {
              commands.set(name, callback)
              return () => commands.delete(name)
            },
            perform: async () => {
              performed++
            },
            beforeNavigation() {},
            afterNavigation() {},
            expireSession() {
              activeAccess = null
            },
          }
        },
      }),
    })
    assert.equal(requests.length, 0)
    await runtime.resume()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(runtime.getOwnerAccess(), { account: "owner", token: "synthetic-owner-token" })
    assert.equal(login.hidden, true)
    assert.equal(status.hidden, false)
    assert.equal(toolbar.hidden, false)
    assert.equal(label.textContent, "owner")
    assert.equal(events.at(-1).detail.loggedIn, true)
    runtime.beforeNavigation()
    runtime.afterNavigation()
    assert.ok(
      requests.every((url) => /runtime-config\.json$|\/session$|api.github.com\/user$/.test(url)),
    )
    assert.equal(loads, 0)
    const unregister = runtime.registerCommand("custom", () => {})
    clock = 100000
    await runtime.perform("articles")
    assert.equal(expiryDelay, 200000, "opening the editor must not renew the token lifetime")
    assert.equal(loads, 1)
    assert.equal(commands.has("custom"), true)
    unregister()
    assert.equal(commands.has("custom"), false)
    clock = 300001
    expire()
    assert.equal(events.at(-1).detail.loggedIn, false)
    connectionGate = new Promise((resolve) => {
      releaseConnection = resolve
    })
    const connecting = runtime.resume()
    await new Promise((resolve) => setImmediate(resolve))
    clock = 600002
    expire()
    releaseConnection()
    await connecting
    assert.equal(
      runtime.getOwnerAccess(),
      null,
      "late editor connection must not revive an expired login",
    )
    assert.equal(activeAccess, null)
    assert.equal(performed, 1)
    assert.equal(runtime.getOwnerAccess(), null)
    assert.equal(status.hidden, true)
    assert.equal(activeAccess, null)
    clock = 0

    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(runtime.getOwnerAccess(), null)
    assert.equal(login.hidden, false)
    assert.equal(toolbar.hidden, true)
    assert.equal(events.at(-1).detail.loggedIn, false)
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
