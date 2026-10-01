# Android Chrome 登录与缓存修复

日期：2026-10-01。此前更新登录协议后，用户在正确后台地址仍看到立即取消。本次补齐缓存升级路径，文章原文与页面设置未改动。

## 诊断证据

当前线上 `bf43f45` 的 Android Chrome 浏览器模拟在 390px 手机和 980px 桌面网站视口均可同页进入 GitHub 登录页面：公开配置 200 → 准备 201 → Worker 登录 302 → GitHub 授权 302 → GitHub 登录 200。测试停止在账号输入界面，没有代用户输入或授权。

后台一直引用固定 `admin/admin.js`，线上 HTML 和脚本实测 `Cache-Control: max-age=600`。当前新版脚本解码后没有旧版的“已取消登录。”，而旧源码依赖窗口关闭判定，可以在受控 COOP 断链中准确复现该提示。结合用户无授权过程即取消，旧脚本／旧标签继续执行是最可能的解释；没有取得用户实体手机缓存或精确报错文字，不能把具体缓存层当作已证实。也没有观测到当前 GitHub 登录页面带 COOP，受控断链复现不代表 GitHub 当前一定使用该响应头。

## 实现

- 所有设备首次登录统一同页授权，不再依赖屏幕宽度或指针类型。重新认证仍保留当前未保存正文与布局。
- esbuild 入口改为 `admin-[hash].js`，从 metafile 找到实际入口并写入 HTML；脚本变化使用新 URL。[esbuild 官方说明](https://esbuild.github.io/api/#entry-names)
- `howard-admin-version` 覆盖脚本入口、HTML／CSP 和公开登录配置。旧 `admin.js` 成为仅升级新加载旧页面的同页跳转，不加载编辑器或发起授权。
- 升级保留 query、OAuth 返回的 login、hash 和 sessionStorage 领取证明；没有对已打开编辑器强制刷新。
- 相同版本仍收到旧 HTML 时停止自动跳转，保留证明并显示更新重试入口，避免循环。
- GitHub 回调配置错误、应用暂停与明确拒绝授权分别显示，忽略上游不可信错误描述。[GitHub 官方授权错误说明](https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-authorization-request-errors)

查询参数能创建新的浏览器页面缓存键，但实测不能保证绕过 Pages 边缘缓存。部署后需检查新版 HTML、哈希入口和兼容入口实际可用，再给用户带版本的直接链接；不能让手机已经运行的旧脚本远程自动失效。

## 已执行验证

- `npm run test:publish`：102 项通过，包含 14 项客户端登录、29 项 Worker 测试。
- `npm run check`：TypeScript 与 Prettier 通过。
- `npm run build`、`npm run verify:site`：297 个 HTML 页面、172 篇文章、RSS、搜索和后台 CSP／版本入口验证通过。
- 完整后台 Chromium 浏览器：Android 390px touch、980px touch、980px fine 均首次同页返回，显示 owner 和文章、清理返回参数和一次证明、支持实时预览。正文和布局修改后重新认证经过真实受控 COOP 断链，未保存修改保持；无运行错误，无 GitHub 写入。
- 旧 HTML＋旧 CSP＋新升级入口：仅同页导航一次；保留参数和证明，随后在新版 CSP 下领取一次结果并打开编辑器。
- 相同版本仍返回旧 HTML：不循环、不授权，明确提示重试并保留证明。
- 新 HTML 匿名加载：不加载升级入口、不自动授权、不请求 GitHub 原文或登录服务。

后台完整返回与编辑验证使用 OAuth／GitHub API 夹具；真实 GitHub 初始跳转另行验证。未在实体 Android 手机完成真实账户授权，未发布测试文章。

修改：`admin/auth.mjs`、`admin/auth.test.mjs`、`admin/index.html`、`scripts/build-admin.mjs`、`scripts/lib/admin-upgrade.mjs`、`scripts/verify-site.mjs`、`auth-service/worker.mjs`、`auth-service/worker.test.mjs`、`auth-service/README.md`。

本机验收脚本／日志在 `.local/android-login-new-build-check.js`、`.local/admin-cache-browser-review.js`、`.local/admin-cache-browser-review.log`；截图在 `output/playwright/login-android390-new-after.png`、`output/playwright/android390-github-login.png`、`output/playwright/admin-cache-upgrade-mobile.png`、`output/playwright/admin-cache-stale-retry-mobile.png`。这些资料不进入网站公开资源。
