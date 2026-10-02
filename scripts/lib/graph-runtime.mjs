// Adapt the installed Graph component at build time. Its rendering, forces,
// pointer interactions and keyboard behavior remain in the upstream script.
// No third-party implementation is vendored or changed in node_modules.
export function mountDeferredGraph(initialize) {
  const libraries = [
    ["d3", "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"],
    ["PIXI", "https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/pixi.js"],
  ]
  const loads = new Map()
  let initialized = false,
    pending = null,
    activation = null,
    navigation = 0,
    notice = null
  const hideNotice = () => {
    notice?.remove()
    notice = null
  }
  const showNotice = (text, state) => {
    if (!notice) {
      notice = document.createElement("div")
      notice.className = "maintenance-progress graph-load-status"
      notice.setAttribute("role", "status")
      notice.setAttribute("aria-live", "polite")
      document.body.appendChild(notice)
    }
    notice.dataset.state = state
    notice.textContent = text
  }
  const cancel = () => {
    activation?.button.removeAttribute("aria-busy")
    activation = null
    hideNotice()
  }
  const invalidate = () => {
    navigation++
    cancel()
  }
  const recordVisit = () => {
    // Preserve the upstream visited-node colors before its heavier renderer
    // has been requested. Upstream records both its route and graph node ID.
    try {
      let route = decodeURI(new URL(location.href).pathname).replace(/^\//, "").replace(/\/$/, "")
      const base = (document.body?.dataset?.basepath || "").replace(/^\//, "")
      if (base && route.startsWith(base)) route = route.slice(base.length).replace(/^\//, "")
      const node =
        (route === "index" || route.endsWith("/index") ? route.slice(0, -5) : route) || "/"
      const visits = new Set(JSON.parse(window.localStorage.getItem("graph-visited") || "[]"))
      visits.add(node)
      visits.add(route)
      window.localStorage.setItem("graph-visited", JSON.stringify([...visits]))
    } catch {
      // Storage can be unavailable in private browsing; graph loading remains
      // independent from this optional visited-color preference.
    }
  }
  const load = ([name, url]) => {
    if (window[name]) return Promise.resolve()
    if (loads.has(url)) return loads.get(url)
    const task = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = url
      script.crossOrigin = "anonymous"
      script.async = true
      const finish = (error) => {
        clearTimeout(timeout)
        script.onload = script.onerror = null
        if (error) {
          script.remove()
          loads.delete(url)
          reject(error)
        } else resolve()
      }
      const timeout = setTimeout(() => finish(new Error("Graph library timed out")), 30000)
      script.onload = () =>
        finish(window[name] ? null : new Error("Graph library was unavailable after loading"))
      script.onerror = () => finish(new Error("Graph library could not load"))
      document.head.appendChild(script)
    })
    loads.set(url, task)
    return task
  }
  const detach = () => {
    document.removeEventListener("click", click, true)
    document.removeEventListener("keydown", keydown, true)
    document.removeEventListener("prenav", invalidate)
    document.removeEventListener("nav", invalidate)
    document.removeEventListener("render", invalidate)
    document.removeEventListener("nav", recordVisit)
  }
  const activate = (button) => {
    // A second activation cancels the requested open, while the shared download
    // may finish and be reused. It never starts duplicate library downloads.
    if (activation) return cancel()
    activation = { button, navigation, url: location.href }
    button.setAttribute("aria-busy", "true")
    showNotice("正在加载关系图谱…", "working")
    if (pending) return
    pending = Promise.all(libraries.map(load))
      // The official Pixi adapter uses static uniform synchronizers instead of
      // Function constructors. Keep a strict script CSP without disabling graph.
      .then(() =>
        load([
          "unsafe_eval_js",
          "https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/packages/unsafe-eval.js",
        ]),
      )
      .then(() => {
        initialize()
        initialized = true
        detach()
        const requested = activation
        cancel()
        if (
          requested &&
          requested.navigation === navigation &&
          requested.url === location.href &&
          requested.button.isConnected
        )
          requested.button.click()
      })
      .catch(() => {
        const requested = activation
        cancel()
        if (
          requested &&
          requested.navigation === navigation &&
          requested.url === location.href &&
          requested.button.isConnected
        )
          showNotice("关系图谱加载失败，请再次点击重试。", "error")
      })
      .finally(() => {
        pending = null
      })
  }
  const click = (event) => {
    if (initialized) return
    const button = event.target?.closest?.(".global-graph-icon")
    if (!button) return
    event.preventDefault()
    event.stopImmediatePropagation()
    activate(button)
  }
  const keydown = (event) => {
    if (initialized) return
    if (event.key === "Escape") {
      if (activation) {
        event.preventDefault()
        cancel()
      }
      return
    }
    if (event.key !== "g" || !(event.ctrlKey || event.metaKey) || event.shiftKey) return
    const button = document.querySelector(".global-graph-icon")
    if (!button) return
    event.preventDefault()
    event.stopImmediatePropagation()
    activate(button)
  }
  document.addEventListener("click", click, true)
  document.addEventListener("keydown", keydown, true)
  document.addEventListener("prenav", invalidate)
  document.addEventListener("nav", invalidate)
  document.addEventListener("render", invalidate)
  document.addEventListener("nav", recordVisit)
  recordVisit()
}

function replaceRequired(source, before, after, purpose) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before))
    throw new Error(`The installed Graph runtime changed; review ${purpose} before building.`)
  return source.replace(before, after)
}

