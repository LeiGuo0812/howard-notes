#统计学 #PLS

Xia, M., Liu, J., Mechelli, A., Sun, X., Ma, Q., Wang, X., … He, Y. (2022). Connectome gradient dysfunction in major depression and its association with gene expression profiles and treatment outcomes. _Molecular Psychiatry_, 1–10. (0 citation(s)). [https://doi.org/10.1038/s41380-022-01519-5](https://doi.org/10.1038/s41380-022-01519-5) <br />文中使用了 PLS 进行了大脑梯度分数和大脑基因分布关系的探究，说明基因对大脑梯度的贡献程度。

# 偏最小二乘相关的过程包括：

1. 对自变量和因变量进行**标准化**
2. 计算自变量和因变量的成分，该成分是自变量或因变量的线性组合（当因变量只有一个时，因变量无需计算主成分）
3. 使用自变量的成分作为新的自变量进行线性回归，使得对因变量的解释最大

# 各种基于降维算法的区别：

- 主成分分析能够在信息损失最小的前提下，用少数综合变量概括原多变量数据，分析的是单个数据集
- 典型相关对地位相等的数据集 X 和 Y 分析两者之间的相关关系。
- 主成分回归对自变量数据集 X 进行主成分分析，目标是对 X 的解释程度最大，然后对 Y 做线性回归，但求得的 X 的主成分不受 Y 的约束。
- 偏最小二乘回归分析的两个数据集之间是不对称的，Y 表示被解释变量的集合，X 表示解释变量的积和。偏最小二乘回归是求因变量集合 Y 对自变量积和 X 的线性回归模型。

# B 站视频讲解

[pls理论\_哔哩哔哩\_bilibili](https://www.bilibili.com/video/BV1oE411K7fT/?p=1)
<a name="bb 5 b 84 d 4"></a>
# *PLS 算法的详细步骤：

[6.7.7. How the PLS model is calculated — Process Improvement using Data](https://learnche.org/pid/latent-variable-modelling/projection-to-latent-structures/how-the-pls-model-is-calculated)

# *PLS 中，weight，loading，score 的概念：

[scikit learn - PLS (partial least squares) weights, loadings, and scores interpretations - Cross Validated](https://stats.stackexchange.com/questions/235809/pls-partial-least-squares-weights-loadings-and-scores-interpretations#:~:text=The%20%22weights%22%20in%20a%20PLS,hand%2C%20translate%20T%20to%20X)

![image.png](https://cdn.nlark.com/yuque/0/2022/png/1210419/1656405783204-cc6b0cfe-2537-4256-aa7f-619633cea57d.png#clientId=u705e7731-06a0-4&from=paste&height=497&id=u2d45d521&name=image.png&originHeight=746&originWidth=2000&originalType=binary&ratio=1&rotation=0&showTitle=false&size=54265&status=done&style=none&taskId=ue1df493b-9e05-4525-978c-372bb89ec59&title=&width=1333.3333333333333)

- 以第 X 的一个主成分 a 为例
- score 即该主成分的值
- weight w 即 X 的每一列以 t。为因变量做回归的系数
- loading p 则是 ta 以 X 中每一列为因变量做回归的系数
- 有的软件还会提供 R 值，它是所有成分的 weight,即 T=XR

# 解释模型时看什么？

[Different kinds of PLS weights, loadings, and what to look at? - Eigenvector](https://eigenvector.com/different-kinds-of-pls-weights-loadings-and-what-to-look-at/)

- 如果以潜变量的观点，探究 t 的潜变量性质，则主要看 p
- 如果把 PLS 作为一个普通的方法，看变量贡献，看 w

<a name="6901 e 592"></a>
# R 语言实现
[pls-manual.pdf](https://www.yuque.com/attachments/yuque/0/2022/pdf/1210419/1656405832872-0c78728e-37f5-4f84-b751-d52b04a0001d.pdf?_lake_card=%7B%22src%22%3A%22https%3A%2F%2Fwww.yuque.com%2Fattachments%2Fyuque%2F0%2F2022%2Fpdf%2F1210419%2F1656405832872-0c78728e-37f5-4f84-b751-d52b04a0001d.pdf%22%2C%22name%22%3A%22pls-manual.pdf%22%2C%22size%22%3A468096%2C%22type%22%3A%22application%2Fpdf%22%2C%22ext%22%3A%22pdf%22%2C%22source%22%3A%22%22%2C%22status%22%3A%22done%22%2C%22download%22%3Atrue%2C%22taskId%22%3A%22u95fdb65f-501b-46de-847f-5d59cb43672%22%2C%22taskType%22%3A%22upload%22%2C%22__spacing%22%3A%22both%22%2C%22id%22%3A%22u765b9f8a%22%2C%22margin%22%3A%7B%22top%22%3Atrue%2C%22bottom%22%3Atrue%7D%2C%22card%22%3A%22file%22%7D)

# Python 实现

[GitHub - rmarkello/pyls: A Python implementation of Partial Least Squares (PLS) decomposition](https://github.com/rmarkello/pyls)

```python
import numpy as np

# let's create two data arrays with 80 observations

X = np.random.rand(80, 10000)  # a 10000-feature (e.g., neural) data array

Y = np.random.rand(80, 10)     # a 10-feature (e.g., behavioral) data array

from pyls import pls_regression

plsr = pls_regression(X, Y, n_components=10, n_perm=1000, n_boot=1000, n_proc= 4)

plsr

PLSResults(x_weights, x_scores, y_scores, y_loadings, varexp, permres, bootres, inputs)
```

使用 permutation 计算 $R^2$ 显著性时，可以设置 `n_boot=0`，来加快运算速度。