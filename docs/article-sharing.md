# 文章分享与导出

公开文章的访客和维护者均可使用阅读页右上角的分享图标。登录后的私密阅读页提供相同入口。分享的是当前阅读文章；编辑器中的未发布修改稿不会替代已发布原文。

## 操作

选择 PDF、长图或 Markdown；“附上原文链接”每次打开默认不勾选。该选项只控制导出时新增的来源链接，不移除笔记本来就包含的链接，也不改服务器或 Obsidian 原文。

桌面选择格式后点击“导出并下载”。弹窗立即收起，左下角显示生成进度；正常完成后下载文件，生成期间仍可阅读和滚动。含无法导出的图片或图形时先显示具体提示，由用户点击下载，不自动交付遗漏内容而不说明。

手机点击“生成分享文件”，完成后在左下角点击“分享文件”，打开系统分享面板。准备阶段只在浏览器内存生成 `File`，网站不主动下载；系统如何临时保存或转交文件由浏览器和操作系统管理，不能承诺系统内部完全不产生缓存。先生成再点击分享可以保留 [Web Share API 要求的临时用户激活](https://www.w3.org/TR/web-share/)。

使用 `navigator.canShare({ files: [file] })` 单独检测文件分享能力；不能加入标题或 URL 来制造支持文件分享的假阳性。系统取消分享后保留重新分享、下载、关闭选项，不擅自下载。不能分享该文件类型时明确提供“下载”；Markdown 另可在支持时选择“分享文本”，它分享原文文本，不是假装发送 `.md` 附件。文件类型、大小和分享目标由当前系统决定，不能保证每个浏览器和应用均接受 Markdown 文件。

## 导出内容与限制

| 格式     | 内容及实现                                                                | 实际边界                                                                                                |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Markdown | 读取规范原文并用 `TextEncoder` 编码为 UTF-8；默认不追加标题、元信息或来源 | 保留 BOM、CRLF、围栏和原始链接；原有相对附件地址不重新打包或改写                                        |
| PDF      | 900px 阅读排版按 A4 分页，逐页生成高质量图像并加入 PDF                    | 中文、代码、表格、公式和完整 Mermaid 图形可见；正文不是可选择或搜索的文本层，最多 80 页                 |
| 长图     | 同一阅读排版生成 PNG，自动调整缩放至安全画布预算                          | 手机 12,000,000 像素、最长边 16,384px；桌面 24,000,000 像素、最长边 32,760px；过长时提供改为 PDF 的入口 |

勾选来源时，PDF 末尾会显示可点击的原文链接；未勾选时不增加来源页脚或链接标注。PNG 仅显示来源文字，Markdown 仅在原文末尾追加来源。

PDF 分页优先避开文字行、表格行和单幅图形。超出一页高度的内容仍可能分段；并非任意复杂文档的出版排版器。代码和长链接适配导出宽度，导出不包含导航栏、维护工具、目录、图表工具栏或隐藏的 Mermaid 源码。浅色导出底板和节点配色保持打印可读，不把深色页面截成低对比内容。

图片通过匿名 CORS 加载和画布规范化，未携带维护者令牌。网页能显示一张外链图片，不代表该源站允许跨域画布读取；防盗链、过期签名、网络失败、浏览器资源限制及过大原图也可能导致无法导出。失败时保留可见占位和具体提示，不建立绕过源站权限的代理。已有私密 Blob 图片从当前已授权阅读态处理，不上传生成文档或私密内容到第三方服务。

PNG 的像素预算是降低内存风险的上限，不保证每部手机一定能处理接近上限的图片；特别长的文章优先使用 PDF 或 Markdown。html2canvas 的单次画布捕获仍可能短时占用主线程，不能把异步进度显示描述成完整的后台线程渲染。

## 模块与构建

| 文件                                                               | 职责                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `quartz/components/BlogView.tsx`                                   | 公开阅读页分享图标，无需登录                             |
| `quartz/components/scripts/note-browser.inline.ts`                 | 安装轻量入口，沿用现有页面生命周期                       |
| `admin/article-share-loader.mjs`                                   | 一次事件委托，点击才加载共享组件，页面离开取消旧打开意图 |
| `admin/article-share.mjs`、`article-share.css`                     | 格式弹窗、默认来源选项、进度、生成/分享/下载与取消       |
| `admin/article-share-core.mjs`                                     | 文件名、来源链接、原文 UTF-8、设备判断、原生分享和下载   |
| `admin/article-export-renderer.mjs`、`article-export-renderer.css` | 临时导出排版、图片/图形处理、分页和画布生成              |
| `admin/article-export-renderer-core.mjs`                           | 分页区间、PNG 预算、页数上限及明确错误                   |
| `admin/private-notes.mjs`                                          | 当前认证阅读原文提供者和注销/离篇取消                    |
| `content-service/worker.mjs`                                       | 当前公开原文的单篇只读接口                               |
| `scripts/build-article-share.mjs`                                  | 稳定同源入口、内容哈希模块及按需分块                     |

`maintenance-assets/article-share.js` 转出带内容哈希的主组件。PDF/PNG 渲染模块以及 html2canvas 1.4.1、jsPDF 4.2.1 按实际格式继续懒加载；仅阅读或导出 Markdown 时不加载画布/PDF 库。不引入第二套前端框架或分享后端。

管理和主站维护 manifest 的版本包含 `articleShareEntry`。构建仍执行现有流水线，先部署包含前一套哈希资源的 Static Assets，再同步 D1 页面壳。只部署新按钮而不部署分享入口及分块会导致点击后失败。GitHub Pages 备用站同样提供前端组件，公开原文从受信任的主站内容服务读取，沿用既有 CORS。

## 原文与权限边界

公开 Markdown 使用 `GET/HEAD api/content/source/<ID>`，返回 `{ id, source, sourceSha, revision, commit }`。ID 必须通过既有白名单；仅查询当前公开 revision 的 `public_documents`，不读取合并了私密稿的维护 snapshot、认证 personal 表或全库 snapshot。私密、草稿、缺失和非法 ID 均为 404；撤下后的历史 revision 不可通过此端点取得。ETag 与当前 revision 对齐，支持 HEAD 和 304，响应使用 `no-cache`。主站旧阅读页与返回的公开 revision 不一致时拒绝导出 Markdown，提示刷新，避免把新原文与旧正文混为一个版本。

私密阅读通过同步 `howard-article-export-request` 请求/回复桥提供当前 `note.raw`、已渲染正文、标题、链接、`AbortSignal` 和 `isCurrent()`。提供者检查 root、文章 ID、认证身份和阅读 epoch，不泄露 token，不为分享再次拉取原文。无需全局原文缓存、localStorage、IndexedDB、服务器生成或文件上传。

任务在生成前后以及分享/下载点击时验证当前文章。关闭任务、离开页面、私密返回列表、注销、身份过期或当前阅读态改变时中止并移除弹窗、提示、捕获 iframe 和临时 URL；清空文件与文本引用。旧响应或分离的按钮不得继续分享、下载或复活界面。已经交给操作系统的分享不能由网页收回；用户显式导出私密文章也不会使服务器中的文章转为公开。

## 检查与已执行验证

运行现有 `npm run check`、`npm run test:publish`、`npm test -- --test-concurrency=1`、`npm run build:cloudflare`、`npm run verify:site`，并包含 `admin/article-share-core.test.mjs`、`admin/article-export-renderer.test.mjs` 和 `content-service/worker.test.mjs`。本轮完整套件 758 项通过，发布套件 544 项 Node 测试和 59 项 tsx 测试通过；这些套件存在重叠，不能相加。类型/格式、Cloudflare 构建与 301 个 HTML 页面、173 篇公开文章的站点验证通过。最终部署证据记录在独立复现指南中。

单篇公开接口已实测匿名读取、精确原文 UTF-8、私密/草稿拒绝、ETag/HEAD、原子 revision 切换及撤下历史不可读。

私密界面已在 Chromium 通过合成 getAccess/API、真实私密编译 Worker 和真实分享组件验证：桌面 Markdown 两次下载分别验证默认精确字节及勾选链接后原文字节前缀不变；未请求公开 source，也未重复获取当前原文。390px 手机模拟验证文件在内存准备、原生分享参数、默认无 URL、系统取消不自动下载。注销时选择弹窗、待分享文件以及进行中的 PNG 捕获 iframe 均同步清理；旧分离按钮、晚到资源、私密返回列表及 Quartz `prenav` 不继续下载或恢复界面。测试只使用合成内容，未执行生产写入。

截图和导出测试文件位于本机 `<PROJECT_DIR>/output/playwright/`，不发布为站点文章。本轮浏览器模拟不能替代实体 Android Chrome、iOS Safari 或实际分享目标验收；应在真实设备检查 PDF、PNG 和 Markdown 的 `canShare`、目标应用接收和系统取消行为。
