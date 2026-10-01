# Howard 动态内容服务

主站：<https://howard-notes.howard-notes-login.workers.dev/howard-notes/>

Worker Static Assets 保存前端和编辑器资源，独立 D1 `howard-notes-content` 保存当前公开文库、预生成页面、搜索索引、页面设置和同步暂存。原始 Markdown 和历史仍由 GitHub 保存，文章图片继续使用 GitHub 图床。记忆卡使用同一个 D1 的独立表，保存内容、可见性和迁入的附件，不进入公开 Git 仓库、文章索引或 RSS。现有 `howard-notes-login` 和登录数据库独立保留。

网页发布：先提交 GitHub，再在维护者浏览器增量准备 Quartz 投影，服务端验证维护者、仓库写权限、分支当前提交、公开名单与原始文件 Git blob SHA，完整上传后切换版本。失败显示待同步并可重试，不重复提交 Git。公开请求读取预生成 HTML，不运行 Markdown 编译。

本地文库推送：`Synchronize published content` 工作流使用同一投影模块、已部署的页面模板及专用同步密钥更新内容，不执行完整 Quartz 构建。定时任务也可修复先前同步失败。工作流 token 只读仓库，只有匹配 Worker Secret 的专用同步密钥才可进入这条自动同步路径。

## 开发与部署

- `npm run test:publish`、`npx tsc --noEmit`、`npm run build`、`npm run verify:site`。
- `npm run content:sync`：当前 Git 提交必须已经推送到 main；本地复用 `gh` 的现有登录，不要求在网页粘贴令牌。
- `npm run build:cloudflare`：准备前端资源；使用 `auth-service/node_modules/wrangler/bin/wrangler.js deploy --config content-service/wrangler.json` 部署代码。
- 代码部署后 `npm run content:sync -- --update-shell` 更新渲染模板和当前页面（npm 参数最终由共享脚本读取）。
- `npm run content:seed` 生成公开投影和本地 SQLite 校验材料。远端初次迁移先配置小型页面模板，然后使用受保护的 `content:sync` 分块绑定参数上传；不要直接导入含大型 HTML 的 SQL，也不要用初始化 SQL 覆盖已有文库。
- `GET /howard-notes/api/content/status` 查看公开版本、Git 提交和更新时间；Cloudflare D1 Metrics 查看真实读写和容量。

文章只保留当前公开快照、一个供请求读取的前一快照和一个有期限的暂存版本；每次发布清理更旧快照，每小时清理过期上传。不会永久保存每次文章编辑或每次访问。JSON 源数据和索引同样只包含公开文章；文章图片不进入数据库。记忆卡独立保存当前内容，删除后在回收站保留 30 天，之后定时清理记录和无引用的迁入附件。SQL 删除后的文件大小可能不会立即缩小，释放页面可被后续数据复用。

GitHub Pages 保留静态回退版本。新主站内容更新以 D1 同步完成为准；静态回退站仍需要 GitHub Pages 构建。未来修改前端代码仍需要部署一次资源，普通文章、标签、专题和页面设置变化不需要资源部署。

## 记忆卡

`/howard-notes/memory/` 只有公共页面外壳，独立客户端按需加载；`api/content/memories` 实时读取数据，卡片视图固定每页 20 张，支持搜索、标签、排序、时间线。记忆卡写入立即反映在模块内，无需 Git 提交或重新构建页面。文章与记忆卡的标签分别统计。

首次部署新模块前执行 `memories-schema.sql`，只创建独立表和索引，不清空文章或记忆卡。已有 OAuth 权限不能使用 D1 文件导入接口时，去掉 SQL 注释后用 `wrangler d1 execute howard-notes-content --remote --command=<SQL> --config content-service/wrangler.json` 执行相同建表语句。

访客只能读取 `PUBLIC + NORMAL` 记录和它们引用的附件；`PRIVATE`、`PROTECTED`、已归档和回收站记录仅现有维护者账号可见。复用 HttpOnly 会话，GitHub Pages 回退站复用已验证维护会话的内存凭证。搜索、标签、分页计数和附件端点均在服务端应用同样的可见性限制，公共响应不包含原始元数据或私密关联。

