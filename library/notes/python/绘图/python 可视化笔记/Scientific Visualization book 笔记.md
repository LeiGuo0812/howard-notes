---
date created: Tuesday, September 26th 2023, 12:27:22 pm
date modified: Thursday, September 28th 2023, 12:03:49 am
---
#Python #书籍 #可视化

书籍地址： [GitHub - rougier/scientific-visualization-book: An open access book on scientific visualization using python and matplotlib](https://github.com/rougier/scientific-visualization-book)
# 1. 基础

## 1.1 图形结构 (Anatomy of a figure)
### 图形的创建
matplotlib 图形中包含多个层次的元素（figure, axes ...），为了创建一个图形，通常需要定义大部分的元素。

但大部分情况下，这些元素都是隐式创建的:

```python
plt.plot(range(10))
```

这句代码创建了 figure 和 axes，但由于是隐式创建，所以无法控制图形的大小，plt.plot 将图形绘制到最后创建的一个 axes 上

显式地创建 figure 和 axes (`plt.figure`  + `plt.subplot` 或 `fig.add_subplot`)

```python
fig = plt.figure(figsize=(6,6))  
ax = plt.subplot(aspect=1)  
ax.plot(range(10))  
plt.show()

# fig = plt.figure(figsize=(6,6))
# ax = fig.add_subplot(1,1,1)
# ax.plot(range(10))
# plt.show()
```

更紧凑地创建 (`plt.subplots`)：

```python
fig, ax = plt.subplots(figsize=(6,6),  
					   subplot_kw={"aspect"=1})  
ax.plot(range(10))
```

图形解剖：

![image.png|425](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309261552638.png)

### 图形的基本元素 (elements)
- **Figure：画布**
	- 可以指定背景颜色 facecolor, 标题 subtitle 等
	- 创建 figure 时使用的 facecolor 在使用 savfig 函数保存图像时，会失效，因为 savefig 函数本身就有一个 facecolor 函数（默认白色），该参数会覆盖 figure 的参数，设置 transparent=True 可以使图形背景透明
- **Axes：子图**
	- 每个 Figure 中可以有一个或多个 Axes，每个 axes（子图）被上下左右四条边包围，称为 Splines，每个 Spline 被 ticks，tick labels，和 label 来修饰
	- matplotlib 默认只修饰左侧和底部的 spline
- **Axis：修饰过的 Spline**
	- 横向为 xaxis，纵向为 yaxis
	- 由 spline, major and minor ticks, major and minor tick labels, and axis label
- **Splines: 边**
	- 连接 axis tick，标志数据边界
	- 可放置在任意地方，也可以设置为可见或不可见
- **Artist：任意元素**
	- 图形上的所有内容，包括 Figure，Axes，Axis objects (Text objects, Line2D objects, collection objects, Patch objects).
	- 渲染图形时，所有 Artist 都会被绘制到画布上
	- 一个给定的 Artist 只能存在于一个 Axes 上

### 图形基元 (graph primitives)

plot 一般由 Patches，lines，和 text 组成

- Patches
	- 可大可小，如 markers，bars，可有不同形状，如 circle，triangles，polygons 等
- Lines
	- 可以粗或细
- Texts
	- 使用任何字体，或渲染 latex 字体

所有基元都有其属性，如大小，颜色，样式，透明度等。在使用创建图形的函数时，基元被隐式创建，但仍可以通过访问来修改其属性。

例如，修改 x 轴上所有 tick label 的字体为粗体：

```python
fig, ax = plt.subplots(figsize=(5,2))  
for label in ax.get_xaxis().get_ticklabels():
	label.set_fontweight("bold")  
plt.show()
```

基元还有一个重要属性：zorder，决定了基元在图像中的呈现顺序，从低到顶部，一般 zorder 会自动设置，有些方法会覆盖默认设置以使其正确显示

![image.png|250](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309261945181.png)

[source](https://github.com/rougier/scientific-visualization-book/blob/master/code/anatomy/zorder.py)
### 后端 (backend) 

后端是用于渲染和呈现的部分，也提供用户与图形交互的界面。

查看和切换后端：

```python
import matplotlib  
print(matplotlib.get_backend())

matplotlib.use("xxx")
```

- 可切换的 renderer：使用后，图像将无法在屏幕上显示，但可以保存到磁盘

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309261958868.png)

注：即使使用了 raster renderer，依然可以保存成 vector 文件


如果需要与图像交互，则需要使用 interface 和 renderer 的结合，例如 Web 或 CTK3

- 可使用的 interface：

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309261959590.png)

