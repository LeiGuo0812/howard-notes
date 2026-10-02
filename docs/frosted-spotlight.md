# 磨砂玻璃与鼠标柔光

沿用 Quartz、Preact、TypeScript/JavaScript 和 CSS/SCSS，自行实现材质及 PointerEvent 交互，没有增加运行依赖，也没有改动笔记原文或用户后台保存的页面设置。

## 材质与交互

推荐卡片的环境层、磨砂底板、柔光和文字分层渲染。hover 保留半透明材质，不使用纯白背景覆盖，也不整卡上移。

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

## 独立面板、浅色柔光、目录与图标

推荐卡片与目录各有自己的 `.frost-environment` 圆角环境层；布局容器透明，仅负责间距。局部阴影不跨越间隙，初始 HTML 与随机刷新卡片采用相同结构。图谱与目录不共用覆盖整条侧栏的背板，手机抽屉也不能叠加祖先模糊导致弹层定位失效。

浅色追光使用冰蓝：内层 `rgb(166 216 245 / 22%)`、外层 `rgb(159 215 242 / 9%)`、边缘 `rgb(119 184 222 / 50%)`；深色单独控制。公开页面、目录和后台共用变量。

目录内层 `ul.toc-content.overflow` 保持可见溢出并允许滚动传播，不使用渐隐蒙版或 JavaScript 滚轮拦截。外层 `.reading-tools` 负责桌面滚动，鼠标位于图谱、间隙、标题、链接、列表空白、内边距或滚动条旁均应可滚动；折叠列表使用 `display:none`。

品牌图标按标识与主色生成 SVG、32/180/512px PNG 和 16/32/48px 多尺寸 ICO。公开页、404、后台统一使用内容 hash 的资源链接，保留兼容 PNG 和根目录 ICO；改品牌后须重新构建发布。

## 视觉回归流程

浅深两色检查静止磨砂、左上/中心/右下追光、离开淡出、文字锐利、点击穿透、换组及内部导航。按卡片局部坐标对照截图，不能只检查 blur 声明。检查面板间隙无共享色块、监听不重复、触屏静态 16px 材质、减少动态效果关闭追光、无 backdrop-filter 的实色回退。

在 390/768/1440px 检查首页、阅读、列表、搜索和管理页；长目录在整个侧栏范围检查上下滚轮及末尾可达，正文仍独立滚动。核对图标引用、响应、解码和缓存更新；实体手机和 Safari 未执行时必须说明。

## 当前正文配色与材质隔离

公开与私密正文使用 `--glass-reader-surface`：浅色 `#fafbfc`、深色 `#343b45`。仅 `.blog-layout.is-article > #main-content` 和 `#private-notes-app .private-reading-body` 在自身范围内将 `--glass-reading` 覆盖为该阅读 token；正文、代码、表格与图表保持清晰，不给阅读内容加入磨砂或持续追光。

公开阅读外围的 `--glass-reader-page` 为浅色 `#f3f5f7`、深色 `#242a33`，只作用于 `body:has(.blog-layout.is-article)`。私密外壳不套用此规则。全局 `--glass-reading` 仍为浅色 `#eef0f2`、深色 `#252a31`；首页、目录、搜索、热图和维护等模块保留原共享配色。不能为了调亮正文而改共享 token，或让相邻独立面板继承正文覆盖。

材质与柔光继续使用 `--frost-*`、`--mouse-x`、`--mouse-y` 等既有变量和清理逻辑，正文调色不修改这些参数。完整当前视觉约定见 [Liquid Glass 前端](liquid-glass-frontend.md)。

## 参考

参照 [SpotlightCard](https://reactbits.dev/components/spotlight-card) 的局部指针坐标、[Magic Card](https://magicui.design/docs/components/magic-card) 的局部柔光与边缘响应、[Glass Surface](https://reactbits.dev/components/glass-surface) 的材质层次，自行实现 CSS 与交互，未复制第三方组件源码。没有引入 SVG 位移折射、RGB 色散或 Motion 运行时。取样层级参考 [CSSWG Backdrop Root](https://drafts.csswg.org/filter-effects-2/#BackdropRoot)。
