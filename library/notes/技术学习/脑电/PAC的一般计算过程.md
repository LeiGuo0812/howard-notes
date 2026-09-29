---
date created: Thursday, December 14th 2023, 10:21:35 pm
date modified: Thursday, December 14th 2023, 10:56:07 pm
---
#EEG #数据处理 #PAC

PAC 统计分析的一般过程

[Phase-Amplitude Coupling of the Electroencephalogram in the Auditory Cortex in Schizophrenia - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2451902217301507?via%3Dihub#appsec1)

- 计算 PAC
	- 确定计算 PAC 的频段，低频窄带滤波，高频宽带滤波
	- 选择算法和 decomplex 方法（hilbert / wavelet）
	- 选择 surrogate 数据产生的方法
	- 选择数据基于 surrogate 数据校正的方法
		- 1 : substract the mean of surrogates
		- 2 : divide by the mean of surrogates
		- 3 : substract then divide by the mean of surrogates
		- 4: substract the mean then divide by the deviation of surrogates（z score）
	- 获得 comodulogram
- 统计
	- 对 comodulogram 进行 cluster-based statistic


目前，功能最完善的基于 python 的 pac 计算工具是 tensorpac

[Tensorpac — Tensorpac 0.6.5 documentation](https://etiennecmb.github.io/tensorpac/)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312142242868.png)

tensorpac 定义频段有几种方法，但是 dynamic definition 的实际 start 和 stop 不是定义的值，而是 start + 1/2 width 和 stop - 1/2 width

具体频率和带宽的选择，参考 [[Juhan Aru 2015 神经科学中的交叉频率耦合]]

可以预先用 `np.linspace` 定义高低频段的中心频率，以及定义每个频段的宽度，最后用列表推导式，计算 list of freqency bands，作为参数传入

```python
f_pha = np.linspace(3,8,50)
f_amp = np.linspace(30,100, 140)

pha_band_width = 1

amp_band_width = 2*max(f_pha)

pha_bands = [[f - pha_band_width/2, f + pha_band_width/2] for f in f_pha]
amp_bands = [[f - amp_band_width/2, f + amp_band_width/2] for f in f_amp]

model = Pac((2,3,4), f_pha=pha_bands, f_amp=amp_bands)
```