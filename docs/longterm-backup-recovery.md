# 网页主维护：备份、离站副本与恢复演练

## 覆盖范围和边界

`content-service/backups.mjs` 自动备份十张规范内容表：记忆卡、记忆卡附件与关联、私密文章、文章历史、服务端恢复稿、恢复稿历史、私密附件与关联。公开页面 HTML、搜索投影、同步临时会话、登录服务数据库和发布任务凭据不进入此备份。公开内容可以从 Git 原文重新生成；未完成发布任务可在恢复私密原文后重新发起。

`PERSONAL_FILES_BUCKET` 中的私密原文件同时进入加密备份。原文件按 SHA-256 去重，备份按 256 KiB 分块加密，调用按预算复制有限分块，进度持久保存。同一原文件仅保留一组独立加密对象。记忆卡既有 GitHub 公开附件的字节由图床仓库离站归档保护，数据库备份保留其固定提交和完整指针。

备份 R2 bucket 必须保持私有，不启用 `r2.dev` 或公开自定义域名。它与 D1 分开，但仍处于同一个 Cloudflare 账户，不能当作账户故障或账户失窃时的独立保护。将加密导出复制到另一台设备或另一个服务商，才有离站副本。加密密钥必须另行保存；既不能只留在 Cloudflare，也不能与备份文件放在同一份公开仓库。

## 一致性与加密

数据库使用编号迁移；`migrations/0001_initial.sql` 幂等安装现有基线。每张规范表都有写入触发器，递增唯一的 `backups_epoch.generation`。每轮先强制检查十张规范表齐全以及实际 INSERT/UPDATE/DELETE 触发器定义；缺表、缺 guard 或被改成空触发器都会拒绝备份。备份开始与结束的 generation 必须完全一致；任何同时发生的写入都会使当前副本失效并重试。它不会暂停维护者的正常写入，也不会将不一致的分页快照标记为成功。

每页独立使用 AES-256-GCM，加密头包含经过认证的对象上下文，使用随机 96 位 IV。每页和附件均记录 SHA-256、原始字节数和行数。完整 manifest 最后写入；缺少 manifest 的目录不算可恢复备份。规范表分页有受限的 D1 查询预算，任务进度在 R2 中加密保存，大型文库可以由后续定时调用继续处理。

`BACKUP_SECRET` 是 32 字节随机值的 base64url 表示，仅通过环境变量或 Worker secret 提供。不要写入代码、URL、命令参数、日志、截图或公开 Git 历史。更换密钥前先保留旧密钥并重新加密历史副本；直接替换 secret 会使旧副本无法解密，也会使跨快照复用附件失效。

默认保留最近约 30 天内的全部完整副本，以及最近 12 个实际有备份月份的代表副本；不是严格最多 30 份，也不保证连续 12 个自然月。不可变附件独立存放，普通保留清理不会误删历史快照引用的字节；每周的附件清理会先核验全部保留 manifest 和未完成备份，只有不再被任何副本引用且至少存放一天的对象才会删除。无法解密或发现 manifest 不完整时停止清理，不能只根据当前文章是否还存在来删除。清理失败也不会删除本次已验证的完整备份。

## 网站维护者入口

网页状态、运行和下载 API 使用现有维护者登录权限，响应均为 `private, no-store`。私库定时任务另用 `BACKUP_EXPORT_KEY` 访问受限导出接口，只能读取既有完整密文及必要状态，不能触发备份或读取原文。

网页入口为主站登录后的“页面设置”底部“备份与恢复”，提供“立即备份”“下载加密备份”“刷新状态”，并显示过期状态、重启次数、最近耗时、私密附件登记用量和发布任务积压。未直接关联目录的附件仍可能被原文或历史引用，只统计、不自动删除。页面设置上方的“导出”只导出布局配置，不是内容备份。主动开始后，弹窗每约 5 秒检查并续跑；关闭网页后服务器 Cron 继续；Cron 本身不把文件下载到本机，私库 Actions 按独立计划复制完整密文。

