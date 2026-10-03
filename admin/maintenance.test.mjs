import test from "node:test"
import assert from "node:assert/strict"
import { createMaintenance } from "./maintenance.mjs"

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

async function openingFixture(
  t,
  { paintGate, importGate, connectionGate, prepareGate, prepare, libraryReady = true, load } = {},
) {
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
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const storage = () => {
    const values = new Map()
    return {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }
  }
  const now = Date.now()
  const state = {
    imports: 0,
    factories: 0,
    connects: 0,
    connectModes: [],
    prepared: [],
    libraryReady,
    logouts: 0,
    expirations: 0,
    visible: false,
    clock: 0,
    access: null,
    shown: [],
    performed: [],
    failures: [],
    status: [],
    events: [],
    requests: [],
    destroyed: 0,
    layouts: [],
  }
  const layout = { left: 120, top: 80, width: 900, height: 640, maximized: false }
  let openingCallbacks, onSession
  const timers = new Set()
  const globals = {
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      dispatchEvent: (event) => state.events.push(event),
    },
    window: { scrollY: 0 },
    location: new URL("https://notes.test/site/"),
    localStorage: storage(),
    sessionStorage: storage(),
    performance: { now: () => state.clock },
    setTimeout(callback, delay) {
      const timer = { callback, delay, unref() {} }
      timers.add(timer)
      return timer
    },
    clearTimeout(timer) {
      timers.delete(timer)
    },
    async fetch(input, options = {}) {
      const url = String(input)
      state.requests.push({ url, method: options.method || "GET" })
      if (url.endsWith("runtime-config.json"))
        return Response.json({ enabled: true, apiBase: "https://notes.test/site/api/content" })
      if (url.endsWith("/session")) {
        if (options.method === "DELETE") return Response.json({ status: "cleared" })
        if (options.method === "POST")
          return Response.json({ status: "remembered", expiresAt: now + 300000 })
        return Response.json({
          login: "owner",
          token: "synthetic-opening-token",
          expiresAt: now + 300000,
          serverTime: now,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
  }
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const instance = {
    async connect(credentials, options) {
      state.connects++
      state.connectModes.push(options?.mode)
      if (connectionGate) await connectionGate.promise
      state.access = { account: credentials.login, token: credentials.token }
      const accepted = onSession(
        {
          account: credentials.login,
          expiresAt: credentials.expiresAt,
          serverTime: credentials.serverTime,
        },
        state.access,
      )
      if (accepted === false) state.access = null
    },
    getOwnerAccess: () => state.access,
    isReady: (action) => action === "settings" || state.libraryReady,
    async prepare(action) {
      state.prepared.push(action)
      if (prepare) await prepare(action, state)
      else if (prepareGate && action !== "settings") await prepareGate.promise
      if (action !== "settings") state.libraryReady = true
    },
    async perform(action, options) {
      state.performed.push({ action, options })
    },
    registerCommand: () => () => {},
    beforeNavigation() {},
    afterNavigation() {},
    expireSession() {
      state.expirations++
      state.access = null
    },
    logout() {
      state.logouts++
      state.access = null
      onSession(null, null)
    },
  }
  const module = {
    async createMaintenanceWorkspace(options) {
      state.factories++
      onSession = options.onSession
      return instance
    },
  }
  const runtime = await createMaintenance({
    siteBase: "https://notes.test/site/",
    version: "opening-fixture",
    createOpeningView(callbacks) {
      openingCallbacks = callbacks
      return {
        show(action) {
          state.visible = true
          state.shown.push(action)
        },
        hide() {
          state.visible = false
          openingCallbacks.onHide()
        },
        fail(error) {
          state.failures.push(error)
        },
        setStatus: (text) => state.status.push(text),
        isVisible: () => state.visible,
        capture() {
          state.layouts.push(layout)
          return layout
        },
        async afterPaint() {
          if (paintGate) await paintGate.promise
        },
        destroy() {
          state.visible = false
          state.destroyed++
        },
      }
    },
    loadWorkspace() {
      state.imports++
      return load
        ? load(state.imports, module)
        : importGate
          ? importGate.promise
          : Promise.resolve(module)
    },
  })
  await runtime.resume()
  await nextTurn()
  return {
    runtime,
    state,
    module,
    instance,
    layout,
    close() {
      state.visible = false
      openingCallbacks.onHide()
    },
    retry: () => openingCallbacks.onRetry(state.shown.at(-1)),
    expire() {
      state.clock = 300001
      const timer = Array.from(timers).at(-1)
      assert.ok(timer, "a restored owner session must have an expiry timer")
      timer.callback()
    },
  }
}

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
      createOpeningView: () => ({
        show() {},
        hide() {},
        fail() {},
        setStatus() {},
        isVisible: () => true,
        capture: () => null,
        afterPaint: async () => {},
        destroy() {},
      }),
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
            logout() {
              activeAccess = null
              onSession(null, null)
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

test("a cold settings click displays its window before painting or importing the editor", async (t) => {
  const paintGate = deferred(),
    importGate = deferred()
  const fixture = await openingFixture(t, { paintGate, importGate })
  const opening = fixture.runtime.perform("settings")
  assert.deepEqual(fixture.state.shown, ["settings"])
  assert.equal(fixture.state.visible, true)
  assert.equal(fixture.state.imports, 0, "the loading window must get a paint before heavy work")
  await nextTurn()
  assert.equal(fixture.state.imports, 0)
  paintGate.resolve()
  await nextTurn()
  assert.equal(fixture.state.imports, 1)
  assert.equal(fixture.state.factories, 0)
  importGate.resolve(fixture.module)
  await opening
  assert.equal(fixture.state.connects, 1)
  assert.deepEqual(fixture.state.connectModes, ["settings"])
  assert.deepEqual(fixture.state.prepared, ["settings"])
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
})

test("closing a pending window prevents a late import from reopening it", async (t) => {
  const importGate = deferred()
  const fixture = await openingFixture(t, { importGate })
  const opening = fixture.runtime.perform("settings")
  await nextTurn()
  fixture.close()
  importGate.resolve(fixture.module)
  await opening
  assert.equal(fixture.state.visible, false)
  assert.deepEqual(fixture.state.performed, [])
  assert.equal(fixture.state.status.at(-1), "维护界面已就绪，可重新打开。")
  assert.equal(fixture.state.failures.length, 0)
  assert.equal(fixture.runtime.getOwnerAccess()?.account, "owner")
})

test("closing before the first paint avoids importing and reports that the window is minimized", async (t) => {
  const paintGate = deferred()
  const fixture = await openingFixture(t, { paintGate })
  const opening = fixture.runtime.perform("settings")
  fixture.close()
  paintGate.resolve()
  await opening
  assert.equal(fixture.state.imports, 0)
  assert.equal(fixture.state.visible, false)
  assert.deepEqual(fixture.state.performed, [])
  assert.deepEqual(fixture.state.status, ["窗口已收起，可重新打开。"])
})

test("a hidden import failure offers retry without reopening the window or rejecting the stale action", async (t) => {
  const importGate = deferred()
  const fixture = await openingFixture(t, {
    load: (attempt, module) => (attempt === 1 ? importGate.promise : Promise.resolve(module)),
  })
  const opening = fixture.runtime.perform("settings")
  await nextTurn()
  fixture.close()
  importGate.reject(new Error("synthetic hidden import failure"))
  await assert.doesNotReject(opening)
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.state.failures.length, 1)
  assert.match(fixture.state.failures[0].message, /再次点击重试/)
  assert.deepEqual(fixture.state.shown, ["settings"])
  assert.deepEqual(fixture.state.performed, [])
  await fixture.retry()
  await nextTurn()
  assert.equal(fixture.state.imports, 2)
  assert.deepEqual(fixture.state.shown, ["settings", "settings"])
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
})

test("repeated cold clicks share one import and connect, with only the latest action opening", async (t) => {
  const importGate = deferred()
  const fixture = await openingFixture(t, { importGate })
  const settings = fixture.runtime.perform("settings")
  await nextTurn()
  const newest = fixture.runtime.perform("new")
  assert.deepEqual(fixture.state.shown, ["settings", "new"])
  await nextTurn()
  assert.equal(fixture.state.imports, 1)
  importGate.resolve(fixture.module)
  await Promise.all([settings, newest])
  assert.equal(fixture.state.factories, 1)
  assert.equal(fixture.state.connects, 1)
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["new"],
  )
})

test("closing and reopening during connection reuses the pending workspace", async (t) => {
  const connectionGate = deferred()
  const fixture = await openingFixture(t, { connectionGate })
  const first = fixture.runtime.perform("settings")
  await nextTurn()
  assert.equal(fixture.state.connects, 1)
  fixture.close()
  const second = fixture.runtime.perform("articles")
  await nextTurn()
  assert.equal(fixture.state.imports, 1)
  assert.equal(fixture.state.factories, 1)
  assert.equal(fixture.state.connects, 1)
  connectionGate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["articles"],
  )
})

test("logout responds during an unresolved import and cannot initiate late editor login", async (t) => {
  const importGate = deferred()
  const fixture = await openingFixture(t, { importGate })
  const opening = fixture.runtime.perform("settings")
  await nextTurn()
  const logout = fixture.runtime.perform("logout")
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.state.events.at(-1).detail.loggedIn, false)
  await logout
  await nextTurn()
  assert.ok(fixture.state.requests.some(({ method }) => method === "DELETE"))
  importGate.resolve(fixture.module)
  await opening
  assert.equal(fixture.state.connects, 0)
  assert.deepEqual(fixture.state.performed, [])
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  assert.ok(fixture.state.requests.every(({ url }) => !url.endsWith("auth-config.json")))
})