Memos 导入通过受保护的 `memories/import` 和 `memories/import/files` 接口；来源地址与来源 ID 保证重跑不产生重复卡片，附件分块且校验 SHA-256。迁入 Markdown 原文、创建和修改时间保持原样；资源链接仅在显示时映射。密码仅从临时环境变量读取；导出内容和下载文件只放在忽略的 `.local/` 中。记忆卡保存在 D1，维护备份时应另外导出 D1，GitHub 的文章历史并不是记忆卡备份。

### Memos 0.22.5 全量迁入

`scripts/import-memos.mjs` 使用已核对的 [Memos v0.22.5 API](https://github.com/usememos/memos/tree/v0.22.5/proto/api/v1)。登录使用表单请求正文，兼容标准 `Set-Cookie` 和该版本网关的 `Grpc-Metadata-Set-Cookie`；密码不会进入请求地址。密码仅从 `MEMOS_PASSWORD` 环境变量读取；脚本只尝试登录一次，失败立即退出。源站 Cookie 只在内存中使用，外部附件及重定向不会收到源站 Cookie。日志只输出进度数量和 SHA-256，不打印正文、密码或令牌。

先导出并校验，不写目标网站：

```bash
read -rs -p "Memos 密码: " MEMOS_PASSWORD
export MEMOS_PASSWORD
node scripts/import-memos.mjs --export-only
unset MEMOS_PASSWORD
```

需要使用其他实例或账号时添加 `--source <origin>` 和 `--username <account>`。导出自动保存在忽略的 `.local/memos-import/<时间戳>/`；`--output` 只允许指定仓库 `.local/` 内的目录。密码、Cookie 和 GitHub 令牌不会保存到导出中。导出正文、原始 API 响应、附件、设置和元信息均保存在本地，文件权限为 `0600`。

导出分别使用 CEL 存储状态 `NORMAL` 和 `ARCHIVED` 遍历所有分页，明确开启 `include_comments`，覆盖该账号的独立卡片和评论记录。API 返回的 `ACTIVE` 映射为目标 `NORMAL`，原始枚举值保留在 `raw`。每张卡的资源、关联、评论和反应另行保存，迁入后通过仅维护者可见的 `raw` 字段完整保留。其他作者的评论保留在这些原始材料中，不改写成当前维护者的卡片。账号资源列表在该 API 版本中没有分页；脚本保存全部资源，包括未关联卡片的孤儿附件。下载原始附件，不请求缩略版本。

导出结束后再完整遍历一次卡片和附件元信息，检查来源是否变化；重复分页令牌、重复记录、缺失本人评论或附件长度不一致均使导出保持未完成状态。只有 `manifest.json` 标记完成且全部原文、元信息、原始响应和附件通过哈希校验的导出才可迁入。

在新模块已部署后，从完成的导出迁入：

```bash
node scripts/import-memos.mjs --import-from .local/memos-import/已完成的导出目录
```

该步骤不再需要源站密码。脚本复用 `gh` 的既有本地登录及 `.local/content-sync-key`，也支持维护环境已有的 `GITHUB_TOKEN` / `GH_TOKEN` 和 `CONTENT_SYNC_KEY`，不要求粘贴令牌。`--api <apiBase>` 可指定测试部署。

只读请求、附件下载和两种幂等导入接口遇到短暂网络失败时最多尝试三次，间隔 250/500 ms；登录请求和认证拒绝不会重试。下载中断也在重试范围内。日志按批输出导出和验证数量，错误只包含阶段及允许的网络错误类型，不包含来源地址或响应正文。

附件先按不超过 600 KiB 分块上传并校验，再以最多 100 张卡片及请求体积限制分批迁入。只有被卡片正文或附件列表引用的资源上传到 D1；孤儿文件完整保留在本地。附件保留来源所属卡片标识，供服务端执行私密附件权限检查。来源地址和来源 ID 保证重复执行幂等。迁入后逐卡校验原文、创建和修改时间、状态、可见性、标签、附件关联及完整原始元信息，并重新下载全部关联文件核对 SHA-256；通过后写入本地 `import-result.json`。Memos 的 `PRIVATE`、`PROTECTED` 和 `ARCHIVED` 不会被自动转为公开。

验证脚本：`node --test scripts/import-memos.test.mjs`，覆盖真实表单登录契约、两种 Cookie 响应、跨页、归档和评论、BOM/CRLF 原文、私密及外部附件、孤儿保存、上传分块、完整元信息、幂等、来源变化、篡改拒绝及单次登录失败。