- `GET <SITE_BASE>/api/content/backups/status`：配置状态、最近成功备份、当前进度和失败状态。
- `POST <SITE_BASE>/api/content/backups/run`：`{"action":"start"}` 开始或续跑一次备份，`{"action":"continue"}` 只继续进度，不在当天已完成后新建另一份；生产 Worker 通过执行上下文后台执行受限的一步，返回接受状态。
- `GET <SITE_BASE>/api/content/backups/storage`：只读附件登记数量/去重字节、历史数量与任务队列汇总，不返回正文或可删除结论。
- `GET <SITE_BASE>/api/content/backups/download`：下载最新完整加密备份包。
- `GET <SITE_BASE>/api/content/backups/download?id=<SNAPSHOT_ID>`：下载指定完整备份。

下载文件为带边界帧的二进制加密对象包，直接流式传输 R2 密文，不作整包 Base64 编码，不能直接当 Markdown 打开。下载不携带加密密钥。匿名及自动同步密钥不能访问这些维护者接口；离站导出键仅可访问独立的 `backups/export/status` 与指定快照密文下载接口。R2、D1 或网络故障会保留此前成功副本，状态会显示本次未完成，不能把“已接受任务”当作备份成功。

默认调用保留 8 次逻辑查询预算、最多四个非空数据页；网页手动调用仍限制一个非空数据页；每分钟 Cron 使用 12 次逻辑查询、最多 6 个数据页、4 个附件分块和 8 秒软时限，在页边界保存进度。普通页最多 25 行。D1 对接下来最多 25 条候选计算 JSON 字节数与累计长度，只返回预算约 128 KiB 内的记录；一篇大笔记不会使整张表都变为单条分页，也不会先把全部大正文返回 Worker 再筛选。首条超过预算时允许单条继续；附件元数据一页仅一条。页结束还需 generation 检查及取得、释放任务锁，因此实际 SQL 总数多于逻辑读取预算，查询数按每种调用预算分别验证；时限不能替代平台 CPU 限制。已有进度按原快照编号继续，重复点击开始不会丢弃同代进度。过大的单条正文仍无法靠行分页拆分，不能把估算目标当作单行大小上限或 CPU 保证。

## 已配置的 GitHub 离站自动化

私有 GitHub 仓库的 Actions 每天 UTC 18:23 计划执行，保存服务器已完成内容密文、交接文档及源码/图床的完整 Git bundles。它无需维护者电脑在线，也不取得原恢复密钥或 owner PAT。服务器快照超过 48 小时则停止；上传后重新下载核对 SHA-256，写完收据才发布 Release。失败保留之前的完整副本。

快照保留近 30 天及最近 12 个有备份月份的代表；仓库全部已获取 refs 改变时生成新不可变归档；只清理无保留快照引用、并在最后引用消失后完成至少 30 天隔离的已验证归档。目录和操作见 [离站备份](offsite-backups.md)。GitHub 已是第二个服务商目的地，但源码、图床与私库仍属于同一个账号，独立离线副本及账号恢复材料仍有价值。自动复制不会代替可信设备上的真实解密恢复。

## 可选：可信设备加密离站导出

在可信设备安装项目所用 Node.js、GitHub CLI，并完成已有账号登录。下面使用通用路径；`BACKUP_SECRET` 预先由密码管理器或安全环境注入，不在命令中写真实值。

```bash
node --use-env-proxy scripts/backup-export.mjs \
  --output "<NEW_PRIVATE_EXPORT_DIRECTORY>" \
  --repositories "<OWNER>/<SITE_REPOSITORY>,<OWNER>/<IMAGE_REPOSITORY>" \
  --site "https://<SITE_HOST>/<SITE_PREFIX>/"
```

脚本固定每个仓库的完整 Git commit，下载对应 tarball，并流式加密；输出目录包含加密仓库归档、加密导出 manifest 和网站的完整加密数据包。原文与图床归档保存当前树，完整 Git 历史仍由原仓库或另外的裸 Git 镜像保护。输出目录必须为新目录，已有文件不会被覆盖。

`backup-export.mjs` 本身不触发新网站备份，只下载服务器最近一次成功副本；需要刚编辑完的内容时，先在网页等待新的成功时间，或执行 `backup-live-verify.mjs`。可用 `--snapshot <SUCCESSFUL_SNAPSHOT_ID>` 下载指定完整快照；不传 `--site` 时只归档 Git 仓库。复制离站副本时保留整个加密导出目录及 manifest，恢复密钥分开保管。

