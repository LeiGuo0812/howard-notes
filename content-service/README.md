# Howard 动态内容服务

主站：<https://howard-notes.howard-notes-login.workers.dev/howard-notes/>

Worker Static Assets 保存前端和编辑器资源，独立 D1 `howard-notes-content` 保存当前公开文库、预生成页面、搜索索引、页面设置和同步暂存。原始 Markdown 和历史仍由 GitHub 保存，图片继续使用 GitHub 图床。现有 `howard-notes-login` 和登录数据库独立保留。

网页发布：先提交 GitHub，再在维护者浏览器增量准备 Quartz 投影，服务端验证维护者、仓库写权限、分支当前提交、公开名单与原始文件 Git blob SHA，完整上传后切换版本。失败显示待同步并可重试，不重复提交 Git。公开请求读取预生成 HTML，不运行 Markdown 编译。

本地文库推送：`Synchronize published content` 工作流使用同一投影模块、已部署的页面模板及专用同步密钥更新内容，不执行完整 Quartz 构建。定时任务也可修复先前同步失败。工作流 token 只读仓库，只有匹配 Worker Secret 的专用同步密钥才可进入这条自动同步路径。

## 开发与部署

- `npm run test:publish`、`npx tsc --noEmit`、`npm run build`、`npm run verify:site`。
- `npm run content:sync`：当前 Git 提交必须已经推送到 main；本地复用 `gh` 的现有登录，不要求在网页粘贴令牌。
- `npm run build:cloudflare`：准备前端资源；使用 `auth-service/node_modules/wrangler/bin/wrangler.js deploy --config content-service/wrangler.json` 部署代码。
- 代码部署后 `npm run content:sync -- --update-shell` 更新渲染模板和当前页面（npm 参数最终由共享脚本读取）。
- `npm run content:seed` 生成公开投影和本地 SQLite 校验材料。远端初次迁移先配置小型页面模板，然后使用受保护的 `content:sync` 分块绑定参数上传；不要直接导入含大型 HTML 的 SQL，也不要用初始化 SQL 覆盖已有文库。
- `GET /howard-notes/api/content/status` 查看公开版本、Git 提交和更新时间；Cloudflare D1 Metrics 查看真实读写和容量。

只保留当前公开快照、一个供请求读取的前一快照和一个有期限的暂存版本；每次发布清理更旧快照，每小时清理过期上传。不会永久保存每次编辑或每次访问。JSON 源数据和索引同样只包含公开文章；图片不进入数据库。SQL 删除后的文件大小可能不会立即缩小，释放页面可被后续数据复用。

GitHub Pages 保留静态回退版本。新主站内容更新以 D1 同步完成为准；静态回退站仍需要 GitHub Pages 构建。未来修改前端代码仍需要部署一次资源，普通文章、标签、专题和页面设置变化不需要资源部署。
