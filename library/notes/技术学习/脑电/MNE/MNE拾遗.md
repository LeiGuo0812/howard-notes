[https://github.com/ZitongLu1996/Python-EEG-Handbook](https://github.com/ZitongLu1996/Python-EEG-Handbook)

[Python脑电数据处理中文手册.pdf](https://www.yuque.com/attachments/yuque/0/2021/pdf/1210419/1636037197102-afa11de5-bae4-4b8d-95c2-329341909cb4.pdf)

# 分析

## 在MNE中实现跨频耦合

使用 `pactools`包可以实现MNE的跨频耦合计算:

[https://pactools.github.io/index.html](https://pactools.github.io/index.html)

  

讨论源：

[https://mail.nmr.mgh.harvard.edu/pipermail//mne_analysis/2019-April/005809.html](https://mail.nmr.mgh.harvard.edu/pipermail//mne_analysis/2019-April/005809.html)

## MNE分析微状态 microstate

[https://github.com/wmvanvliet/mne_microstates](https://github.com/wmvanvliet/mne_microstates)

微状态分析必须用**平均参考！**

-   主要是三个函数

-   微状态分析：`maps, segmentation = mne_microstates.segment(raw.get_data(), n_states=6)`
-   绘制微状态图：`mne_microstates.plot_maps(maps, raw.info)`
-   绘制状态时间序列图：`mne_microstates.plot_segmentation(segmentation[:500], raw.get_data()[:, :500], raw.times[:500])`

注意：使用平均参考！

数据结构为：**通道×时间，**如果raw data已经分段，可以重新整理数据。但是epochs数据的数据结构为**分段×通道×时间，所以需要先** `**.transpose([1,0,2])**`**切换维度。再用** `**np.reshape((len(epochs.ch_names), -1))**`**来连接所有epoch的时间序列。**

`**np.resahpe()**`**运行时，是从最后一个维度开始重新拼接，因此拼接的顺序是 时间 -> 分段，这样所有分段的时间就头尾相接了。如果维度切换错误，得到的时间序列也是错误的，注意！**

### 基于 pycrostates 的脑电微状态分析

[https://mp.weixin.qq.com/s/y5C2UqAunM_mJyPDYCfGmA](https://mp.weixin.qq.com/s/y5C2UqAunM_mJyPDYCfGmA)

# 统计

## MNE cluster-based 统计

### 1. adjacency的定义

在MNE的cluster相关统计中，有 adjacency 参数，定义数据的毗邻关系。

#### 1.1 通道水平

如果只在通道上进行cluster检验，如功率谱检验，则可以使用 mne.channels.find_ch_adjacency 函数获取通道的毗邻信息，传给 adjacency 参数

#### 1.2 时频分析

如果是做时频分析，时间和频率之间是有毗邻关系的，所以也要进行定义，此时需要把频率、时间（如果通道水平也要cluster， 也要计算通道）的毗邻关系用 `**mne.stats.combine_adjacency**` 组合起来

`mne.stats.combine_adjacency` 可传入marix 或者 integer，matrix是自定义的毗邻关系，比如通道之间的关系，integer则定义 lattice adjacency， 即数值上相邻的即为邻居。如果需要定义毗邻关系的维度超过1个，则在 mne.stats.combine_adjacency 中定义的顺序与数据一致即可，毗邻类型可根据实际需要提供matrix或lattice。

可完全参考以下例子中的定义方式

[MNE - MNE 1.0.2 documentation](https://mne.tools/stable/auto_tutorials/stats-sensor-space/40_cluster_1samp_time_freq.html#sphx-glr-auto-tutorials-stats-sensor-space-40-cluster-1samp-time-freq-py)

如果某个维度不想设置adjacency关系（如希望每个通道的检验是独立的），则可以在相应维度上，给 mne.stats.combine_adjacency 提供一个全为0的matrix。详情看

[MNE - MNE 1.0.3 documentation](https://mne.tools/stable/generated/mne.stats.combine_adjacency.html#mne.stats.combine_adjacency)

#### 1.3 源空间分析

可以使用 `mne.spatial_src_adjacency` 函数传入src文件获取毗邻关系

### 2. 统计阈值的确定

目前，MNE提供4个cluster-based的函数

-   `mne.stats.permutation_cluster_test`
-   `mne.stats.permutation_cluster_1samp_test`
-   `mne.stats.spatio_temporal_cluster_test`
-   `mne.stat.spatio_temporal_cluster_1samp_test`

所有函数都需要提供 threshold 参数，但需要通过计算获得。

目前，所有 `1samp_test`结尾的函数都使用t-test来形成阈值，所有 `cluster_test` 结尾的函数都用F-test来形成阈值，因此，在设置各自的阈值时，也应该相应地使用t值或F值来进行指定。

-   如果使用t检验，则阈值可以用 `scipy.stats.t.ppf` 函数来指定，根据 tail 参数的不同，指定的方式也有区别，具体见 note 部分

[https://mne.tools/stable/generated/mne.stats.permutation_cluster_1samp_test.html#](https://mne.tools/stable/generated/mne.stats.permutation_cluster_1samp_test.html#)

-   如果使用F检验，阈值可以使用 `scipy.stats.f.ppf` 函数来指定，如两样本的t检验， 设置为 `f_threshold =stats.distributions.f.ppf(1. -p_threshold / 2.,n_subjects1 - 1,n_subjects2 - 1)`

如果需要更换默认统计方式，可以修改 stat_fun 参数，可以使用的有

-   `mne.stats.ttest_1samp_no_p` : 单样本t检验（ 1samp_test 默认）
-   `mne.stats.ttest_ind_no_p` ：独立样本t检验
-   `mne.stats.f_oneway` ：F检验（ cluster_test 默认）

# 绘图

## 向mne.viz.plot_topomap添加colorbar

[https://mne.discourse.group/t/mne-viz-plot-topomap-and-color-bar/3141/3](https://mne.discourse.group/t/mne-viz-plot-topomap-and-color-bar/3141/3)

```python
fig,(ax1,ax2) = plt.subplots(ncols=2)
im,cm   = mne.viz.plot_topomap(x1, info, axes=ax1,show=False,vmin=vmin,vmax=vmax)   
im,cm   = mne.viz.plot_topomap(x2, info, axes=ax2,show=False,vmin=vmin,vmax=vmax)   
```

# manually fiddle the position of colorbar

```python
ax_x_start = 0.95
ax_x_width = 0.04
ax_y_start = 0.1
ax_y_height = 0.9
cbar_ax = fig.add_axes([ax_x_start, ax_y_start, ax_x_width, ax_y_height])
clb = fig.colorbar(im, cax=cbar_ax)
clb.ax.set_title(unit_label,fontsize=fontsize) # title on top of colorbar
```