这条命令适合可信设备定期执行。自动化环境需预先配置维护者授权、加密密钥和独立目的地，不能把私密内容当成公共 GitHub Actions artifact 发布。网页端原文维护不再依赖本地 Obsidian 同步；本机用途为加密备份、恢复验证及必要的单向导出。

## 恢复演练：私密规范数据

可信 Node 设备可主动执行分步生产备份、锁定刚完成的快照下载，并立即在本机隔离恢复。仍需预先通过安全环境提供 `BACKUP_SECRET`；维护授权从已有 GitHub CLI 登录取得，仅留在内存。输出必须是新目录。

```bash
node --use-env-proxy scripts/backup-live-verify.mjs \
  --site "https://<SITE_HOST>/<SITE_PREFIX>/" \
  --output "<NEW_PRIVATE_RESTORE_DIRECTORY>"
```

此工具初次只发送一次开始，后续全部续跑，遇到失败立即停止；进度长期不动会到期退出，保留服务器检查点，不无界强制重试。报告记录完整密文包的 SHA-256、恢复行数、私密文件字节数及原文字节验证结果，不写令牌、密钥或正文。

输出同时包含密文 `snapshot.hnbackup` 和明文 `restored.sqlite`、`private-files/`。只复制密文及不含正文的验证报告到独立目的地；不要把整个隔离恢复目录误当作全加密导出目录。

```bash
node scripts/backup-verify.mjs \
  --bundle "<ENCRYPTED_BACKUP_FILE>" \
  --staging "<NEW_PRIVATE_RESTORE_DIRECTORY>" \
  --output "<PRIVATE_VERIFICATION_REPORT>"
```

验证器解密至新的本地 staging SQLite，检查每页密文认证、SHA-256、字节数、行数、表结构及 SQLite 完整性。插入后再次读取每条记录，比较原始 JSON 的 SHA-256，确认中文、BOM、CRLF、原文、版本、时间和可见性均未被改写。私密原文件在独立 staging 子目录中恢复并核验完整文件 SHA-256。

该工具不会覆盖生产 D1，也不会连接登录数据库。演练目录含明文私密笔记，权限应保持 0700 / 0600，不可上传公开仓库。校验失败时不要导入生产。首先保留报告，排查缺失对象、错误密钥、篡改或源文件不完整，再选择更早的完整副本。

正式灾难恢复应先恢复到新的 D1 与新的私有附件 bucket，部署匹配版本代码，核对规范数据及权限，并在 staging 完成私密访问、公开切换和编辑回归后，再切换绑定。使用原加密包作为恢复输入，保留故障时的现有数据库，不以“重建生产库”为日常验证手段。

## 离线准备新的云端恢复目标

通过上一节校验，取得 `restored.sqlite` 与 `private-files/` 后，可先生成独立、可复核的恢复分片计划。这一步不需要再次提供恢复密钥，不调用云端，也不写入现有 D1 或 R2。

准备一份仅描述新目标的 JSON 配置。Worker、数据库与私有附件 bucket 的名称都必须含有独立的 `restore` 或 `staging` 单词；数据库 ID、名称及 bucket 不得等于当前生产配置。只允许一个 `DB` 和一个 `PERSONAL_FILES_BUCKET` 绑定，禁止路由和定时任务。例如：

```json
{
  "name": "notes-restore",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "notes-restore-content",
      "database_id": "<NEW_DATABASE_UUID>"
    }
  ],
  "r2_buckets": [
    {
      "binding": "PERSONAL_FILES_BUCKET",
      "bucket_name": "notes-restore-private-files"
    }
  ]
}
```

示例 UUID 是占位符，实际准备时必须换为新目标的有效 ID。工具只检查配置与生产资源不同，**没有联网确认目标存在或为空**。

```bash
node scripts/prepare-cloud-restore.mjs \
  --database "<PRIVATE_RESTORE_DIRECTORY>/restored.sqlite" \
  --private-files "<PRIVATE_RESTORE_DIRECTORY>/private-files" \
  --target "<PRIVATE_CONFIG_DIRECTORY>/restore-target.json" \
  --output "<NEW_PRIVATE_RESTORE_PLAN_DIRECTORY>"

node scripts/prepare-cloud-restore.mjs \
  --verify "<PRIVATE_RESTORE_PLAN_DIRECTORY>"
```

