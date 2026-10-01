# 登录有效期的服务器时间校验

日期：2026-10-01。用户曾成功登录，随后重登提示“登录返回信息不正确，请重新登录”。本次不修改笔记、目录或页面设置。

## 根因与复现

报错仅在 `/result` 返回 200 后，前端 `acceptsResult` 校验失败时出现。服务器原来生成 `expiresAt = Date.now() + expires_in * 1000`，前端却要求它不超过手机的 `Date.now() + 28800000`。这比较了两个不同的系统时钟。

GitHub 的短期用户令牌返回完整八小时寿命，之前测试多数使用一小时，掩盖了上界错误。[GitHub 官方说明](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

已用实际旧后台包复现：手机时间慢五秒时，首次返回等待六秒会成功；随后两次快速登录均得到用户报告的完整错误。每次 `/result` 仅领取一次，临时证明正常清理。首次资源加载较慢、后续缓存较快可能解释用户现象；没有读取实体手机时间，所以这个设备层面的解释仍属推断。

## 修复

Worker 在结果领取时附加新鲜的 `serverTime`，覆盖任何旧的存储时间戳。客户端只按同一服务器时钟验证 `0 < expiresAt - serverTime <= 28800000`，保留类型、请求标识、令牌长度和账号校验。错误结果仍使用限定长度的消息，不接受错误来源或错误请求。

到期时间从 GitHub token 兑换请求发出前保守计算，后续所有者与仓库权限检查不延长寿命。领取时凭据已经过期，只返回明确错误并消费结果，不回传令牌。新鲜时间戳在领取时生成，因此原有 D1 加密结果也能使用，无需迁移表结构。先部署 Worker，再发布新前端。

## 已执行验证

- `npm run test:publish`：107 项通过，包含 16 项客户端授权和 32 项 Worker 测试。
- 手机时钟与交付速度矩阵：快慢一小时范围、20ms 至六秒延迟均接受合法八小时令牌；过期、超期与错误时间字段仍拒绝。
- Worker：新鲜时间戳覆盖旧值、过期结果无令牌、权限检查耗时不延长寿命、一旦领取不能重放。
- 完整 Android Chrome 浏览器模拟：手机慢五秒、快五秒两组均连续初登／退出／重登三次成功，并分别完成一次保留未保存正文及布局的重新认证。重认证通过受控 COOP 断链；无运行错误，无 GitHub 写入。
- `npm run check`、`npm run build`、`npm run verify:site`：通过，297 个 HTML、172 篇文章、RSS、搜索索引与后台版本／CSP 正常。

完整账号授权和 API 使用回归夹具，未代用户在实体手机输入 GitHub 账号或完成真实授权。所有者及仓库写入权限校验、八小时上限和凭据仅留内存的限制保持有效。

修改文件：`admin/auth.mjs`、`admin/auth.test.mjs`、`auth-service/worker.mjs`、`auth-service/worker.test.mjs`、`auth-service/README.md`。

本机记录：`.local/android-clock-baseline-check.js`、`.local/android-clock-new-check.js`、`.local/android-clock-ahead-new-check.js`；截图 `output/playwright/auth-clock-old-attempt-2.png`、`output/playwright/auth-clock-new-attempt-2.png`、`output/playwright/auth-clock-new-dirty-reconnect.png`。验收资料不进入网站公开资源。
