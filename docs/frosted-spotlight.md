# 磨砂玻璃与鼠标柔光

2026-10-01。沿用 Quartz、Preact、TypeScript/JavaScript 和 CSS/SCSS，自行实现材质及 PointerEvent 交互，没有增加运行依赖，也没有改动笔记原文或用户后台保存的页面设置。

## 原因与修复

之前推荐卡片没有 `backdrop-filter`，78% 底色与白色高光遮住环境色，第二张卡片另有背景覆盖，hover 又整体切换为纯白并位移。新实现移除这些覆盖。

- 环境层位于每张推荐卡片独立的圆角容器：固定、低饱和青蓝和蓝紫色块，使用 RGBA 表达透明，不给父容器添加整体 opacity、filter 或 mask。卡片行本身透明，间隙没有共用环境底板。
- 卡片自身使用真正的 `backdrop-filter: blur(24px) saturate(140%)`，浅色底板不透明度 55%，深色 62%。不支持背景模糊时使用实色替代。
- 静态高光、内阴影及 3.5% 的细颗粒构成磨砂表面。文字层位于光层上方；没有给整张卡片或文字设置 filter。
- 柔光由 80px 内层和 230px 外层径向渐变构成，中心由 `--mouse-x`、`--mouse-y` 即时更新，边缘有独立的 1px 蒙版反光。移入 150ms、移出 250ms，仅透明度过渡，没有坐标拖尾、纯白 hover 或卡片上移。
- 委托监听涵盖新随机推荐和标题、摘要、标签。WeakMap 防重复挂载，Quartz 页面清理时移除监听；离开、失焦、滚动、页面隐藏和媒体偏好变化时清除追光。
- 触屏保留静态磨砂，将模糊降至 16px；减少动态效果时关闭追光并保留底板。

阅读页的目录面板使用相同材质与局部柔光，正文与图谱文字保持稳定清晰。图谱与目录分别拥有独立底板；侧栏、折叠容器与面板布局容器均透明，不使用共享玻璃背板。窄屏折叠入口是独立控件，目录自身保留磨砂，没有祖先嵌套模糊，图谱弹层保持相对于视口定位。修正了前缀声明顺序，保证打包后标准 `backdrop-filter: none` 不会被丢弃。

后台导航、登录、文章侧栏和页面预览面板采用同一材质；登录和辅助面板有局部追光，编辑文本和正文预览保持实色。新增主题按钮，与公开页面共享主题存储及系统偏好。

## 修改文件

- `styles/frosted-glass.css`：公开页面和后台共用的材质、静态颗粒、双层柔光与边缘高亮。
- `scripts/lib/frosted-spotlight.mjs`、`.d.mts`：委托监听及清理。
- `quartz/styles/custom.scss`：移除背景覆盖，提供环境层和响应式阅读样式。
- `quartz/components/Blog.tsx`、`quartz/components/scripts/note-browser.inline.ts`：初始推荐、新推荐及目录接入。
- `admin/admin.css`、`admin/index.html`、`admin/app.mjs`、`admin/theme.mjs`、`scripts/build-admin.mjs`：后台材质、主题、共享样式发布。

## 2026-10-01 实际验证

- `npm run build`、`npm run check`、`npm run test:publish`、`npm run verify:site` 通过：66 项测试，297 个 HTML 页面，172 篇文章。
- 172 篇笔记的 688 份原文／发布／同步副本逐字节校验一致，用户最近的 `library/site.json` 设置已合并保留。
- Chromium 和 Firefox 均实际检查浅深色、静止磨砂、左上／中心／右下追光、离开淡出、文字锐利和点击穿透。四次内部导航返回首页，document 上的 pointermove 监听始终为一份；随机刷新后新卡片继续生效。
- 对实际 PNG 与静态底板 PNG 做像素比较，排除文字和边缘：六个浅深色／位置组合中，变化最强的位置距鼠标 0–2px；鼠标附近 RGB 平均变化 31–45，远处仅 0.26–1.96，确认是局部柔光而非整张卡片一起变亮。
- Chromium 与 Firefox 各检查 27 个状态，覆盖 390／768／1440px 的首页、文章列表、阅读和搜索，以及长标题、长链接、长代码、宽表格。分页、排序、搜索、主题、锚点、图谱、阅读位置按钮、减少动态效果通过，没有横向页面溢出或 JavaScript 运行错误。
- 额外检查 1239／1000／768／390px 的展开目录与全局图谱，确认没有嵌套背景模糊，图谱弹层始终覆盖 viewport。
- Firefox 实际禁用 backdrop-filter 后，浅深色及桌面／手机使用清晰实色替代。
- Chromium 真实触屏浏览器 context 检查静态 16px 磨砂及触屏不追光；此处是浏览器设备模拟，不是实体设备。
- 后台通过模拟 GitHub/OAuth 的登录、原文读取、实时预览、主题持久化、预览固定展开及三种尺寸检查；编辑区没有模糊。测试没有向外部仓库写入。

截图位于不提交的 `output/playwright/frost-*.png`；浏览器与像素检查日志在 `.local/frost-*.log`。未实际验证 Safari 或实体手机。

## 独立面板修复与追加验收

2026-10-01。截图中的连接感来自 `.lucky-previews` 横跨整排卡片的环境色、`.reading-sidebar` 覆盖整条侧栏的环境色，以及窄屏 `.reading-tools::before` 的共用底板。推荐卡片与目录改为各自的 `.frost-environment` 圆角环境层；布局容器仅负责间距。局部阴影缩短，鼠标柔光继续在单个面板内裁切。初始 HTML 与新随机推荐采用相同结构，后台原有布局容器已透明，没有同类连接背景。