export function deferGraphRuntime(source) {
  const start = source.indexOf('Promise.all([e("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js")')
  const end = source.indexOf("function r(){", start)
  if (start < 0 || end < start)
    throw new Error("The installed Graph library loader changed; review its lazy-load adapter.")
  // Quartz bundles its build plugins with esbuild keepNames. Serialized
  // functions can therefore contain esbuild's __name calls; bind that helper
  // explicitly in the browser rather than relying on the build process scope.
  const bridge = `(function(__name){(${mountDeferredGraph.toString()})(r)})(function(fn,name){Object.defineProperty(fn,"name",{value:name,configurable:true});return fn});`
  let result = `${source.slice(0, start)}${bridge}${source.slice(end)}`
  result = replaceRequired(
    result,
    "function r(){var o=window.d3",
    "function r(){var __howardGlobalGeneration=0;var o=window.d3",
    "graph initialization",
  )
  result = replaceRequired(
    result,
    "async function D(_,w,A){var g=cu(w)",
    "async function D(_,w,A){var __howardGeneration=__howardGlobalGeneration;var g=cu(w)",
    "asynchronous graph lifecycle",
  )
  const stale = "!_.isConnected||(A!==void 0?A!==t:__howardGeneration!==__howardGlobalGeneration)"
  result = replaceRequired(
    result,
    "var qu=await fetchData;uu=new Map;",
    `var qu=await fetchData;if(${stale})return function(){};uu=new Map;`,
    "graph data completion",
  )
  result = replaceRequired(
    result,
    "),_.appendChild(Q.canvas);",
    `);if(${stale}){Q.destroy(!0);return function(){}}_.appendChild(Q.canvas);`,
    "graph canvas initialization",
  )
  result = replaceRequired(
    result,
    "function m(){for(var _=0;_<b.length;_++)",
    "function m(){__howardGlobalGeneration++;for(var _=0;_<b.length;_++)",
    "global graph close cleanup",
  )
  result = replaceRequired(
    result,
    ".then(function(fu){b.push(fu)})",
    ".then(function(fu){S.isConnected&&M()?b.push(fu):fu()})",
    "late global graph cleanup",
  )
  result = replaceRequired(
    result,
    ".then(function(S){_===t&&d.push(S)})",
    ".then(function(S){_===t?d.push(S):S()})",
    "late local graph cleanup",
  )
  return result
}
