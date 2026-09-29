# Howard 的技术笔记

[网站](https://leiguo0812.github.io/howard-notes/) · [文章管理](https://leiguo0812.github.io/howard-notes/admin/) · [维护说明](https://leiguo0812.github.io/howard-notes/maintenance)

Quartz 5 + GitHub Pages。文章原文和发布设置分别保存，支持网页编辑与 Obsidian 双向同步。

## 原文保存规则

- `library/notes/` 保存原 Markdown 文件；首次迁移逐个校验 SHA-256，连原来的 YAML、注释、空行和 CRLF 换行都保留。
- `library/catalog.json` 保存独立的标题、专题、标签、固定网址、发布日期和发布状态。
- `library/assets/` 保存从网页或本地加入的附件。既有外链图片保持原地址。
- `content/` 是构建时生成的渲染副本，不提交到 Git。双链、锚点等显示适配只作用于此副本，不写回原文。
- `.gitattributes` 为文库关闭换行归一化，防止 Git 悄悄改动源文件。

首次批量迁移包括 172 篇技术与学习笔记。未选笔记、内部资料及本机同步配置不在此仓库；详细迁移清单保存在原 Obsidian 库的“博客发布”目录。

## 网页维护

打开 `/admin/`，用仅授权本仓库的 GitHub Fine-grained token 登录，需要 `Contents: Read and write` 权限。令牌仅保存在页面内存中，不写入 localStorage、源文件或服务器。

管理页面提供文章搜索、原文编辑、基础 Markdown 预览、图片上传、专题和标签设置，以及发布/草稿切换。新文章默认草稿，网址在首次保存后固定。发布设置独立保存，不改写 Markdown 的 YAML 或正文。预览只覆盖基础 Markdown，公式、双链和 Mermaid 以正式网页为准。

每次保存会重新读取远端版本，检查原文的 Git blob SHA 和文章设置是否改变。原文、图片和目录在同一个 Git 提交中保存，分支更新始终 `force: false`。发生冲突时保留当前编辑，先下载原文再重新载入。

**这是公开仓库。** 草稿/撤下只影响网站展示；原文和 Git 历史仍可访问。未准备公开的私人草稿请保存在本地公开文库以外。

## 本地安装和预览

使用同一套 Linux/WSL 环境中的 Node.js 24+ 和 npm 10.9.2+。

```bash
npm ci
npm run test:publish
npm run build
npm run verify:site
npm run preview
```

预览：`http://localhost:8080/howard-notes/`。`npm run dev` 支持生成目录的预览监听；修改 `library/` 后需重新运行 `npm run export` 生成内容。正式构建总是先生成内容、再构建网站和管理入口。

## Obsidian 双向同步

在 Obsidian 中使用独立的公开文库目录，目录结构与 `library/` 相同：`notes/`、`assets/` 和 `catalog.json`。已导入笔记保留原来的分类目录。

在网站工程创建仅本机使用的 `.local/sync-config.json`：

```json
{
  "directory": "/path/to/Obsidian/博客发布/原文库"
}
```

首次初始化（会检查已有文件，不覆盖不同内容）：

```bash
npm run sync -- --init --apply
```

日常先预览，再同步：

```bash
npm run sync
npm run sync -- --apply
```

建议开始写作前、完成写作后各同步一次。网页不能直接访问电脑中的笔记；电脑没有执行同步时，网页修改保存在 GitHub，等待下次拉取。

同步会获取 GitHub 最新版本，并比较上次同步、本地和远端三份文件：

- 只有一端修改：按字节同步到另一端。
- 两端修改不同文件：合并到一起。
- 同一文件两端同时修改：停止同步，在 `.sync/conflicts/<时间>/` 保存 LOCAL、REMOTE、BASE 三份副本。
- 检测到删除：默认停止；确认后显式加 `--allow-delete`。
- 回写本地前检查是否又发生编辑，并将被替换文件备份到 `.sync/backups/`。

发布到 GitHub 前运行网站构建与检查。检查失败时回退工具在网站工程内的改动，保留 Obsidian 原文和上次同步基线。推送遇到并发提交时不会强制覆盖，需处理 Git 分歧后重试。

### 在 Obsidian 新增文章

将新 `.md` 放在公开文库的 `notes/` 中，运行：

```bash
npm run sync -- --include-new
npm run sync -- --include-new --apply
```

新笔记默认登记为草稿，随后可在网页中补充专题并公开。若新笔记原本含布尔属性 `publish: true` 和 `draft: false`，首次登记时会采用公开状态；登记后发布状态以独立目录为准。`--include-new` 表示允许新文件进入公开 GitHub 仓库，即使它暂不展示在网站中。

### 冲突恢复

打开 `.sync/conflicts/<时间>/` 对照三份副本，将需要的内容合并进 Obsidian 文件。若仍需以本地解决后的版本为准，应先保存冲突副本，再让对应的 `.sync/base/` 文件等于本次 REMOTE 副本，重新预览同步。不要用强制推送解决内容冲突。也可以请维护工具根据三份副本协助合并。

网站工程必须是干净的工作区，且能快进到 `origin/main`。不要一边修改网站代码一边运行笔记同步。

## 构建与部署

`main` 更新后 GitHub Actions 自动执行：依赖安装、发布与同步测试、TypeScript 检查、网站构建、页面/索引/附件验证和 Pages 部署。失败时保留上一版线上站点。

网站内部链接验证覆盖全部生成页面；源笔记中不完整的本地引用会保留显示文字，记录到本机 `.local/render-report.json`。不批量改写或下载外链图片，也不以迁移为由修订原笔记中的命令或结论。

框架基于 Quartz commit `97a2d05f80c4c50534959b1d0d41cc4b3895625e`，依赖由 `package-lock.json` 固定。上游框架沿用 MIT 许可，见 `LICENSE.txt`。文章及引用资料的来源说明以原笔记为准，未额外授予开放许可。
