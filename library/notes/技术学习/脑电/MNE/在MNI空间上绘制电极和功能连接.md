---
date created: Wednesday, December 6th 2023, 11:29:21 am
date modified: Wednesday, December 6th 2023, 1:30:49 pm
---
# 准备
MNE 的 montage 文件中，电极的 position 信息**已经是在 MNI 标准空间的坐标**，所以可以直接使用。

>[!warning]
>MNE 使用国际单位制 (SI)，坐标单位为 m，使用之前应转换为 mm

```python
import numpy as np
import mne

# fetch a montage
montage=mne.channels.make_standard_montage("standard_1005")

# get position of electrodess
pos = montage.get_positions()["ch_pos"]

# organize coordinate data
coord = [mni for elec, mni in pos.items()]

# aggregate and convert to mm
coord = np.stack(coord) * 1e+3
```


接下来就可以使用 [netplotbrain](https://www.netplotbrain.org/) 工具绘制电极位置和功能连接

- 安装 netplotbrain `pip install netplotbrain` （conda/mamba 上暂时没有）

- netplotbrain 可绘制的图像如下：

![image.png|475](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312061146915.png)

- 绘制之前，需要准备好数据，具体要求可见：[Tutorial 1: Input data - netplotbrain](https://www.netplotbrain.org/tutorial/tutorial1_input/)

 - 对于脑电的 sensor 来说，只需要准备 node（电极）和 edge （连接）文件即可
	 - node：一个 N × 3 的 dataframe，N 为电极数量，3 为 MNI 坐标，用 'x','y','z'命名，可以设置额外的列，以定义节点的大小、颜色等，作为参数传入
	 - edge: 一个 N×N 的 adjacency matrix 或一个 edgelist （长格式），也可以额外定义 edge 的 alpha，color，weight 等参数


# 仅绘制 node
```python
import netplotbrain
import pandas as pd

# convert coordinates to a dataframe
coord_df = pd.DataFrame(coord)

# set column names
coord_df.columns = ["x", "y", "z"]

# plot the electordes in superior  view
# possible views are 'LRAPSIs' 
# see https://www.netplotbrain.org/tutorial/tutorial2_views/
netplotbrain.plot(
    nodes=coord_df,
    view = 'S')
```

![image.png|254](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312061215059.png)

# 绘制连边

```python
# prepare symmatric 0,1 adjacency matrix
edges = np.random.choice([0,1],(coord.shape[0], coord.shape[0]), p=[0.9999, 0.0001])
edges_diag = edges + edges.T
edges_diag = np.where(edges_diag == 0, 0, 1)
n, m = edges_diag.shape
for i in range(min(n, m)):
    edges_diag[i, i] = 0

# plot
netplotbrain.plot(
    nodes=coord_df,
    edges=edges,
    edge_alpha = 0.5,
    view = 'S')
```

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312061216239.png)

# 绘制图像时带上脑作为底图
- 可以使用一个现成的 T1w 的 nii 或 nii.gz 图像作为底图，不过更方便的方法是安装 templateflow 库，自动获取 template 并使用：
	- `pip install templateflow` （conda/mamba 中暂时没有）

```python
netplotbrain.plot(
    nodes = coord_df,
    edges = edges,
    edge_alpha = 0.5,
    template='MNI152NLin6Asym',
    view = 'S'
)
```

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312061222969.png)

templateflow 会帮你自动下载模板并使用

template 也可以传入一个本地的 T1w image 的路径使用

关于绘制时的其他参数，可参考：[API - netplotbrain](https://www.netplotbrain.org/api/)


# 取消箭头指示和标题

使用参数 `arrowaxis = None` 和 `title = None` 即可