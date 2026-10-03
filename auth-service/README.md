# GitHub 账号登录

Cloudflare 内容 Worker 托管主站和编辑器，GitHub Pages 提供静态备用站。这个小型 Cloudflare Worker 仅负责 GitHub App 授权，使用 D1 保存加密的应用凭据、一次性登录状态与短时加密登录结果。

## 首次开通

在本机运行 `npm run setup`。引导程序会打开 Cloudflare 官方授权页面，再打开 GitHub 创建和安装应用的页面。只需使用自己的账号确认，不需要生成或粘贴个人访问令牌。

1. 在 Cloudflare 注册或登录，授权部署；使用 Workers 免费方案即可。
2. 在 GitHub 使用 `LeiGuo0812` 创建应用，安装时选择 `howard-notes` 和图片仓库 `pic_cloud_gl`。
3. 保留命令窗口；检查与部署成功后会自动打开新版后台。

首次引导在原配套本机配置齐全时可复用已有数据库、密钥和应用。换机器或配置缺失时先按私库恢复指南取得配套材料，不盲跑引导或重新生成密钥。若有多个 Cloudflare 账号，需先指定账号；脚本不会擅自选择。GitHub 远端存在新的提交、工程有未提交改动或测试失败时会停止，不强制覆盖。

`admin/auth-config.json` 只保存公开的登录服务地址；未配置时禁止部署 `main`，保持当前线上后台可用。`.local/account-login.json` 是本机开通与恢复凭据，权限为 `0600`，不进入 Git 或 Obsidian；不要删除或分享。`wrangler.local.json` 保存本机的 Cloudflare 资源绑定，也不提交。

## 登录和权限

访问后台，点击“使用 GitHub 登录”。密码与二次验证仅在 GitHub 官方页面输入。服务端按固定的 GitHub 用户 ID 验证博客所有者，并检查仓库写入权限。应用只申请 Contents 写入与 Metadata 读取权限。

授权使用一次性 state、PKCE、加密 HttpOnly Cookie；回调页无缓存，不加载第三方资源。首次登录在所有设备上采用同页跳转，授权后自动返回管理页；保留未保存修改的重新登录使用授权窗口。登录完成不再依赖窗口的 `opener` 或 `closed`，避免手机标签页或跨域窗口断链被误判为取消。

后台生成 32 字节随机领取密钥，先等待 `/prepare` 登记成功再导航，防止首次领取早于登录登记；授权链接只携带密钥的 SHA-256 与随机请求标识。服务端完成所有者与写入权限校验后加密暂存结果，领取有效期为五分钟，过期记录在后续准备或登录请求时清理。后台通过精确来源限制的 `/result` POST 提交领取密钥，结果原子消费一次。手机同页跳转期间仅在 `sessionStorage` 保存领取密钥和请求信息，返回后校验、领取并清除；GitHub 用户令牌不进入 URL 或浏览器存储。浏览器中的用户令牌仅在内存，不写持久存储。主站另由内容 Worker 使用加密 Secure、HttpOnly、SameSite=Strict Cookie 恢复会话，刷新及新标签仍须服务端核验权限；Pages 域名不共享主站 Cookie。授权最长八小时；点击“重新登录”保留当前未保存编辑。刷新令牌和 GitHub App 私钥不保存。退出后台不退出 GitHub 本身。

`/result` 领取时附加新鲜 `serverTime`，前端以同一服务器时钟校验 `expiresAt`，不与手机的系统时间比较。GitHub 返回的完整八小时有效期不会因手机慢几秒或重登响应较快而被误拒绝；上限仍为八小时。到期时间从 token 兑换开始前保守计算，仓库权限检查不延长寿命；领取前已过期的令牌只返回明确错误，不回传凭据。先部署包含 `serverTime` 的 Worker，再发布对应前端。

`/login` 暂时保留旧版无 challenge 的 `postMessage` 协议，确保部署服务端时仍在使用旧后台的窗口能继续登录；新版后台只使用一次性领取协议。授权被拒绝时返回明确的 GitHub 取消消息；浏览器断开窗口引用本身不表示取消。

后台入口脚本使用内容哈希文件名，HTML 中的 `howard-admin-version` 同时覆盖脚本、模板／CSP 和公开登录配置。旧 `admin.js` 只在新加载的旧页面中升级到带版本的管理地址，保留 OAuth 返回参数和临时领取证明；它不会刷新已经运行的编辑器。部署后要实际核对新版入口可用，再向手机用户提供带版本的链接。Pages 的 HTML 仍可能缓存，不能仅凭源码构建成功认定手机已加载新版。

GitHub 回调的配置错误与明确拒绝授权分别显示，不再把所有 `error` 都当作取消；忽略上游未经验证的错误描述。[GitHub 授权错误说明](https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-authorization-request-errors)

修改应用设置或安装后可打开 Worker 的 `/ready` 页面重新进入仓库安装流程。图片托管设置中的“仓库授权”会显示当前图片仓库；保留博客仓库并添加图床仓库，保存后重新登录。不要取消 GitHub App 的短期用户授权设置。应用密钥加密保存在 D1，解密密钥是 Worker Secret；不要把任何密钥填入前端配置。

## 日志

生产配置保留应用事件日志并关闭逐请求调用日志，查询字符串开启脱敏。错误事件只记录固定服务名和事件码；不要记录 OAuth state、Cookie、令牌、请求体或上游原始错误。排查授权失败时同时核对 GitHub App 安装权限与部署版本，日志不能替代实际登录验收。

## 验证和更新

以下命令在 `<PROJECT_DIR>/auth-service` 中执行；使用原有受控绑定配置，不把模板当作生产配置。

```bash
npm ci
npm test
npx wrangler deploy --dry-run
```

GitHub 项目根目录的 `npm run test:publish` 同时验证登录服务与编辑器。更新登录协议时先应用兼容 schema、部署登录 Worker，再发布对应前端；实际部署必须使用带 DB 绑定的配套配置：

```bash
npx wrangler d1 execute DB --remote --config wrangler.local.json --file schema.sql
npx wrangler deploy --config wrangler.local.json
```

表结构更新使用 `CREATE TABLE IF NOT EXISTS`，保留现有应用配置与登录状态。文章公开发布与页面设置由内容服务的持久任务和同步工作流更新主站投影，Pages 工作流独立更新备用站；私密保存不进入公开 Git。详见 [现行维护流程](../docs/current-maintenance.md)。

参考：[GitHub App 授权](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[窗口跨域隔离与 Window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)、[Workers 免费额度](https://developers.cloudflare.com/workers/platform/pricing/)。
