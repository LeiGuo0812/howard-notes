// GitHub App authorization bridge. Secrets stay on the server; user access tokens
// are delivered only to the initiating admin window and kept in its memory.
const encoder = new TextEncoder()
const COOKIE = "__Host-howard-flow"
const FLOW_SECONDS = 600
const random = (length = 32) => encode(crypto.getRandomValues(new Uint8Array(length)))
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (ch) => ch.charCodeAt(0))
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  )
const json = (value) => JSON.stringify(value).replaceAll("<", "\\u003c")

async function key(env) {
  const bytes = decode(env.ENCRYPTION_KEY || "")
  if (bytes.length !== 32) throw new Error("登录服务尚未配置。")
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
}
export async function seal(value, env, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
    await key(env),
    encoder.encode(JSON.stringify(value)),
  )
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`
}
export async function unseal(value, env, purpose) {
  const [iv, ciphertext] = value.split(".")
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(iv), additionalData: encoder.encode(purpose) },
        await key(env),
        decode(ciphertext),
      ),
    ),
  )
}
const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
const cookie = (value) =>
  `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${FLOW_SECONDS}`
function headers(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extra,
  }
}
function page(title, body, script = "", extra = {}, status = 200) {
  const nonce = random(18)
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} · Howard</title><style nonce="${nonce}">body{margin:0;background:#f6f7f5;color:#222;font:16px/1.7 system-ui,sans-serif}main{max-width:440px;margin:16vh auto;padding:32px}h1{font-size:24px}p{color:#526059}button,a{font:inherit}button,.button{display:inline-block;background:#24634b;color:white;padding:10px 20px;border:0;border-radius:8px;text-decoration:none;cursor:pointer}button:disabled{opacity:.5}a{color:#24634b}</style></head><body><main><h1>${escape(title)}</h1>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`,
    {
      status,
      headers: headers({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'`,
        ...extra,
      }),
    },
  )
}
const redirect = (url, value) =>
  new Response(null, {
    status: 302,
    headers: headers({ Location: url, ...(value ? { "Set-Cookie": value } : {}) }),
  })
