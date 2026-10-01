# 磨砂玻璃与鼠标柔光

2026-10-01。沿用 Quartz、Preact、TypeScript/JavaScript 和 CSS/SCSS，自行实现材质及 PointerEvent 交互，没有增加运行依赖，也没有改动笔记原文或用户后台保存的页面设置。

## 原因与修复

之前推荐卡片没有 `backdrop-filter`，78% 底色与白色高光遮住环境色，第二张卡片另有背景覆盖，hover 又整体切换为纯白并位移。新实现移除这些覆盖。

- 环境层位于推荐卡片父容器：固定、低饱和青蓝和蓝紫色块，使用 RGBA 表达透明，不给父容器添加整体 opacity、filter 或 mask。
- 卡片自身使用真正的 `backdrop-filter: blur(24px) saturate(140%)`，浅色底板不透明度 55%，深色 62%。不支持背景模糊时使用实色替代。
- 静态高光、内阴影及 3.5% 的细颗粒构成磨砂表面。文字层位于光层上方；没有给整张卡片或文字设置 filter。
- 柔光由 80px 内层和 230px 外层径向渐变构成，中心由 `--mouse-x`、`--mouse-y` 即时更新，边缘有独立的 1px 蒙版反光。移入 150ms、移出 250ms，仅透明度过渡，没有坐标拖尾、纯白 hover 或卡片上移。
- 委托监听涵盖新随机推荐和标题、摘要、标签。WeakMap 防重复挂载，Quartz 页面清理时移除监听；离开、失焦、滚动、页面隐藏和媒体偏好变化时清除追光。
- 触屏保留静态磨砂，将模糊降至 16px；减少动态效果时关闭追光并保留底板。

阅读页在桌面目录面板使用相同材质与局部柔光，正文与图谱文字保持稳定清晰。窄屏目录取消内层模糊，工具外壳的玻璃背板放到伪元素上，避免嵌套取样和图谱弹层定位受影响。修正了前缀声明顺序，保证打包后标准 `backdrop-filter: none` 不会被丢弃。

后台导航、登录、文章侧栏和页面预览面板采用同一材质；登录和辅助面板有局部追光，编辑文本和正文预览保持实色。新增主题按钮，与公开页面共享主题存储及系统偏好。

## 修改文件

- `styles/frosted-glass.css`：公开页面和后台共用的材质、静态颗粒、双层柔光与边缘高亮。
- `scripts/lib/frosted-spotlight.mjs`、`.d.mts`：委托监听及清理。
- `quartz/styles/custom.scss`：移除背景覆盖，提供环境层和响应式阅读样式。
- `quartz/components/Blog.tsx`、`quartz/components/scripts/note-browser.inline.ts`：初始推荐、新推荐及目录接入。
- `admin/admin.css`、`admin/index.html`、`admin/app.mjs`、`admin/theme.mjs`、`scripts/build-admin.mjs`：后台材质、主题、共享样式发布。

## 实际验证

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

## 参考

参照 [SpotlightCard](https://reactbits.dev/components/spotlight-card) 的局部指针坐标、[Magic Card](https://magicui.design/docs/components/magic-card) 的局部柔光与边缘响应、[Glass Surface](https://reactbits.dev/components/glass-surface) 的材质层次，自行实现 CSS 与交互，未复制第三方组件源码。没有引入 SVG 位移折射、RGB 色散或 Motion 运行时。取样层级参考 [CSSWG Backdrop Root](https://drafts.csswg.org/filter-effects-2/#BackdropRoot)。