test("logout bypasses a pending connection and rejects its late session callback", async (t) => {
  const connectionGate = deferred()
  const fixture = await openingFixture(t, { connectionGate })
  const opening = fixture.runtime.perform("settings")
  await nextTurn()
  assert.equal(fixture.state.connects, 1)
  const logout = fixture.runtime.perform("logout")
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  assert.equal(
    fixture.state.logouts,
    1,
    "logout must call the built workspace without awaiting connect",
  )
  assert.equal(fixture.state.visible, false)
  await logout
  connectionGate.resolve()
  await opening
  assert.equal(fixture.state.access, null)
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  assert.deepEqual(fixture.state.performed, [])
  assert.equal(fixture.state.events.at(-1).detail.loggedIn, false)
})

test("session expiry cancels a pending window and rejects its late connection", async (t) => {
  const connectionGate = deferred()
  const fixture = await openingFixture(t, { connectionGate })
  const opening = fixture.runtime.perform("drafts")
  await nextTurn()
  fixture.expire()
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.state.expirations, 1)
  connectionGate.resolve()
  await opening
  assert.equal(fixture.state.access, null)
  assert.deepEqual(fixture.state.performed, [])
  assert.equal(fixture.state.events.at(-1).detail.loggedIn, false)
})

test("a failed editor import remains retryable without leaving a rejected shared promise", async (t) => {
  const importGate = deferred()
  const fixture = await openingFixture(t, {
    load: (attempt, module) => (attempt === 1 ? importGate.promise : Promise.resolve(module)),
  })
  const first = fixture.runtime.perform("settings").then(
    () => null,
    (error) => error,
  )
  await nextTurn()
  importGate.reject(new Error("synthetic module failure"))
  await first
  assert.equal(fixture.state.failures.length, 1)
  assert.equal(fixture.state.visible, true)
  assert.deepEqual(fixture.state.performed, [])
  await fixture.retry()
  await nextTurn()
  assert.equal(fixture.state.imports, 2)
  assert.equal(fixture.state.factories, 1)
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
})

