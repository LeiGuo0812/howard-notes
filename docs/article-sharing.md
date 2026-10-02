# 文章分享与导出

公开文章的访客和维护者均可使用阅读页右上角的分享图标。登录后的私密阅读页提供相同入口。分享的是当前阅读文章；编辑器中的未发布修改稿不会替代已发布原文。

## 操作

选择 PDF、长图或 Markdown；选择长图时可在“高清”和“标准”之间切换，默认高清，其他格式不显示此项。“附上原文链接”每次打开默认不勾选。该选项只控制导出时新增的来源链接，不移除笔记本来就包含的链接，也不改服务器或 Obsidian 原文。

桌面选择格式后点击“导出并下载”。弹窗立即收起，左下角显示生成进度；正常完成后下载文件，生成期间仍可阅读和滚动。含无法导出的图片或图形时先显示具体提示，由用户点击下载，不自动交付遗漏内容而不说明。

手机点击“生成分享文件”，完成后在左下角点击“分享文件”，打开系统分享面板。准备阶段只在浏览器内存生成 `File`，网站不主动下载；系统如何临时保存或转交文件由浏览器和操作系统管理，不能承诺系统内部完全不产生缓存。先生成再点击分享可以保留 [Web Share API 要求的临时用户激活](https://www.w3.org/TR/web-share/)。

使用 `navigator.canShare({ files: [file] })` 单独检测文件分享能力；不能加入标题或 URL 来制造支持文件分享的假阳性。系统取消分享后保留重新分享、下载、关闭选项，不擅自下载。不能分享该文件类型时明确提供“下载”；Markdown 另可在支持时选择“分享文本”，它分享原文文本，不是假装发送 `.md` 附件。文件类型、大小和分享目标由当前系统决定，不能保证每个浏览器和应用均接受 Markdown 文件。

## 导出内容与限制

| 格式     | 内容及实现                                                                            | 实际边界                                                                                                       |
| -------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Markdown | 读取规范原文并用 `TextEncoder` 编码为 UTF-8；默认不追加标题、元信息或来源             | 保留 BOM、CRLF、围栏和原始链接；原有相对附件地址不重新打包或改写                                               |
| PDF      | 900px 阅读排版按 A4 分页；正文以可见的原生 Unicode 文本写入，样式与图形保留为高清背景 | 中文、英文、代码和表格中的普通文本可选择、复制、搜索；KaTeX、Mermaid、图片仍为图形；最多 80 页                 |
| 长图     | 同一阅读排版生成 PNG；高清默认桌面 3×、手机 2.5×，标准为 2×                           | 手机 16,000,000 像素、最长边 16,384px；桌面 48,000,000 像素、最长边 32,760px；不降至 1.5× 以下，过长提示改 PDF |

勾选来源时，PDF 末尾会显示可点击的原文链接；未勾选时不增加来源页脚或来源链接标注；正文原有安全链接保持可点击，网页生成的标题锚点控件不导出。PNG 仅显示来源文字，Markdown 仅在原文末尾追加来源。

PDF 的正文相对链接按原文章 URL 解析；仅保留安全的 HTTP、HTTPS 或 mailto 地址，拒绝含凭据、控制字符或危险协议的链接。临时 iframe 的 `about:blank` 不作为正文链接基址。

PDF 从导出 iframe 的浏览器布局读取实际文本位置、字号、颜色、粗细和倾斜，把可支持的正文绘制为可见的 PDF 文本；不是在整页截图上再盖一层透明的 OCR 文本。代码底色、表格边框、引用底板、链接外观、图片和图表由同一 CSS 排版的高清背景保留，文字捕获时隐藏对应文本，避免重影。PDF 保存的是排版结果，不是在文件内保存可重新运行的 CSS。

PDF 排版和嵌入使用同一份字体字节：Noto Sans SC Regular/Bold 负责普通正文、中文与显式加粗；常规代码中的 ASCII 使用复用的 KaTeX Typewriter 等宽字体，中文和其他代码符号回落到 Noto，显式加粗的代码片段在浏览器排版时同样改用 Noto Bold。字体先通过 `FontFace(ArrayBuffer)` 加入临时导出文档，再测量文字；PDF 按自然字形比例绘制，不把比例字体的 `i`、`m` 等字符逐个水平拉伸成等宽单元，避免笔画粗细不一致。字体按实际字形子集嵌入，字号、颜色、粗细和位置来自最终浏览器排版。少数字体不支持的字符、竖排或从右到左的文本仍以图形保留并明确警告，不能宣称所有图形内部文字均可选择。

PDF 分页优先避开文字行、表格行和单幅图形。超出一页高度的内容仍可能分段；并非任意复杂文档的出版排版器。代码和长链接适配导出宽度，导出不包含导航栏、维护工具、目录、图表工具栏或隐藏的 Mermaid 源码。浅色导出底板和节点配色保持打印可读，不把深色页面截成低对比内容。

导出先完成字体加载与全部文字包装，再测量最终高度、文字行和分页；不会复用包装前的页面区间。纯换行及其他纯空白 `TextNode` 保持原结构，不包装成新的行元素；包装正文的 span 明确使用普通 inline，代码容器在导出时使用 `display: block`，避免 Shiki 的 grid 布局把换行包装算成额外行。最终高度同时覆盖布局框、滚动高度与实际可见内容底部，阅读底板随之扩展。任何原生文字找不到对应页时显式报错停止导出，不先隐藏整段后静默丢失末尾内容。网页自动生成的代码行号和包装 span 的伪元素不导出；原文手写的数字、编号与代码内容保留。

html2canvas 的克隆文档和调用宿主都短暂复用已加载的公共 `FontFace`，使背景、代码底板与回退图形仍按同一字体布局。捕获结束或失败后移除本次加入宿主的字体，临时克隆与导出 iframe 随任务清理；不把文字改成 data URL，不上传正文，也不依靠额外的外部字体请求修正背景。字体共享只涉及公共字体字节，不包含文章内容或认证信息。

图片通过匿名 CORS 加载和画布规范化，未携带维护者令牌。网页能显示一张外链图片，不代表该源站允许跨域画布读取；防盗链、过期签名、网络失败、浏览器资源限制及过大原图也可能导致无法导出。失败时保留可见占位和图床/原因提示。对当前公开文章中引用的已知 OSS/Yuque 公开图床，提供下述受限读取通路；不代理任意地址，不绕过源站身份验证。已有私密 Blob 图片从当前已授权阅读态处理，不上传生成文档或私密内容到第三方服务。

PNG 保持 900px 的 CSS 阅读布局，高清短文章桌面成品宽 2700px、手机宽 2250px；标准成品宽 1800px。长文章按实际高度计算安全捕获倍率，实际像素尺寸在左下角进度及待分享成品中显示。超过预算时只可下调到 1.5×；达不到这个清晰度就报错并提供改为 PDF 的入口，不静默生成低于阅读布局分辨率的模糊长图。提升导出倍率不能补回原始图片本身缺失的细节。

PNG 的像素预算是降低内存风险的上限，不保证每部手机一定能处理接近上限的图片；特别长的文章优先使用 PDF 或 Markdown。html2canvas 的单次画布捕获仍可能短时占用主线程，不能把异步进度显示描述成完整的后台线程渲染。

PDF 图形背景捕获倍率为桌面 2×、手机 1.5×，普通正文仍为原生文字。单张原始图片超过 32,000,000 像素时保留占位并提示；规范化图片高度最多 4096px。Markdown 文本分享回退还要求 `text.length ≤ 100000` 和系统文本分享接口可用，更长内容使用文件分享或明确下载。

## 分享样式与公开图片读取

分享弹窗的懒加载样式设置唯一 ID `howard-article-share-styles` 和 Quartz 的 `data-persist` 标记；每次打开及 `nav` 检查缺失样式并恢复，事件监听仍仅安装一次。关闭/离页/私密身份撤销继续销毁界面和任务，不因样式持久化保留私密正文。这样首页、不同文章及返回页面后不会退化为普通文档流里的纯文本选项。

图片首先使用匿名 CORS 加载；GitHub 图床、支持 CORS 的其他图床、本机 data 图片和已授权 Blob 图片沿用原通路。克隆开始即配对每张图片，保存原始序号，再移除工具栏/忽略元素，避免删除装饰图后错配正文图片。

旧 OSS 图片在正文可显示，但缺少 `Access-Control-Allow-Origin`，浏览器无法绘入画布。仅对于显式公开阅读态，CORS 失败后使用 `GET api/content/export-image/<ID>/<INDEX>`；主站附当前 `revision`，Pages 无本地接口时才转向构建时受信任的内容 API。服务器只读当前 `public_documents.html` 中第 N 张图片，不接受图片 URL、正文或令牌参数，不读取私密表或历史公开版本。私密、草稿、撤下文章为 404，主站旧 revision 为 409。

受限服务只允许 HTTPS 的 `picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/` 和 `cdn.nlark.com/yuque/`；拒绝用户名/密码、非标准端口、查询参数、路径越界、非图片文件及所有重定向。向图床发匿名 GET，不转发 Cookie、Authorization、Referer 或文章正文。完整响应体限 10 MiB、12 秒，流量累计不依赖 Content-Length；PNG/JPEG/GIF/WebP/AVIF 的实际签名必须匹配 MIME，SVG/HTML 不经此通路。响应 `no-store/nosniff`，不会写入 Git、D1 或 R2。

响应带 `X-Howard-Image-Source-SHA256`，值为移除 URL fragment 后规范地址的 SHA-256，跨 Pages 明确 expose 该头。浏览器复核身份和图片签名后创建临时 Blob，再沿原归一化、分页和捕获流程导出；摘要不匹配停止该图，避免旧页面或图片序号变化造成错图。临时 Blob 随任务清理。

私密阅读不进入公共图片端点；已授权附件 Blob 和允许 CORS 的外链保持可导出，私密外链缺 CORS 时仍显示具体遗漏提示。未知图床、原站 403/404、需要登录、超限或过期签名不能保证导出，不通过开放代理掩盖失败。新增图床应按白名单、当前文章引用和来源校验边界评审，不能仅放开任意 URL。

## 模块与构建

| 文件                                                               | 职责                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `quartz/components/BlogView.tsx`                                   | 公开阅读页分享图标，无需登录                             |
| `quartz/components/scripts/note-browser.inline.ts`                 | 安装轻量入口，沿用现有页面生命周期                       |
| `admin/article-share-loader.mjs`                                   | 一次事件委托，点击才加载共享组件，页面离开取消旧打开意图 |
| `admin/article-share.mjs`、`article-share.css`                     | 格式弹窗、默认来源选项、进度、生成/分享/下载与取消       |
| `admin/article-share-core.mjs`                                     | 文件名、来源链接、原文 UTF-8、设备判断、原生分享和下载   |
| `admin/article-export-renderer.mjs`、`article-export-renderer.css` | 最终导出高度与分页、图片/图形、字体一致的背景捕获和清理  |
| `admin/article-export-renderer-core.mjs`                           | 分页区间、PNG 清晰度方案、实际像素预算和页数上限         |
| `admin/article-export-pdf.mjs`、`article-export-pdf-core.mjs`      | 同字节字体排版、最终文本几何、无拉伸绘制与完整分页检查   |
| `admin/article-export-pdf-fontkit.mjs`                             | 固定版本 CFF 子集编码兼容适配，保留中文字体字典映射      |
| `admin/private-notes.mjs`                                          | 当前认证阅读原文提供者和注销/离篇取消                    |
| `content-service/worker.mjs`                                       | 当前公开原文的单篇只读接口                               |
| `scripts/build-article-share.mjs`                                  | 稳定同源入口、内容哈希模块及按需分块                     |

`maintenance-assets/article-share.js` 转出带内容哈希的主组件。PDF/PNG 渲染模块以及 html2canvas 1.4.1 按实际格式继续懒加载；PDF 另加载 pdf-lib 1.17.1、@pdf-lib/fontkit 1.1.1，原 jsPDF 依赖已移除。两个同源 Noto Sans SC OTF 字体约 8.33MB/8.54MB，加上 27,556 字节的 Typewriter TTF，仅在导出 PDF 时按需获取并使用浏览器公共静态缓存复用，生成文件只嵌入使用的字形子集。Noto 字体来源及 SHA-256 见 `assets/article-pdf-fonts/provenance.json`，构建核验字节与校验值，发布原字体和 OFL 许可。固定版本 fontkit 的 CFF offSize 与 CID FDSelect 编码缺陷在独立适配器中修正，保持重复使用的字体字典映射，依赖源码与原字体不改。字体资源不包含文章或认证信息；读取、Markdown 或 PNG 不加载 PDF 库及这些 PDF 字体。不引入第二套前端框架或分享后端。

原字体来自 `notofonts/noto-cjk` 固定提交 `f8d157532fbfaeda587e826d4cd5b21a49186f7c` 的 `Sans/SubsetOTF/SC`，采用 SIL Open Font License 1.1。构建发布 `LICENSE.txt` 和 `provenance.json`，字体说明 Markdown 留在源码内。字体读取限定同源 HTTP(S)，使用 `credentials: omit`、`redirect: error` 和无 referrer，不携带维护者凭据。升级固定 fontkit 1.1.1 时须重新验证 offSize、重复字典 FDSelect 映射、真实 Regular/Bold 子集、Unicode 映射及独立 PDF 渲染；只有文本能提取而中文渲染成方框仍不合格。

等宽代码字体复用锁定的 KaTeX 0.18.9 包内 `KaTeX_Typewriter-Regular.ttf`，原文件 27,556 字节，SHA-256 为 `f01f3e87d9c6a61c0c081ceb577abd864eb00a612f7ac1620dd6915fad2ef5aa`，构建同时核验版本、长度和校验值。KaTeX 包的 JavaScript 使用 MIT 许可，这份字体本身采用 SIL Open Font License 1.1，不能把字体许可写成 MIT。发布目录分别保留 `KaTeX-LICENSE.txt`、带原版权和保留字体名称的 `KaTeX-Typewriter-LICENSE.txt`，以及 `code-font-provenance.json`。升级包或替换字体时须核对许可、字符覆盖、等宽宽度、浏览器与 PDF 字形一致性和真实 TrueType 子集输出。

管理和主站维护 manifest 的版本包含 `articleShareEntry`。构建仍执行现有流水线，先部署包含前一套哈希资源的 Static Assets，再同步 D1 页面壳。只部署新按钮而不部署分享入口及分块会导致点击后失败。GitHub Pages 备用站同样提供前端组件，公开原文从受信任的主站内容服务读取，沿用既有 CORS。

## 原文与权限边界

公开 Markdown 使用 `GET/HEAD api/content/source/<ID>`，返回 `{ id, source, sourceSha, revision, commit }`。ID 必须通过既有白名单；仅查询当前公开 revision 的 `public_documents`，不读取合并了私密稿的维护 snapshot、认证 personal 表或全库 snapshot。私密、草稿、缺失和非法 ID 均为 404；撤下后的历史 revision 不可通过此端点取得。ETag 与当前 revision 对齐，支持 HEAD 和 304，响应使用 `no-cache`。主站旧阅读页与返回的公开 revision 不一致时拒绝导出 Markdown，提示刷新，避免把新原文与旧正文混为一个版本。

数据库原文取自该行 `body` JSON 的 `source` 字段；`public_documents` 没有独立的 `source` 列。

私密阅读通过同步 `howard-article-export-request` 请求/回复桥提供当前 `note.raw`、已渲染正文、标题、链接、`AbortSignal` 和 `isCurrent()`。提供者检查 root、文章 ID、认证身份和阅读 epoch，不泄露 token，不为分享再次拉取原文。无需全局原文缓存、localStorage、IndexedDB、服务器生成或文件上传。

任务在生成前后以及分享/下载点击时验证当前文章。关闭任务、离开页面、私密返回列表、注销、身份过期或当前阅读态改变时中止并移除弹窗、提示、捕获 iframe 和临时 URL；清空文件与文本引用。旧响应或分离的按钮不得继续分享、下载或复活界面。已经交给操作系统的分享不能由网页收回；用户显式导出私密文章也不会使服务器中的文章转为公开。

取消后立即清理当前任务和私密引用，并阻止后续生成、分享、下载。公共字体使用独立超时和共享 Promise 缓存，请求可能继续完成供下一次导出复用，不包含正文或认证信息。html2canvas 没有强制中断接口，已经开始的捕获可能短时继续；取消不等于立即停止全部计算和网络。

## 回归检查流程

运行 `npm run check`、`npm run test:publish`、`npm test -- --test-concurrency=1`、`npm run build:cloudflare`、`npm run verify:site`。分享相关测试包括 `admin/article-share-core.test.mjs`、`admin/article-share-lifecycle.test.mjs`、`admin/article-export-renderer.test.mjs`、`admin/article-export-pdf.test.mjs`、`content-service/export-images.test.mjs` 和 `content-service/worker.test.mjs`。

- 在 1440px 和 390px、浅深两色检查首页 → 文章 → 分享 → 首页 → 另一文章，弹窗固定定位和样式保持；手动移除样式后应自愈，不能重复插入样式。
- 实际导出长文、多图片、中文、英文、代码、表格、引用、公式和 Mermaid。用独立 PDF 工具提取文本并查看首页与末页，核对末尾内容完整且只出现一次、字体子集与 Unicode、字形粗细和底板对齐。检查 PNG 像素与末尾内容，不能只确认文件存在。
- Markdown 默认逐字节对照原文；勾选来源后保留原文字节前缀。默认来源关闭，PDF/PNG/Markdown 都需检查。
- 公开源接口检查匿名可读、私密/草稿拒绝、ETag/HEAD、revision 更换和撤下不可读；图像端点检查 CORS 优先、受限回退、DOM 序号、错误摘要、旧 revision、超时、HTML/SVG/超限拒绝。
- 私密使用合成认证 API 和正式阅读组件；不请求公开 source、不重复读取当前原文、字体无凭据。关闭、注销、导航、取消和晚到结果均不得再次下载或恢复旧界面。
- 手机检查真实 File 对象、有效点击、分享参数和显式下载回退；取消不能自动下载。Android Chrome、iOS Safari 与目标应用是否接收必须在实体设备确认，浏览器模拟不代替此项。

每次交付说明实际执行范围与未验证限制，不将旧测试数字或截图作为新部署的证明。