计划检查 SQLite 完整性、十张规范表和每个已完成私密原件的 SHA-256，生成不超过 128 KiB 的分片及 manifest。带类型的逐行编码保留原文、BOM、CRLF、空字符、ID、日期、可见性与历史记录，64 位整数不经浮点转换；独立验证逐片、逐表与逐原件的字节数和哈希，并检查行数。当前源库及文件不会被修改；已有输出目录不会被覆盖，失败时仅清理本次新建的输出目录。

**计划包含私密明文**，不是加密备份。新目录及文件分别设置为 0700 / 0600，应放在可信设备的受保护位置，不上传公开仓库；验证报告仅输出数量与验证状态。`cloudAccessed: false`、`cloudWritesPerformed: false` 和 `cloudTargetEmptyVerified: false` 是正常结果，表示它只完成本机恢复准备。

当前没有自动将这些分片写入远端的执行器。真正恢复还必须确认新 D1/R2 为空，安装对应编号迁移，完成可断点重试的写入和逐行/原件回读哈希，再验证登录、私密访问、公开发布与编辑，最后才切换网站绑定。上述命令成功不等于已完成云端恢复，也不能代替隔离云端演练。

## 恢复演练：GitHub 原文与图床

```bash
node scripts/backup-archive-verify.mjs \
  --directory "<ENCRYPTED_EXPORT_DIRECTORY>" \
  --staging "<NEW_PRIVATE_ARCHIVE_RESTORE_DIRECTORY>" \
  --output "<PRIVATE_ARCHIVE_REPORT>"
```

验证器检查加密导出 manifest、仓库身份和固定 commit，流式解密每个 tarball，核对完整 SHA-256 及字节数，并实际解析压缩归档目录。它不向 GitHub 写入，不展开不可信路径，也不改变目前网站。恢复后的原文可重建公开站点；图床恢复时要保留或重建文章中的固定提交链接映射。

## 长期运行检查

当前调度配置每分钟唤醒一次，每轮仍仅执行有界备份步骤；完整副本已经在当天形成时，后续调用直接返回当前状态，不重复扫描全部正文。另设每小时的维护时段处理清理。发布、备份和每小时清理分别执行，一项失败不会阻止其他项开始。该配置缩短分步备份与发布任务的等待，不增加账号付费套餐，也不等于实时一致快照：持续写入会改变 generation，完整备份仍需要足够的静默窗口。离站 Node 主动续跑工具可以更快完成，并同时留下可独立恢复的密文副本。

每周检查服务器和私库 Actions 最近成功时间，确认没有持续失败或进度长期不前；每月检查用量，按需要另存一套完整离线副本，并定期执行 staging 恢复验证。大规模导入前、权限切换前、数据库结构升级前额外创建完整副本。备份失败不阻止日常写入，但必须显示失败，不能用浏览器恢复缓存或 30 天回收站代替长期备份。

跨服务商离站任务已由私有 GitHub Actions 承担。额外邮件/消息渠道以及电脑/NAS 自动同步未配置；GitHub 通知取决于维护者账号设置。要新增目的地，先明确密文范围、权限、保留策略与密钥独立保管方式。

Workers Free 还有 CPU 时间限制，不能仅凭查询数在预算内就认定大文库一定能在单次调用完成。上线后应验证实际 CPU 与成功副本；默认已采用分步调用，可信 Node 自动化设备也可主动续跑。单条超大原文、大量历史或超大完整下载仍可能触及 CPU、内存及子请求限制；发生此类错误应改为离站只读导出/恢复路径或进一步拆分，不无界重试。不得在未经授权时更改账号付费方案。[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)

新增规范表时，同时更新 `BACKUP_TABLES`、写入触发器和恢复测试。新增字段无需修改每条插入代码，manifest 会保存实际列与 schema。新增包含凭据的运维表必须明确排除，不得因“全库备份”把短期发布令牌变成长存储数据。