test("a failed connection can be retried using the existing imported workspace", async (t) => {
  const fixture = await openingFixture(t)
  const connect = fixture.instance.connect.bind(fixture.instance)
  fixture.instance.connect = async (credentials) => {
    if (fixture.state.connects === 0) {
      fixture.state.connects++
      throw new Error("synthetic connection failure")
    }
    return connect(credentials)
  }
  await fixture.runtime.perform("trash").catch(() => {})
  assert.equal(fixture.state.failures.length, 1)
  assert.equal(fixture.state.visible, true)
  await fixture.retry()
  await nextTurn()
  assert.equal(fixture.state.imports, 1)
  assert.equal(fixture.state.factories, 1)
  assert.equal(fixture.state.connects, 2)
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["trash"],
  )
})

test("navigation destroys a pending opening and cannot receive its delayed action", async (t) => {
  const importGate = deferred()
  const fixture = await openingFixture(t, { importGate })
  const opening = fixture.runtime.perform("settings")
  await nextTurn()
  fixture.runtime.beforeNavigation()
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.state.destroyed, 1)
  importGate.resolve(fixture.module)
  await opening
  fixture.runtime.afterNavigation()
  assert.deepEqual(fixture.state.performed, [])
  assert.equal(fixture.runtime.getOwnerAccess()?.account, "owner")
})

test("the ready panel receives opening geometry, while warm actions skip the loading view", async (t) => {
  const fixture = await openingFixture(t)
  await fixture.runtime.perform("settings")
  assert.equal(fixture.state.performed[0].options.openingLayout, fixture.layout)
  assert.equal(fixture.state.layouts.length, 1)
  assert.equal(fixture.state.destroyed, 1)
  assert.equal(fixture.state.visible, false)
  await fixture.runtime.perform("drafts")
  assert.deepEqual(fixture.state.shown, ["settings"])
  assert.equal(fixture.state.imports, 1)
  assert.equal(fixture.state.connects, 1)
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings", "drafts"],
  )
})