```python
import matplotlib  
matplotlib.use('webagg')  
import matplotlib.pyplot as plt  
plt.show()
```

> [!warning]
> use 函数必须在 import pyplot 之前使用

在选择了 interactive backend 后，可以使用**互动模式**（每次使用 matplotlib 之后，图像都会更新，即逐行运行）

```python

plt.ion()             # Interactive mode on
plt.plot([1,2,3])     # Plot is shown
plt.xlabel("X Axis")  # Label is updated
plt.ioff()            # Interactive mode off
```

更多内容参考：[Quick start guide — Matplotlib 3.8.0 documentation](https://matplotlib.org/stable/users/explain/quick_start.html)

>An interesting backend under OSX and iterm2 terminal is the imgcat  
backend that allows to render a figure directly inside the terminal, emu‐  
lating a kind of jupyter notebook

```python
import numpy as np  
import matplotlib
matplotlib.use("module://imgcat")  
import matplotlib.pyplot as plt  
fig = plt.figure(figsize=(8,4), frameon=False)  
ax = plt.subplot(2,1,1)  
X = np.linspace(0, 4*2*np.pi, 500)  
line, = ax.plot(X, np.cos(X))  
ax = plt.subplot(2,1,2)  
X = np.linspace(0, 4*2*np.pi, 500)  
line, = ax.plot(X, np.sin(X))  
plt.tight_layout()  
plt.show()
```

### 尺寸和分辨率 (Dimensions & resolution)

定义图形时，默认的单位是英寸，默认的 dpi (dots per inch) 是 100，假如尺寸为 (6,6) ，则像素尺寸为 600 × 600，这在储存位图时，需要用到。

```python
fig = plt.figure(figsize=(6,6))  
plt.savefig("output.png")
```

- 尺寸：物理单位 (centimeter, inch)
- 分辨率：单位尺寸上的像素数 
- Geometry：尺寸×分辨率

因此，对于一张图片，增大其尺寸，分辨率会降低，如果需要在文章中插入图片且保持分辨率，需要保证文章中的图片大小与保存时一致。

- 在呈现时，可以设置 figure 的 dpi 稍低，以便于观察和修改，在 `plt.savefig` 中再设置较高的 dpi
- 推荐将图片保存成矢量化的 (PDF, svg 等)，但是，**即使是将图片保存成矢量图，也依然要对图片中无法矢量化的部分（如 .image）设置 dpi**
- 在 matplotlib 和 latex 中，所有 text 的默认大小是 10 point，1 point = 1/72 英寸 （latex 中，1 point 为 1/72.27 英寸）

为了确认图片中各个部分的尺寸，可以在图片中添加标尺

```python
import ruler  
import numpy as np  
import matplotlb.pyplot as plt  
fig,ax = plt.subplots()  
ruler = ruler.Ruler(fig)  
plt.show()
```

定义 ruler：[ruler.py](https://github.com/rougier/scientific-visualization-book/blob/master/code/anatomy/ruler.py)


绘制两个标尺：[inch-cm.py](https://github.com/rougier/scientific-visualization-book/blob/master/code/anatomy/inch-cm.py)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309262333244.png)


互相堆叠的山脊图：[zorder-plots.py](https://github.com/rougier/scientific-visualization-book/blob/master/code/anatomy/zorder-plots.py)

## 1.2 坐标系统 (Coordinate systems)
在任何 matplotlib 图形中，都至同时少存在两种坐标系统，每一种都以 normalized 或 native version 存在：

- Figure 坐标系统 (FC)
	- normalized version (NxC) **(0 - 1)**
	- native version (xC) **(pixels)**
- 单独图片的坐标系统 (DC)
	- normalized version (NxC) **(0 -1)**
	- native version (xC) **(data units)**

![image.png|375](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309270954806.png)

**FC** : Figure Coordinates, **NFC** Normalized Figure Coordinates, **DC** : Data Coordinatess, **NDC** : Normalized Data Coordinates.

### 坐标转换函数

matplotlib 中提供了一系列函数，方便进行不同坐标系坐标之间的转换

```python
fig = plt.figure(figsize=(6, 5), dpi=100)  
ax = fig.add_subplot(1, 1, 1)  
ax.set_xlim(0,360), ax.set_ylim(-1,1)  

# FC : Figure coordinates (pixels)  
# NFC : Normalized figure coordinates (0 → 1)  
# DC : Data coordinates (data units)  
# NDC : Normalized data coordinates (0 → 1)  

DC_to_FC = ax.transData.transform  # data units to pixels
NDC_to_FC = ax.transAxes.transform # data 0-1 to pixels  
NFC_to_FC = fig.transFigure.transform # figure 0-1 to pixel

FC_to_DC = ax.transData.inverted().transform  # pixels to data units
FC_to_NDC = ax.transAxes.inverted().transform  # pixels to data 0-1
FC_to_NFC = fig.transFigure.inverted().transform # pixel to figure 0-1

DC_to_NDC = lambda x: FC_to_NDC(DC_to_FC(x)) # data units to data 0-1
```

可以看到，FC 是各种坐标系转换的终点（各种 transform 函数的目标系统，最后渲染图形的系统），通过 FC 可以实现各种坐标系统之间的转换

```python
# Top right corner in normalized figure coordinates  
print(NFC_to_FC([1,1])) # (600,500)  
# Top right corner in normalized data coordinates  
print(NDC_to_FC([1,1])) # (540,440)

# Top right corner in data coordinates  
print(DC_to_FC([360,1])) # (540,440)

# Bottom left corner in data coordinates  
print(DC_to_NDC([0, -1])) # (0.0, 0.0)  
# Center in data coordinates  
print(DC_to_NDC([180,0])) # (0.5, 0.5)  
# Top right corner in data coordinates  
print(DC_to_NDC([360,1])) # (1.0, 1.0)
```

对于笛卡尔坐标系，转换关系比较显而易见，而对于极坐标系，道理是一样的的，但不那么直观

![image.png|475](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309271131430.png)

---

通常情况下，不需要显式地指定坐标系统。但如果需要在图形上添加一些元素，则需要了解坐标系统。以 text 为例，在图形上添加文字时，需要考虑将文字添加到什么位置，位置应该在什么坐标系统（data coordinates? normalized data coordinates? normalized figure coordinates?）**默认的情况下，使用的是 data coordinate**，如果希望使用不同的坐标系统，则需要显式地使用转换函数 (transform) 

例如：
```python
fig = plt.figure(figsize=(6, 5), dpi=100)  
ax = fig.add_subplot(1, 1, 1)  
ax.text(0.1, 0.1, "A", transform=ax.transAxes)
plt.show()
```

使用了 `transform=ax.transAxes` 后，坐标即从 data coordinate 转换到了 normalizaed data coordinate，即 text 会绘制到 axes 距离左侧和底部 10% 的位置上。

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309271258874.png)


>[!note]
>**无论使用什么坐标系统指示图形元素的坐标，最终渲染时都会被转换成 figure coordinate (pixels)**。使用 transform 参数时，传入了 ax.transAxes, 即声明了传入的坐标系统是 normalized data coordinate，因此应该执行从 normalized data coordinate --> figure coordinate 的转换。

当 x，y 轴的尺寸一致时，使用 normalized data coordinate 可以使 text 左侧和下方距离图形边界的距离相等，但当 x，y 轴尺寸不一致时，则会导致距离不相等，图形不够美观。此时，可以手动定义，使得转换是 normalized data coordinate 转换和 figure native units (pixels) 偏置 (offset) 的组合：

```python
from matplotlib.transforms import ScaleTranslation
fig = plt.figure(figsize=(3, 2))

ax = fig.add_subplot(1, 1, 1)  

# 设置偏置10个像素，并转换成英寸
dx, dy = 10/fig.dpi, 10/fig.dpi

# 设置一个偏置对象，将所有输入都偏置10个像素，fig.dpi_scale_trans 将英寸转换成 figure coordinate (pixels), 在这里，由于 ScaledTranslation 对象要求传入一个 scale_trans 参数，因此可以先将偏置转换成英寸，再传入 fig.dpi_scale_trans，将偏置返回到 figure coordinate
offset = ScaledTranslation(dx, dy, fig.dpi_scale_trans)  

# 绘制text，坐标为图像的左下角且向右、上偏置10个像素（转换是从normalized data coordinate 到 figure coordinate 的转换和 10 像素偏置的组合，代码首先将输入坐标转换到 FC, 然后再添加 FC 坐标内的偏置）
plt.text(0, 0, "B", transform=ax.transAxes + offset)  
plt.show()
```

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309271321321.png)

这段代码给 B 添加了一个向右、向上 10 个像素位置的偏置，无论图片的尺寸如何。当不清楚转换如何发生时，调用转换的 .transform 方法并测试一系列坐标有助于理解发生了什么

---

当需要对 x 和 y 轴分别应用不同的转换时，则情况会更复杂一些，例如，要绘制 tick labels 下的箭头：

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309271626605.png)

x 轴坐标用 data coordinate 即可，但 y 轴坐标则需要进行一些计算，在 matplotlib 中，text 的大小单位是 point (= 1/72 英寸)，则需要使用 point 表达的偏置：

```python
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.transforms import blended_transform_factory, ScaledTranslation

fig = plt.figure(figsize=(6, 4))
ax = fig.add_subplot(1, 1, 1, aspect=1)
ax.set_xlim(0, 10)
ax.set_xticks(range(11))
ax.set_ylim(0, 5)
ax.set_yticks(range(6))

point = 1 / 72
fontsize = 12
dx, dy = 0, -1.5 * fontsize * point
offset = ScaledTranslation(dx, dy, fig.dpi_scale_trans)
transform = blended_transform_factory(ax.transData, ax.transAxes + offset)

for x in range(11):
    plt.text(x, 0, "↑", transform=transform, ha="center", va="top", fontsize=fontsize)
    
plt.tight_layout()
```

函数 blended_transform_factory 传入两个转换对象，第一个定义 x 轴的转换方式，第二个定义 y 轴的转换方式。从而实现 x 轴和 y 轴的不同转换方式

>[!note]
>可以使用 ha 和 va 参数来定义 text 在输入坐标内的对齐方式

---

一些利用坐标系统转换的其他有趣例子：

![image.png|450](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309271931077.png)

[collage.py](https://github.com/rougier/scientific-visualization-book/blob/master/code/coordinates/collage.py)

```python
# 导入包
import imageio # 读取图片
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.transforms as transforms

# 定义一个新的imshow函数，参数包括需要绘制的ax，图像I，图像的初始位置position，缩放比例scale，旋转角度angle，z轴层数序号zorder
def imshow(ax, I, position=(0, 0), scale=1, angle=0, zorder=10):
	
	# 获取图像矩阵大小
	height, width = I.shape[0], I.shape[1]
	
	# 设置图像坐标轴范围（由scale缩放，中心在(0,0)）
	extent = scale * np.array([-width / 2, width / 2, -height / 2, height / 2])

	# 初步绘制图片I
	im = ax.imshow(I, extent=extent, zorder=zorder, cmap="cividis")

	# 定义一个空的仿射变换，并添加angle旋转和position的平移（*为解包操作符，将元组或列表解包成独立的参数传入）
	transform = transforms.Affine2D().rotate_deg(angle).translate(*position)
	# 将定义的仿射变换与ax.transData结合，定义传入坐标为data coordinate
	trans_data = transform + ax.transData
	# 对生成的图片应用变换
	im.set_transform(trans_data)

	# 获取当前图片的extend
	x1, x2, y1, y2 = im.get_extent()

	# 在图片周围绘制白色框线（根据缩放比例调整粗细）
	ax.plot(
		[x1, x2, x2, x1, x1],
		[y1, y1, y2, y2, y1],
		"white",
		linewidth=25 * scale,
		transform=trans_data,
		zorder=zorder - 0.1,
	)

	# 绘制黑色框线（位置在白色框线下面）
	ax.plot(
		[x1, x2, x2, x1, x1],
		[y1, y1, y2, y2, y1],
		"black",
		alpha=0.25,
		linewidth=40 * scale,
		transform=trans_data,
		zorder=zorder - 0.2,
    )

# 绘制图片，尺寸为5×5英寸
fig = plt.figure(figsize=(5, 5))
# 添加子图，占满整个图片，坐标范围为0-1000，去除边框
ax = fig.add_axes([0, 0, 1, 1], aspect=1, frameon=False, xlim=[0, 1000], ylim=[0, 1000])

np.random.seed(123)
# 读取图片数字矩阵
I = imageio.imread("mona-lisa.png")
# 生成200次图片
for i in range(200):

	# 随机获取偏置量，偏置范围-100 - 1100
	position = np.random.uniform(-100, 1100, 2)
	# 缩放程度
	scale = np.random.uniform(0.20, 0.25)
	# 旋转程度
	angle = np.random.uniform(-75, +75)
	# 在子图上添加图片对象
	imshow(ax, I, position, scale, angle, zorder=10 + i)

# 取消所有坐标轴元素
ax.set_axis_off()
plt.show()
```

---

进阶例子：

![image.png|325](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309272142949.png)

[transforms-hist.py](https://github.com/rougier/scientific-visualization-book/blob/master/code/coordinates/transforms-hist.py)

---

添加 floating axes

[transforms-floating-axis.py](https://github.com/rougier/scientific-visualization-book/blob/master/code/coordinates/transforms-floating-axis.py)

```python
# 导入包
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.transforms import Affine2D
import mpl_toolkits.axisartist.floating_axes as floating

# 定义一个新画布
fig = plt.figure(figsize=(8,8))
# 添加一个子图
ax1 = plt.subplot(1,1,1, aspect=1,xlim=[0,10], ylim=[0,10])
# 在 data coordinate 中定义 floating axes 中心
center = np.array([5,5])
# 定义横轴和纵轴的大小
size = np.array([5,3])
# 定义旋转角度
orientation = -30
# 定义floating axes 四个边界点与中心的偏离度
T = size/2*[(-1,-1), (+1,-1), (+1,+1), (-1,+1)]
# 定义旋转变换
rotation = Affine2D().rotate_deg(orientation)
# 获取旋转后的四个边界点
P = center + rotation.transform(T)
# 由于添加floating axes 需要在 normalized figure coordinate，因此需要先定义DC_to_NFC函数
DC_to_FC = ax1.transData.transform
FC_to_NFC = fig.transFigure.inverted().transform
DC_to_NFC = lambda x: FC_to_NFC(DC_to_FC(x))
# 获取旋转后的 axes 的 bounding box 边界在NFC上的坐标
xmin, ymin = DC_to_NFC((P[:,0].min(), P[:,1].min()))
xmax, ymax = DC_to_NFC((P[:,0].max(), P[:,1].max()))
# 定义transform（和rotation一样）
transform = Affine2D().rotate_deg(orientation)
# 使用helper函数，定义子图的坐标范围 (data coordinate) 和变换方式
helper = floating.GridHelperCurveLinear(
transform, (0, size[0], 0, size[1]))
# 使用FloatingSubplot函数创建一个axes
ax2 = floating.FloatingSubplot(
fig, 111, grid_helper=helper, zorder=0)
# 设定 floating axes 的bounding box，注意，这里的位置是NFC坐标，因此需要提前转换
ax2.set_position((xmin, ymin, xmax-xmin, ymax-xmin))
fig.add_subplot(ax2)
```

![image.png|350](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309272255485.png)

---

练习：

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309272342184.png)

通常，marker 和其他图形大小的单位是 point，这个练习要求输入 point 大小，实现图中的效果

```python
# ----------------------------------------------------------------------------
# Title:   Scientific Visualisation - Python & Matplotlib
# Author:  Nicolas P. Rougier
# License: Creative Commons BY-NC-SA International 4.0
# ----------------------------------------------------------------------------
import numpy as np
import matplotlib.pyplot as plt

# 创建图片 
fig = plt.figure(figsize=(8, 2))

# 设置子图
ymin, ymax = [0, 2]
xmin, xmax = [0, 8]
ax = plt.subplot(1, 1, 1, aspect=1, xlim=[xmin, xmax], ylim=[ymin, ymax])

# 定义在该figure中，每个point对应的像素数
point = fig.dpi / 72
X = 0.5 + np.arange(8)
Y = np.ones(len(X))

# Marker size is expressed in point^2 and a point is defined as fig.dpi/72
# This means that a size of 10 really means (10*point)^2
# Problem is thus to convert points into data coordinates:
# PT_to_DC = lambda x: x * ax.get_window_extent().width / (xmax-xmin)
# Note that the DC_to_PR is validonly for a given window size

# 设置从data coordinate 转换到对应的 point
DC_to_PT = lambda x: x * ax.get_window_extent().width / (xmax - xmin) / point

# scatter的大小s应该表达为 直径**2
S = DC_to_PT(1) ** 2
plt.scatter(X, Y, s=S, facecolor="none", edgecolor="black", linewidth=1)

plt.show()
```