---
date created: Wednesday, March 8th 2023, 10:42:38 pm
date modified: Saturday, March 9th 2024, 9:40:30 pm
---
#MRI #统计学 #空间相关

Xia, M., Liu, J., Mechelli, A., Sun, X., Ma, Q., Wang, X., … He, Y. (2022). Connectome gradient dysfunction in major depression and its association with gene expression profiles and treatment outcomes. _Molecular Psychiatry_, 1–10. (0 citation(s)). [https://doi.org/10.1038/s41380-022-01519-5](https://doi.org/10.1038/s41380-022-01519-5)

该文章计算MDD梯度变化脑图与基因表达脑图时，使用对PLS的显著性进行了**基于保留空间自相关的随机图生成过程**进行了显著性检验。

Burt, J. B., Helmer, M., Shinn, M., Anticevic, A., & Murray, J. D. (2020). Generative modeling of brain maps with spatial autocorrelation. _NeuroImage_, _220_, 117038. (67 citation(s)). [https://doi.org/10.1016/j.neuroimage.2020.117038](https://doi.org/10.1016/j.neuroimage.2020.117038)

详细介绍了该方法

![](https://cdn.nlark.com/yuque/0/2022/png/1210419/1656408597818-e93622f6-0ef3-4281-8b48-518911b10140.png)

对脑图计算Variogram，描述的是随距离远近导致的数据变异，可以描述空间自相关的信息。

引入基于K近邻的指数衰减平滑核对生成的随机脑图进行平滑，重新引入空间自相关，并通过迭代寻找K值，使得平滑后脑图的Variogram和原始脑图的Variogram的SSE最小，这样即保证了在这一次随机中，随机脑图的空间自相关性被最大限度的保留。

保留空间自相关性的原因是，空间自相关性本身对统计推断有明显影响：

![](https://cdn.nlark.com/yuque/0/2022/png/1210419/1656408611970-fc8a9c67-577f-4b98-9eef-c32854a1f749.png)

使用保留空间自相关的随机图进行相关性统计，会使得p值增大。由完全随机图产生的Null分布非常狭窄，而保留了自相关的随机图分布更宽。因此空间自相关对统计结果有显著影响。

![](https://cdn.nlark.com/yuque/0/2022/png/1210419/1656408628566-00719604-57ff-4510-9eb8-8bd38977839e.png)

使用忽略自相关为假设的统计方法（Pearson’s correlation）对两个保留自相关的随机图进行分析，发现其相关性很大概率是显著的。

文章附带的开源软件：BrainSMASH

[BrainSMASH - BrainSMASH documentation](https://brainsmash.readthedocs.io/en/latest/)

生成基于volume的随机脑图

[https://brainsmash.readthedocs.io/en/latest/example.html#volume-example](https://brainsmash.readthedocs.io/en/latest/example.html#volume-example)