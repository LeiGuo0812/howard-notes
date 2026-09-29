---
date created: Tuesday, December 12th 2023, 10:16:48 pm
date modified: Tuesday, December 12th 2023, 10:58:17 pm
---
#Python #matplotlib
# 代码

```python
import numpy as np
import matplotlib.pyplot as plt

matrix = np.random.randint(-100,100,(20,20))

fig, ax = plt.subplots(4,4,figsize=(10,10))

fig.tight_layout()

for i in range(4):
    for j in range(4):
		im = ax[i,j].imshow(matrix, cmap='Spectral_r',vmin=-100,vmax=100)

        ax[i,j].set_title('Matrix {}'.format(i*4+j+1))

clb = fig.colorbar(im, ax=ax.ravel().tolist(), shrink=0.3)

clb.ax.set_title('value')
```

# 代码说明

## 参数说明

- 设置热图的关键是 `im = ax[i,j].imshow(matrix, cmap='Spectral_r',vmin=-100,vmax=100)` 获取热图本身的对象，其中包含了从数据到颜色的映射信息，可以用来生成 colorbar

- 使用 `cbar = fig.colorbar(im, ax=ax.ravel().tolist(), shrink=0.3)` 设置图像的 colorbar。fig 的 colorbar 方法接受一个含有颜色映射信息的对象，如 im
	- cax 指定要将 colorbar 绘制到哪个 ax 上，这个 ax 需要提前指定。可以通过 `cax = fig.add_axes([left, bottom, width, height])` 精确地添加 cax 在图上的位置
	- 如果不指定 cax，则可以指定 ax 参数，这个参数意味着多出来的热图空间从那些 ax 中偷取，如果 figure 中的 ax 不止一个，则可以传入一个 ax 的一维列表。注意：subplots 中的 ax 是一个数组，要提前转成列表再传入

## fig，ax，im，clb 对象之间的关系
-  `fig` 是整个图形的容器
- `ax` 是一个包含子图对象的数组, 其中的每一个子图对象，或者说子图（Axes），是一个绘图区域，可以在其中进行各种绘图操作，包括绘制图像、设置标题、坐标轴标签等
	- `ax` 可以被视为 `im` 的“容器”
- `im` 是通过调用 `imshow` 函数生成的图像对象，是通过调用绘图函数在 `ax`（子图）上绘制的具体图形
- `cbar` 是通过调用 `fig.colorbar` 创建的颜色条对象，是 `matplotlib.colorbar.Colorbar` 类的实例，具有多种属性和方法来调整颜色条的外观和行为
	- 在创建 colobar 时，会指定一个或多个用于绘图的 `ax` 对象，并在这些 `ax` 对象旁边或之间添加颜色条。然而，colorbar 自己也需要一个轴来放置自身，这就是 `cbar` 的 `ax` 属性的作用。它是颜色条的“家”，颜色条在其中绘制和显示。