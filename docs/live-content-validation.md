# 动态内容上线验证记录

日期：2026-10-01。主站：https://howard-notes.howard-notes-login.workers.dev/howard-notes/。

## 已执行

- `npm run test:publish`：202 项 Node 测试、33 项 TypeScript/渲染测试通过。
- `npm run check`：TypeScript 和全仓库 Prettier 检查通过。
- `npm run build`、`npm run verify:site`：297 个静态 HTML、172 篇文章、RSS 和搜索校验通过。
- 实际部署登录服务、内容 Worker 和 Static Assets，受保护分块同步了 172 篇公开文章及 262 个动态路由。
- 实际读取线上公开快照，逐篇核对原文和 Git blob SHA：172/172 与本地原文件一致；`library/` 没有迁移产生的改动。
- 线上 RSS 172 篇，站点地图 261 条（排除 404），搜索包含全部公开笔记及目录入口。
- 首次同步发现 Cloudflare 不支持 `fetch` 的 `redirect: "error"`，改为 `manual` 并拒绝重定向；回归测试覆盖凭据不会发送到重定向目标。
- 移动端最长文章发现动态页面缺少原有 `#quartz-body` 容器，已补回，并对全部动态路由增加结构检查。
- 公开版本原子切换、私有文章过滤、源哈希验证、同步替换/过期清理竞争、删除后 404、Unicode 标签、分页别名均通过服务测试。
- 本地浏览器模拟 Git 写入验证 36 项维护场景，包括发布期间继续输入/预览、后续输入保留、草稿不影响公开文、删除、设置、同步失败重试不产生重复提交。真实 Git 写入为 0。
- 本地浏览器检查 390、768、1440px、浅色与深色、首页/列表/专题/标签/长文/搜索，并验证主站维护窗口在页面更新后保留正文、光标和拖拽/全屏功能。
- 真实 Cloudflare 站点 Chromium 检查 30/30 项通过：390、768、1440px 两种主题，20 篇分页、排序/筛选、专题、标签、搜索、关系图谱、74 项长目录、最长文章和正文居中；未发现横向溢出、JavaScript 异常或资源加载失败。
- 在实际压缩后的浏览器渲染模块中检查组件标识，修复函数名被压缩改写导致的图谱/目录外壳遗漏，并增加压缩构建回归测试。
- 页面设置中的标识和强调色直接生成当前 SVG 标签图标，静态 ICO/PNG 保留作兼容回退；原默认 SVG 与哈希保持不变。
- 临时移除被 Git 忽略的生成数据，在首次构建前执行全部 235 项发布测试，均通过；纯运行时页面模块不依赖本地生成的文库 JSON。

## 验证范围

编辑发布与删除使用模拟 Git 接口，未删除、改写或新建用户真实笔记。真实服务器写入只执行已授权的公开文库迁移与页面模板同步。未使用用户 Android 实机再次完成 GitHub 授权；登录协议和两个站点来源的回归测试已执行。

构建仍提示原笔记中个别公式的 Unicode 兼容性以及循环嵌入；保留原文及现有循环处理规则。13 个原始来源缺失的引用保留为文本。

浏览器截图与详细过程保存在本地 `output/playwright/`（忽略提交）；公开维护指南见 `content-service/README.md`，架构计划见 `docs/live-content-plan.md`。

真实站点截图包括 `live-runtime-home-light-1440.png`、`live-runtime-home-dark-390.png`、`live-runtime-long-note-light-390.png`、`live-runtime-search-mobile.png`；检查明细为 `live-runtime-report.json` 与 `.txt`。

## 容量与免费额度

一份当前公开文库（包含 Markdown、压缩解析缓存、渲染 HTML、索引和设置）约 16MB。数据库仅保留当前、上一版和最多一个有时限的同步暂存；不会无限保留编辑历史或逐次阅读记录。删除旧版本后数据库文件可能保留可复用的空闲页。

上线实测：第 2、3 版正文数据分别为 15,929,883 和 15,937,219 字节，D1 返回数据库文件大小 32,739,328 字节（约 32.7MB）。第 1 版已清理，暂存会话已结束。

免费 D1 单库上限 500MB、账户总量 5GB，每天 500 万行读取与 10 万行写入。免费 Worker 另有请求、CPU 和子请求上限，容量不是唯一指标。本次未开通付费服务；不保证任意流量或任意大文章均在免费限制内。

官方依据：https://developers.cloudflare.com/d1/platform/limits/ 和 https://developers.cloudflare.com/d1/platform/pricing/。