- Chromium 与 Firefox 的首页均实测浅深色 × 1440／768／390px：每张环境层范围与卡片一致、真实 24px 磨砂、清晰文字、单面板追光、换组、内部导航与链接正常；禁用 JavaScript 后初始 HTML 仍有独立底板。
- 以实际截图比较有／无局部环境层的像素，两种主题各两处 22px 卡片间隙，中央 5px 宽区域共 5,840 像素完全一致，确认环境色没有进入间隙。
- 阅读实测两种主题 × 1440／1239／1000／768／390px，截图所示 SPM12 文章另测两种主题 × 1440／768／390px。图谱与目录净距 28px，间隙无共享底板；目录保留独立追光，全局图谱在各宽度仍覆盖视口，没有横向溢出或 JavaScript 错误。
- Chromium 触屏上下文验证目录的 16px 静态磨砂；减少动态效果关闭柔光，保留底板。这里是浏览器设备模拟，未验证实体手机。

追加截图在 `output/playwright/independent-*.png`，验收记录在 `.local/independent-*.log`。

## 浅色柔光、目录滚轮与品牌图标

2026-10-01。浅色追光改用更浅的冰蓝色：内层 `rgb(166 216 245 / 22%)`、外层 `rgb(159 215 242 / 9%)`、边缘 `rgb(119 184 222 / 50%)`；深色参数保留。公开页面、阅读目录和后台共用同一组变量。实际比较同一卡片的静态底板、旧参数与新参数截图，排除文字像素后，鼠标中心 40px 内的平均 RGB 通道变化从 32.02 降到 7.08，确认颜色变化明显变淡；仍检查了左上、中心、右下跟随与离开淡出。

长目录原有内层 `ul.toc-content.overflow` 在没有自身溢出时仍继承 `overflow:auto` 与 `overscroll-behavior:contain`，鼠标在链接或列表空白上会阻断外层侧栏滚动。改为内层可见溢出、允许滚动传播、移除渐隐蒙版；外层 `.reading-tools` 统一负责桌面滚动，不增加 JavaScript 滚轮拦截。另外恢复目录自身的实际折叠，折叠列表使用 `display:none`。

- Chromium 与 Firefox 均用真实滚轮检查三篇含 45／74／77 项标题的长目录，覆盖 1440×1000、1440×720、1280×900，以及图谱、间隙、标题、目录链接、列表空白、内边距、滚动条边七个区域。上下滚轮均滚动侧栏，正文与内层不动，末尾目录可达，正文区域仍独立滚动。
- 目录折叠实际隐藏列表、展开恢复；Chrome 的侧栏内容高度为 1930 → 417 → 1930，Firefox 为 1929 → 416 → 1929。768／390px 外层折叠与页面滚动正常，全局图谱固定定位、追光与页面宽度保留，没有 JavaScript 错误。
- 原创冰蓝圆角 `h.` 图标替代 Quartz 图标，构建按品牌标识与主色生成 SVG、32／180／512px PNG 和真正的 16／32／48px 多尺寸 ICO。公共内容页、404 和后台采用统一内容 hash 的资源链接，品牌改动后下一次构建同步；保留兼容 PNG 和根目录 ICO。
- 浏览器检查首页、文章列表、专题、标签、阅读、后台与 404 的图标引用及资源请求，四种图标资源均成功返回、ICO 帧可解码，内部导航后图标保持一致。
- 最终构建、类型与格式检查、69 项测试及站点验证通过，仍为 297 个 HTML 页面和 172 篇文章；笔记原文、页面设置和依赖未修改。

截图在 `output/playwright/soft-glow-*.png` 与 `howard-icon-*.png`，记录在 `.local/soft-glow-*.log`、`toc-scroll-*.log` 与 `site-icon-browser-check.log`。未实测 Safari、实体手机或浏览器标签栏的界面截图；图标已通过页面引用、资源请求、尺寸与解码验证。

## 当前正文配色与材质隔离

2026-10-02。公开与私密正文使用 `--glass-reader-surface`：浅色 `#fafbfc`、深色 `#343b45`。仅 `.blog-layout.is-article > #main-content` 和 `#private-notes-app .private-reading-body` 在自身范围内将 `--glass-reading` 覆盖为该阅读 token；正文、代码、表格与图表保持清晰，不给阅读内容加入磨砂或持续追光。

公开阅读外围的 `--glass-reader-page` 为浅色 `#f3f5f7`、深色 `#242a33`，只作用于 `body:has(.blog-layout.is-article)`。私密外壳不套用此规则。全局 `--glass-reading` 仍为浅色 `#eef0f2`、深色 `#252a31`；首页、目录、搜索、热图和维护等模块保留原共享配色。不能为了调亮正文而改共享 token，或让相邻独立面板继承正文覆盖。

材质与柔光继续使用 `--frost-*`、`--mouse-x`、`--mouse-y` 等既有变量和清理逻辑，正文调色不修改这些参数。上方日期明确的截图、像素比较和测试数字是对应阶段的历史验证，不代表本次文档更正重新执行了浏览器测试；完整当前视觉约定见 [Liquid Glass 前端](liquid-glass-frontend.md)。

## 参考

参照 [SpotlightCard](https://reactbits.dev/components/spotlight-card) 的局部指针坐标、[Magic Card](https://magicui.design/docs/components/magic-card) 的局部柔光与边缘响应、[Glass Surface](https://reactbits.dev/components/glass-surface) 的材质层次，自行实现 CSS 与交互，未复制第三方组件源码。没有引入 SVG 位移折射、RGB 色散或 Motion 运行时。取样层级参考 [CSSWG Backdrop Root](https://drafts.csswg.org/filter-effects-2/#BackdropRoot)。
