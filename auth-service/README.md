# GitHub 账号登录

GitHub Pages 继续托管博客和编辑器。这个小型 Cloudflare Worker 仅负责 GitHub App 授权，使用 D1 保存加密的应用凭据和一次性登录状态。

## 首次开通

在本机运行 `npm run setup`。引导程序会打开 Cloudflare 官方授权页面，再打开 GitHub 创建和安装应用的页面。只需使用自己的账号确认，不需要生成或粘贴个人访问令牌。

1. 在 Cloudflare 注册或登录，授权部署；使用 Workers 免费方案即可。
2. 在 GitHub 使用 `LeiGuo0812` 创建应用，安装时选择 `howard-notes` 和图片仓库 `pic_cloud_gl`。
3. 保留命令窗口；检查与部署成功后会自动打开新版后台。

首次引导可重复运行，已有数据库、密钥和应用会复用。若有多个 Cloudflare 账号，需先指定账号；脚本不会擅自选择。GitHub 远端存在新的提交、工程有未提交改动或测试失败时会停止，不强制覆盖。

`admin/auth-config.json` 只保存公开的登录服务地址；未配置时禁止部署 `main`，保持当前线上后台可用。`.local/account-login.json` 是本机开通与恢复凭据，权限为 `0600`，不进入 Git 或 Obsidian；不要删除或分享。`wrangler.local.json` 保存本机的 Cloudflare 资源绑定，也不提交。

## 登录和权限

访问后台，点击“使用 GitHub 登录”。密码与二次验证仅在 GitHub 官方页面输入。服务端按固定的 GitHub 用户 ID 验证博客所有者，并检查仓库写入权限。应用只申请 Contents 写入与 Metadata 读取权限。

授权使用一次性 state、PKCE、加密 HttpOnly Cookie；回调页无缓存，不加载第三方资源。短期用户凭据只通过精确来源、窗口与随机请求标识校验的 `postMessage` 交给发起登录的后台，保存在页面内存，刷新或退出即清除。授权最长八小时；点击“重新登录”可保留当前未保存编辑。刷新凭据和 GitHub App 私钥不保存。退出后台不退出 GitHub 本身。

修改应用设置或安装后可打开 Worker 的 `/ready` 页面重新进入仓库安装流程。图片托管设置中的“仓库授权”会显示当前图片仓库；保留博客仓库并添加图床仓库，保存后重新登录。不要取消 GitHub App 的短期用户授权设置。应用密钥加密保存在 D1，解密密钥是 Worker Secret；不要把任何密钥填入前端配置。

## 验证和更新

```bash
npm ci
npm test
npx wrangler deploy --dry-run
```

GitHub 项目根目录的 `npm run test:publish` 同时验证登录服务与编辑器。已开通的 Worker 更新使用 `npx wrangler deploy --config wrangler.local.json`；常规文章与页面设置保存仍由现有 GitHub Pages 工作流发布。

参考：[GitHub App 授权](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[Workers 免费额度](https://developers.cloudflare.com/workers/platform/pricing/)。