async function config(env) {
  const row = await env.DB.prepare("SELECT encrypted FROM app_config WHERE id = 1").first()
  return row ? unseal(row.encrypted, env, "config") : null
}
async function createFlow(env, values) {
  const flow = { ...values, state: random(), expires: Date.now() + FLOW_SECONDS * 1000 }
  await env.DB.prepare("DELETE FROM login_flows WHERE expires < ?").bind(Date.now()).run()
  await env.DB.prepare("INSERT INTO login_flows (state, expires) VALUES (?, ?)")
    .bind(flow.state, flow.expires)
    .run()
  return { flow, cookie: cookie(await seal(flow, env, "flow")) }
}
async function consumeFlow(request, env, kind) {
  const value = (request.headers.get("Cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  let flow
  try {
    flow = await unseal(value || "", env, "flow")
  } catch {
    throw new Error("登录已失效，请关闭此窗口后重试。")
  }
  const url = new URL(request.url)
  if (
    flow.kind !== kind ||
    flow.origin !== url.origin ||
    flow.expires <= Date.now() ||
    flow.state !== url.searchParams.get("state")
  )
    throw new Error("登录校验失败，请关闭此窗口后重试。")
  // Consume before the upstream call, so neither success nor failure can be replayed.
  const used = await env.DB.prepare(
    "DELETE FROM login_flows WHERE state = ? AND expires >= ? RETURNING state",
  )
    .bind(flow.state, Date.now())
    .first()
  if (!used) throw new Error("此登录请求已使用，请重新登录。")
  return flow
}
async function github(fetcher, path, token) {
  const response = await fetcher(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Howard-Notes-Login",
      "X-GitHub-Api-Version": "2026-03-10",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) throw new Error("GitHub 授权未完成，请确认已将应用安装到 howard-notes 仓库。")
  return response.json()
}
function complete(env, flow, payload) {
  return page(
    payload.error ? "未能登录" : "登录成功",
    `<p>${escape(payload.error || "正在返回管理后台…")}</p><a href="${escape(env.ADMIN_URL)}">返回管理后台</a>`,
    `history.replaceState(null,"","/complete");if(window.opener){window.opener.postMessage(${json({ type: "howard-github-auth", channel: flow.channel, ...payload })},${json(new URL(env.ADMIN_URL).origin)});${payload.error ? "" : "window.close();"}}`,
    { "Set-Cookie": clearCookie() },
    payload.error ? 400 : 200,
  )
}

export async function handle(request, env, fetcher = (...args) => fetch(...args)) {
  const url = new URL(request.url),
    path = url.pathname
  try {
    if (path === "/health" && request.method === "GET")
      return Response.json({ ok: true, configured: !!(await config(env)) }, { headers: headers() })
    if (path === "/setup" && request.method === "GET") {
      if (await config(env)) return redirect(`${url.origin}/ready`)
      return page(
        "开通 GitHub 登录",
        '<p>使用 LeiGuo0812 创建登录应用。</p><form method="post" action="/setup/start"><input type="hidden" name="key" id="key"><button id="start" disabled>连接 GitHub</button></form><p id="hint"></p>',
        'const k=location.hash.slice(1);history.replaceState(null,"","/setup");if(/^[A-Za-z0-9_-]{43}$/.test(k)){document.getElementById("key").value=k;document.getElementById("start").disabled=false}else{document.getElementById("hint").textContent="请使用本机生成的首次开通链接。"}',
        // HTML form POSTs send Origin: null under no-referrer. Keep the origin,
        // without disclosing paths, query strings or the setup fragment.
        { "Referrer-Policy": "strict-origin" },
      )
    }
    if (path === "/setup/start" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin)
        return page(
          "请重新打开开通入口",
          "<p>未能验证页面来源，请重新运行开通程序。</p>",
          "",
          {},
          403,
        )
      if (await config(env)) throw new Error("登录应用已配置，不能重复开通。")
      if (Number(request.headers.get("Content-Length")) > 4096)
        return new Response("Too large", { status: 413 })
      const form = await request.formData()
      const supplied = String(form.get("key") || "")
      // Hash both strings to compare fixed-length values without early termination.
      const [a, b] = await Promise.all(
        [supplied, env.SETUP_KEY || ""].map((v) =>
          crypto.subtle.digest("SHA-256", encoder.encode(v)),
        ),
      )
      let difference = 0
      new Uint8Array(a).forEach((byte, i) => {
        difference |= byte ^ new Uint8Array(b)[i]
      })
      if (!env.SETUP_KEY || difference)
        return page("请重新打开开通入口", "<p>开通链接无效，请重新运行开通程序。</p>", "", {}, 403)
      const pending = await createFlow(env, { kind: "setup", origin: url.origin })
      const manifest = {
        name: `Howard Notes ${env.OWNER_LOGIN} ${random(4)}`,
        url: env.ADMIN_URL,
        redirect_url: `${url.origin}/setup/callback`,
        callback_urls: [`${url.origin}/oauth/callback`],
        setup_url: `${url.origin}/ready`,
        public: false,
        hook_attributes: { active: false },
        default_permissions: { contents: "write", metadata: "read" },
        default_events: [],
        request_oauth_on_install: false,
      }
      return page(
        "连接 GitHub",
        `<form method="post" action="https://github.com/settings/apps/new?state=${pending.flow.state}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>在 GitHub 创建登录应用</button></form>`,
        "document.forms[0].submit()",
        { "Set-Cookie": pending.cookie, "Referrer-Policy": "strict-origin" },
      )
    }
    if (path === "/setup/callback" && request.method === "GET") {
      await consumeFlow(request, env, "setup")
      if (await config(env)) throw new Error("登录应用已配置。")
      const code = url.searchParams.get("code")
      if (!code || !/^[a-zA-Z0-9_\-]{10,200}$/.test(code))
        throw new Error("GitHub 未完成应用创建，请重新开通。")
      const response = await fetcher(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Howard-Notes-Login",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      })
      if (!response.ok) throw new Error("应用创建请求已失效，请重新开通。")
      const app = await response.json()
      if (
        String(app.owner?.id) !== env.OWNER_ID ||
        app.permissions?.contents !== "write" ||
        Object.keys(app.permissions || {}).some((p) => !["metadata", "contents"].includes(p)) ||
        !/^[a-z0-9-]+$/.test(app.slug || "") ||
        !app.client_id ||
        !app.client_secret
      )
        throw new Error("请使用博客所有者 LeiGuo0812 创建仅含文章读写权限的应用。")
      const encrypted = await seal(
        { clientId: app.client_id, clientSecret: app.client_secret, slug: app.slug },
        env,
        "config",
      )
      const result = await env.DB.prepare(
        "INSERT OR IGNORE INTO app_config (id, encrypted) VALUES (1, ?)",
      )
        .bind(encrypted)
        .run()
      if (!result.meta?.changes) throw new Error("登录应用已配置。")
      return redirect(`${url.origin}/ready`, clearCookie())
    }
    if (path === "/ready" && request.method === "GET") {
      const app = await config(env)
      if (!app) throw new Error("请先完成首次开通。")
      return page(
        "授权博客仓库",
        `<p>点击安装，仅选择 <strong>howard-notes</strong> 仓库。</p><a class="button" href="https://github.com/apps/${escape(app.slug)}/installations/new">安装到博客仓库</a><p><a href="${escape(env.ADMIN_URL)}">完成后返回管理后台</a></p>`,
      )
    }
    if (path === "/login" && request.method === "GET") {
      const channel = url.searchParams.get("channel")
      if (!/^[a-zA-Z0-9_-]{43}$/.test(channel || "")) throw new Error("请从管理后台发起登录。")
      const app = await config(env)
      if (!app) throw new Error("账号登录尚未开通，请先完成首次配置。")
      const verifier = random()
      const pending = await createFlow(env, {
        kind: "login",
        origin: url.origin,
        verifier,
        channel,
      })
      const authorize = new URL("https://github.com/login/oauth/authorize")
      authorize.search = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: `${url.origin}/oauth/callback`,
        state: pending.flow.state,
        code_challenge: encode(
          new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))),
        ),
        code_challenge_method: "S256",
        login: env.OWNER_LOGIN,
        allow_signup: "false",
      }).toString()
      return redirect(authorize.href, pending.cookie)
    }
    if (path === "/oauth/callback" && request.method === "GET") {
      const flow = await consumeFlow(request, env, "login")
      try {
        if (url.searchParams.has("error")) throw new Error("你已取消 GitHub 授权。")
        const code = url.searchParams.get("code")
        if (!code || !/^[a-zA-Z0-9_\-]{10,200}$/.test(code))
          throw new Error("GitHub 未返回有效登录信息。")
        const app = await config(env)
        if (!app) throw new Error("登录应用配置缺失。")
        const response = await fetcher("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: app.clientId,
            client_secret: app.clientSecret,
            code,
            redirect_uri: `${url.origin}/oauth/callback`,
            code_verifier: flow.verifier,
          }),
        })
        const token = response.ok ? await response.json() : {}
        if (!token.access_token || token.token_type?.toLowerCase() !== "bearer")
          throw new Error("GitHub 登录未完成，请重试。")
        const user = await github(fetcher, "/user", token.access_token)
        if (String(user.id) !== env.OWNER_ID) throw new Error("此后台仅允许博客所有者登录。")
        const repository = await github(fetcher, `/repos/${env.REPOSITORY}`, token.access_token)
        if (!repository.permissions?.push)
          throw new Error("应用尚无博客写入权限，请先安装到 howard-notes 仓库。")
        if (!Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 28800)
          throw new Error("请在 GitHub 应用设置中启用短期用户授权，然后重新登录。")
        // Refresh tokens and the App private key are deliberately never stored or sent to the browser.
        return complete(env, flow, {
          token: token.access_token,
          login: user.login,
          expiresAt: Date.now() + token.expires_in * 1000,
        })
      } catch (error) {
        return complete(env, flow, { error: error.message })
      }
    }
    if (path === "/" && request.method === "GET") return redirect(env.ADMIN_URL)
    return new Response("Not found", { status: 404, headers: headers() })
  } catch (error) {
    // Do not expose upstream bodies, authorization codes or configuration in error pages/logs.
    const known = /[\u3400-\u9fff]/.test(error.message || "")
    return page(
      "暂未完成",
      `<p>${escape(known ? error.message : "登录服务暂时不可用，请稍后重试。")}</p><a href="${escape(env.ADMIN_URL)}">返回管理后台</a>`,
      "",
      { "Set-Cookie": clearCookie() },
      400,
    )
  }
}

export default { fetch: (request, env) => handle(request, env) }
