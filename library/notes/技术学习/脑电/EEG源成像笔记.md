---
date created: Saturday, December 16th 2023, 9:11:33 pm
date modified: Wednesday, December 20th 2023, 11:05:37 pm
---
#EEG #数据处理 #源分析

参考资料：
[Forward and inverse modeling of EEG and MEG data - YouTube](https://www.youtube.com/watch?v=3Q8HLHNieuI&ab_channel=fieldtriptoolbox)
[Source reconstruction using beamforming techniques - YouTube](https://www.youtube.com/watch?v=pE0WAKd_Ve4&ab_channel=fieldtriptoolbox)

源成像/源分析可以计算脑电在大脑内的位置，提供更深入的定位信息。源一般被建模为偶极子，即一个有方向性的磁铁，模拟的是一群同时放电神经元的集合。

# 对于源的一些基本假设
- Varying“visibility” of each source to each channel
- Time course of each source contributes to each channel
- The contribution of each source depends on its "visibility"
- The activity on each channel is a superposition of all source activity


# 源分析概念和步骤

[Beamforming oscillatory responses in combined MEG/EEG data - FieldTrip toolbox](https://www.fieldtriptoolbox.org/workshop/natmeg2014/beamforming/)

![|500](https://www.fieldtriptoolbox.org/assets/img/workshop/natmeg2014/beamforming/bf_pipeline.jpg)

[The typical M/EEG workflow](https://mne.tools/stable/documentation/cookbook.html#preprocessing)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312171240166.png)


- 计算 forward model
	- 定义 source model （源本身性质和搜索空间）
		- 源模型
			- 偶极子模型
			- 电荷源模型
			- 多级源模型
		- 搜索空间
			- dipole/multidipole
			- Distributed source models
			- spatial filtering with beamformer
	- 定义 volume conductor model (组织几何特性和电磁传导特性)
		- 大脑形状
			- FDM (finite difference model)
				- 基本不用
			- BEM (boundary element model)
				- boundary element model，将大脑用表面边界分为几种组织
				- 组织内电导率均一，各向同性
				- 使用顶点和三角形描述边界
				- 可以添加复杂的拓扑细节
				- 独立于源估计方法
				- 只需计算一次
				- 计算速度快
			- FEM (finite element model)
				- 使用四面体或六面体（带有体积）来描述脑组织
				- 每一个元素都可以有自己的电导率
				- 精准但计算量巨大（6~7 h）
				- 几何计算不如 BEM 简单
		- 组织电导率 (volume conduction)
			- EEG volume conduction
				- 头皮和颅骨对电流十分敏感，需要建模地足够精准
			- MEG volume conduction
				- 磁场不会因脑组织扭曲
				- 除了源活动会产生磁场，电流在组织内流动也会产生磁场（not preferred）
				- 头皮和颅骨可以在建模时忽略
	- 电极位置信息
- 计算 inverse model （参数估计）
	- inverse model 方法
		- Single and multiple dipole models
			- 脑中有一个或几个活动源
			- 参数：位置、方向、强度
			- 参数拟合策略：
				- single dipole：全脑搜索+最优化
				- two dipoles：使用对称偶极子作为最优化起始值
				- 更多 dipoles：sequential dipole fitting
		- Distributed source models
			- 整个大脑中分布活动
			- 不再搜索偶极子的位置，而是用 grid 方式提前定义好偶极子位置
			- 参数估计：强度
			- 容易估计，但是有缺陷
				- 未知的信息多于已知
				- 有无数种可能的情况可以拟合实际数据
				- 需要添加额外的限制
					- 正则化，将活动可能性低的偶极子的强度惩罚为 0
			- 算法
				- MNE （time series）
				- eLoreta (time series)
		- Spatial filtering with beamforming
			- 不同源之间的活动之间互不相关，与噪声也无关
			- 不再估计源的位置，而是操作滤波器
				- 对源位置不再做假设
				- 假设对信号有贡献的源之间互不相关
			- 算法
				- LCMV (time series)
				- DICS (oscillation / freq)
				- PCC (oscillation / freq)


# Beamformer 进行源分析
- 使用 beamforming 的注意事项
	- 实验设计
		- 较充分的基线时间
		- 足够长的数据，以能够充分估计协方差矩阵
		- 避免伪影（肌肉）
	- 获取大脑信号
		- 去除伪迹
		- 获取电极位置
		- 减少头动（MEG）
		- 获取结构像 EEG
		- 进行定位任务（如确定被试的视觉区等）
	- 数据预处理
		- 数据分段
		- 去除伪影
	- 数据分分析
		- 时频分析


单个条件下的 beamformer

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170022402.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170023600.png)


不同条件下的 beamformer 对比

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170024639.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170025505.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170030060.png)

## oscillation 源重建的步骤

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170045522.png)

- head model: 头模和电导模型
- source model: 源的 search space
- channel position
- data：协方差和交叉谱

### Beamformer 的目标
![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170050610.png)

---

- forward model ：从源信号到头皮信号的变换关系

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170050873.png)

---

- 从通道信号变换到源信号的关系，称之为 spatial filter，作用是保留感兴趣位置的信号，过滤掉不感兴趣位置的信号

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170053909.png)

---

- spatial filter 的空间敏感性和泄露：我们无法获得绝对理想的估计

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170057713.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170059569.png)

---
- spatial filter 的求解

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170101825.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170101000.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170102258.png)

---

- 各个源的 spatial filter 应该只和各自的 source signal 乘法得 1，和其他位置 source signal 无关
- 但源并非完全独立，所以一般很难满足
- 因此，一般希望乘法结果越小越好，即方差越小越好

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170104674.png)

---

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170115542.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170115739.png)


![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170114967.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170116752.png)

---

### Beamformer 的实际操作
![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170120280.png)

### beamformer 的优点

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170121355.png)

### beamformer 的缺点
![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170123332.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170123177.png)


![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170124260.png)

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170126887.png)

### beamform 总结

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170126657.png)


# 源分析总结

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312170127604.png)