test("a settings connection does not wait for article preparation, while a later article window does", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  assert.deepEqual(fixture.state.connectModes, ["settings"])
  assert.deepEqual(fixture.state.prepared, ["settings"])
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )

  const articles = fixture.runtime.perform("articles")
  assert.deepEqual(fixture.state.shown, ["settings", "articles"])
  assert.equal(fixture.state.visible, true, "the unready article window must respond immediately")
  await nextTurn()
  assert.deepEqual(fixture.state.prepared, ["settings", "articles"])
  assert.equal(fixture.state.connects, 1, "article preparation must reuse the owner connection")
  assert.equal(fixture.state.performed.length, 1)
  prepareGate.resolve()
  await articles
  assert.equal(fixture.state.performed.at(-1).action, "articles")
  assert.equal(fixture.state.performed.at(-1).options.openingLayout, fixture.layout)
})

test("a warm settings window remains available while a newer article request prepares the full library", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  const article = fixture.runtime.perform("new")
  await nextTurn()
  assert.deepEqual(fixture.state.prepared, ["settings", "new"])
  assert.equal(fixture.state.visible, true)

  await fixture.runtime.perform("settings")
  assert.equal(fixture.state.visible, false)
  assert.deepEqual(fixture.state.shown, ["settings", "new"])
  assert.deepEqual(fixture.state.prepared, ["settings", "new", "settings"])
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings", "settings"],
  )
  prepareGate.resolve()
  await article
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings", "settings"],
    "the old new-article request must not reopen after settings was selected",
  )
  assert.equal(fixture.state.connects, 1)
  assert.equal(fixture.state.factories, 1)
})

test("a stale article preparation failure cannot replace the settings window or reject its superseded request", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  const article = fixture.runtime.perform("drafts")
  await nextTurn()
  await fixture.runtime.perform("settings")
  prepareGate.reject(new Error("synthetic stale library failure"))
  await assert.doesNotReject(article)
  assert.deepEqual(fixture.state.failures, [])
  assert.equal(fixture.state.performed.at(-1).action, "settings")
  assert.equal(fixture.runtime.getOwnerAccess()?.account, "owner")
})

test("closing during article preparation does not reopen its window when the library becomes ready", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  const article = fixture.runtime.perform("new")
  await nextTurn()
  fixture.close()
  prepareGate.resolve()
  await article
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.state.status.at(-1), "维护界面已就绪，可重新打开。")
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
})

test("logout does not wait for article preparation and late readiness cannot reopen or restore access", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  const article = fixture.runtime.perform("new")
  await nextTurn()
  await fixture.runtime.perform("logout")
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  assert.equal(fixture.state.logouts, 1)
  prepareGate.resolve()
  await article
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
  assert.equal(fixture.runtime.getOwnerAccess(), null)
})

test("session expiry during article preparation rejects the delayed opening intent", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  const article = fixture.runtime.perform("articles")
  await nextTurn()
  fixture.expire()
  assert.equal(fixture.state.visible, false)
  assert.equal(fixture.runtime.getOwnerAccess(), null)
  prepareGate.resolve()
  await article
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
  assert.equal(fixture.runtime.getOwnerAccess(), null)
})

test("navigation during article preparation invalidates the opening without clearing owner access", async (t) => {
  const prepareGate = deferred()
  const fixture = await openingFixture(t, { prepareGate, libraryReady: false })
  await fixture.runtime.perform("settings")
  const article = fixture.runtime.perform("articles")
  await nextTurn()
  fixture.runtime.beforeNavigation()
  assert.equal(fixture.state.visible, false)
  prepareGate.resolve()
  await article
  fixture.runtime.afterNavigation()
  assert.deepEqual(
    fixture.state.performed.map(({ action }) => action),
    ["settings"],
  )
  assert.equal(fixture.runtime.getOwnerAccess()?.account, "owner")
})

test("failed article preparation preserves warm settings and can retry without another module or login", async (t) => {
  let attempts = 0
  const fixture = await openingFixture(t, {
    libraryReady: false,
    async prepare(action) {
      if (action !== "settings" && ++attempts === 1)
        throw new Error("synthetic first library failure")
    },
  })
  await fixture.runtime.perform("settings")
  await assert.rejects(fixture.runtime.perform("new"), /synthetic first library failure/)
  assert.equal(fixture.state.failures.length, 1)
  assert.equal(fixture.state.libraryReady, false)

  await fixture.runtime.perform("settings")
  assert.equal(fixture.state.visible, false)
  assert.deepEqual(fixture.state.shown, ["settings", "new"])
  assert.equal(fixture.state.performed.at(-1).action, "settings")
  await fixture.runtime.perform("new")
  assert.equal(attempts, 2)
  assert.equal(fixture.state.performed.at(-1).action, "new")
  assert.equal(fixture.state.imports, 1)
  assert.equal(fixture.state.factories, 1)
  assert.equal(fixture.state.connects, 1)
  assert.deepEqual(fixture.state.connectModes, ["settings"])
})
