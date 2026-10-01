# 手机 GitHub 登录修复与验收

日期：2026-10-01。网站文章原文、目录元数据和页面设置未改动。主站原位编辑仅完成评估，见 [原位编辑方案](inline-edit-assessment.md)。

## 修复内容

旧流程每 500ms 把 `popup.closed` 判为取消，并只靠 `window.opener.postMessage` 返回用户凭据。实际 Chromium 中，授权页使用 `Cross-Origin-Opener-Policy: same-origin` 时，窗口代理的 `closed` 为真，但授权页仍打开且 `opener` 为 null，可以稳定复现原来的“已取消登录”。这证明原机制不能处理窗口断链；未据此推断用户手机的具体浏览器或 GitHub 响应头。[MDN Window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)

新版手机首次登录使用同页 GitHub 授权，返回管理页后自动恢复。桌面和保留未保存文章／布局的重新登录继续使用授权窗口，但不依赖窗口连接或关闭状态领取结果。

客户端先向 `/prepare` 登记随机 channel 和领取密钥的 SHA-256，成功后才导航。Worker 保留 GitHub PKCE、一次性 state、加密 HttpOnly Cookie、所有者 ID 与仓库写入权限检查。授权结果以 AES-GCM 加密存入 D1，领取有效期五分钟；`/result` 校验密钥、精确来源和有效期，再原子消费一次。迟到回调不能覆盖已完成结果。

手机同页跳转只在 sessionStorage 暂存领取证明，返回后清除；GitHub 令牌只在内存，不进入 URL 或浏览器存储。重新登录保留未保存表单与原始版本基线。后台构建将配置中验证过的登录服务来源加入 CSP connect-src，生成页面的策略也纳入站点验证。

为兼容已打开或缓存的旧后台，Worker 暂时保留无 challenge 的旧 postMessage 流程；新版客户端不使用该流程。

## 已执行的验证

- `npm run test:publish`：100 项通过，包括 13 项客户端登录测试、28 项 Worker 测试。Worker 使用真实内存 SQLite 验证并发领取、过期、错误证明、重放、来源限制、授权拒绝与权限检查。
- `npm run check`：TypeScript 与 Prettier 通过。
- `npm run build`：完成网站与后台构建。
- `npm run verify:site`：297 个 HTML 页面、172 篇文章、RSS、搜索索引与后台 CSP 通过。
- Wrangler dry-run 通过；远程 D1 使用幂等 schema 添加结果表，保留原应用配置；Worker 部署完成。
- 线上 Worker：health 200、预检 204、prepare 201、未完成结果 202、错误证明／来源 403、GitHub PKCE 授权跳转 302。验证停止在 GitHub 真实用户授权之前。
- Chromium 实际运行完整后台包：390px 触屏同页初登、1440px 桌面授权窗口，两者均经过真实 COOP 断链的受控授权页，随后显示所有者和文章列表。再次修改正文及页面设置后重新登录，未保存内容与原页面保留；无页面运行错误，无 GitHub 写入。
- 暂时网络失败、返回前台和仍在等待授权的客户端路径通过，不把这些状态当作取消。

浏览器回归中的 GitHub API 和授权服务响应是测试夹具，文章为“登录回归测试”，没有进行真实账号登录或发布测试文章。没有使用实体手机完成真实 GitHub 二次验证；此项仍需用户在自己的手机上验证。

## 修改文件

- `admin/auth.mjs`、`admin/app.mjs`：一次性结果领取、手机返回恢复与现有后台集成。
- `auth-service/worker.mjs`、`auth-service/schema.sql`：准备、加密结果、原子领取和兼容旧协议。
- `scripts/build-admin.mjs`、`scripts/verify-site.mjs`：精确 CSP 来源与生成页面验证。
- `admin/auth.test.mjs`、`auth-service/worker.test.mjs`：登录回归验证。
- `auth-service/README.md`：部署顺序与登录协议说明。

本机浏览器复现脚本位于忽略目录 `.local/mobile-login-diagnosis.js`、`.local/login-browser-check.js`；线上服务检查为 `.local/mobile-login-worker-check.mjs`。截图位于 `output/playwright/mobile-login-before-diagnosis.png`、`output/playwright/login-mobile-after.png`、`output/playwright/login-desktop-after.png`，均为本机验收资料，不进入网站公开资源。
