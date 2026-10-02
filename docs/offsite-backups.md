# 私有 GitHub 离站备份

现有 Cloudflare 自动备份保存十张规范内容表和私密 R2 原文件。离站任务复制已完成的 `.hnbackup` 密文，同时归档公开网站与图床的完整 Git 历史，以及私有仓库中的交接材料。原文章、可见性、图床地址和恢复密钥均不修改。

## 权限与存放位置

- 新私有仓库的定时工作流调用 `scripts/offsite-backup.mjs`，普通文档放 `handoff/`，大型文件放 Releases，不进入 Git 文件树或 Actions artifact。
- 内容 Worker 的独立 `BACKUP_EXPORT_KEY` 只允许 `GET api/content/backups/export/status` 和 `GET api/content/backups/export/download?id=<SNAPSHOT_ID>`；请求头为 `X-Howard-Backup-Key`。
- 它不能启动备份、读取私密原文、访问任意 R2 对象、编辑或发布文章，也不能借用维护者会话。原 `X-Howard-Sync-Key` 不获得备份权限。
- GitHub Actions 只持上述导出凭据和当前私有仓库的临时 `GITHUB_TOKEN`，不持 `BACKUP_SECRET` 或所有者个人令牌。解密恢复仍在可信设备进行。
- 仓库必须为私有；运行器先核对仓库身份与可见性。公开源码和图床 Git bundle 本身不重新加密；私密内容和登录恢复材料始终为密文。

## 日常任务

私有工作流每天 UTC 18:23（北京时间次日 02:23）计划运行，并提供 `workflow_dispatch` 手动补跑。GitHub 定时任务可能延迟，失败应在 Actions 中检查，不把计划时间当作成功时间。

配置示例：

```json
{
  "version": 1,
  "siteBase": "https://<SITE_HOST>/<SITE_PREFIX>/",
  "sourceRepositories": ["<OWNER>/<SITE_REPOSITORY>", "<OWNER>/<IMAGE_REPOSITORY>"],
  "handoffDirectory": "handoff",
  "retention": { "dailyDays": 30, "monthlyMonths": 12 }
}
```

```bash
node scripts/offsite-backup.mjs \
  --config "<PRIVATE_BACKUP_CHECKOUT>/backup.config.json" \
  --materials "<PRIVATE_BACKUP_CHECKOUT>/handoff"
```

`PRIVATE_BACKUP_REPOSITORY`、`GH_TOKEN`、`BACKUP_EXPORT_KEY` 由受控环境提供。不要把实际密钥放入命令参数、文档、Git 文件或日志。服务器最新成功快照超过 48 小时时任务失败，保留先前成功副本；不会伪称下载了当前编辑内容。

运行器同时固定可信站点和两个公开来源仓库，防止误配把导出凭据发送到其他网站。在新账号复用时，除修改上述配置，还需审查并修改 `scripts/lib/offsite-backup.mjs` 中的受控允许列表；只修改 JSON 不能绕过此保护。

Git bundle 包含所有克隆到的 refs，归档只在 refs 发生变化时新增。当前树 tarball 不能替代完整历史，图床固定提交链接也需要相应历史。上传先进入草稿 Release，远端重新下载核对 SHA-256 后才发布完整收据；已有成功副本在失败时保留。内容快照保留近 30 天及最多 12 个有备份月份的代表，不删除其他用途的 Releases。不可变源码和图床归档长期保留，会随历史变化增长。

密文帧检查与传输 SHA 验证不等于解密恢复。每隔一段时间仍需用原恢复密钥在新隔离目录运行 `backup-verify.mjs`，检查数据库和附件实际可恢复。

## 登录恢复材料与交接

`handoff/login-recovery.hnbackup` 使用原 `BACKUP_SECRET` 加密，包含已有登录开通配置、实际资源绑定与登录 D1 中 `app_config` 的加密配置行；原 `ENCRYPTION_KEY` 与该行配套保存，以便恢复原 GitHub App。它不是 OAuth 数据库全量备份，不保留临时会话，也不包含所有生产 Secrets。重新配置会话或同步凭据后需要重新登录及更新关联配置。

```bash
node scripts/restore-login-materials.mjs \
  --input "<LOGIN_RECOVERY_BUNDLE>" \
  --output "<NEW_PRIVATE_RECOVERY_DIRECTORY>"
```

原 `BACKUP_SECRET` 仅由受保护环境注入。输出 `login-bootstrap.json`、`login-resource-bindings.json` 与 `login-app-config.json` 属于敏感材料，只进入新的私有目录；工具不覆盖生产文件或现有目录，也不自动部署登录服务。旧的两文件包仍可读取，但不包含原 App 配置。接手既有实例时不盲目重跑初始化或重新生成配套密钥。

新 Codex 先读取私有仓库 `handoff/ASSETS.md`、`CODEX-HANDOFF.md`、`RESTORE.md` 和复现指南，再依据最新已完成 Release 的 manifest 获取对应源码、图床和内容备份。本地文档变化需要先同步进私有仓库；云端任务不会读取维护者电脑的任意文件。

外部 OSS/语雀等未迁入图床的图片、原 Obsidian 软件配置、全部登录数据库、账号恢复码和各类历史本机缓存不会因为本任务自动得到完整备份。恢复密钥另存密码管理器或离线介质；同一个 GitHub 账号内的多个仓库不能覆盖该账号整体不可用的风险。正式远端整站恢复仍应先在新的 staging D1/R2 验证后再切换，当前没有一键远端恢复工具。
