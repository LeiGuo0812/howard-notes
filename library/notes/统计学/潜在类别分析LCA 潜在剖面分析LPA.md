---
date created: Friday, July 12th 2024, 10:50:18 am
date modified: Friday, July 12th 2024, 11:29:10 am
---
# LCA

## 参考链接

[潜在类分析与聚类分析-推断的差异？](https://qastack.cn/stats/122213/latent-class-analysis-vs-cluster-analysis-differences-in-inferences)

[Latent Class Analysis Using R | Office of Population Research](https://pop.princeton.edu/events/2020/latent-class-analysis-using-r)

[潜类别分析(Latent Class Analysis, LCA)与Mplus应用(含潜剖面分析, Latent Profile Analysis, LPA)\_哔哩哔哩\_bilibili](https://www.bilibili.com/video/BV11h411v7MJ)

## LCA 的 Mplus 实现

### 语法

```mplus
!Mplus 语法

DATA:
FILES IS data.dat;
!数据应为.dat格式

VARIABLE:
NAMES ARE
A B C D E;

USEVARIABLE ARE A B C D E;
!指定需要分析的变量,也可以简写为USEVAR

CATEGORICAL=A B C D E;
!LCA分析需要指定变量为分类变量

CLASSES=C(4);
!指定潜在类别为4类，通常需要设置1~10类左右

ANALYSIS:
TYPE=MIXTURE;
!设定类别为混合模型
OPTSEED=123;
!根据上一次最优结果的随机种子直接跑出最优模型而不用迭代

OUTPUT:
TECH11 TECH14;
!输出特定项，即LMR(TECH11)和BLRT（TECH14）检验

SAVE:
FILE=cprob.txt;
SAVE=CPROB;
!保存结果，主要是每个个案的分类概率和最后所处的分类
```

### 结果

在 .out 文件中找到结果

- **最优随机种子**

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121102664.png)

- **模型拟合结果**

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121102248.png)

模型相关指标与拟合度检验结果，红框所示为主要报告指标由于默认MLR估计，所以提供校正因子(也可以改为ML估计)。AIC、BIC和aBIC三个信息指标应该越小越好，主要报告的结果之一

- AlC=Akaike Information Criterion
- BIC=Bayesian Information Criterion
- aBlC=Sample Size Adjusted BIC, 或写作SSBIC
- **潜在类别概率**

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121103976.png)

- 熵

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121103877.png)

Lubke和Muthén(2007)的研究表明：

Entropy<0.60表示>20%的个案分类错误(<80%个案分类正确)

Entropy>0.80表示>90%的个案分类正确

Lubke,G.,Muthen,B.O.(2007).Performance of factor mixture models as a function of model size, covariate effects,and class-specific parameters.Structural Equation Modeling:A Multidisciplinary Journal,,14(1),26-47.


- 后验概率平均值（较少报告）

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121104325.png)

行的人有多少人被分配到列中（分错了）

Rost(2006)认为： (左上右下的)对角线数值>0.8的分类方案才是好方案

Rost,J.(2006).Latent-Class-Analyse [Latent class analysis].In F.Petermann M.Eid (Eds.),Handbuch de Psycologischen Dianostik Handbook of Psychological Assessment.Gottingen,Germany: Hogrefe.

- 条件概率

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121105957.png)

- 报告方式

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121105557.png)

**绘图**

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121106962.png)


- LMR检验（TECH11）

 ![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121106734.png)

报告P值，一般只看LMR检验的P值


- BLRT检验（TECH14）

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121107712.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121118668.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121119866.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121119069.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121119953.png)

### 数据结果

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121119462.png)

### 后续分析

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121120152.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121120511.png)

### 总结

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121123146.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121123136.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121123007.png)

# LPA

## Mplus

### 语法

```mplus
!Mplus 语法

DATA:
FILES IS data.dat;
!数据应为.dat格式

VARIABLE:
NAMES ARE
A B C D E;

USEVARIABLE ARE A B C D E;
!指定需要分析的变量,也可以简写为USEVAR

!LPA无需指定分类变量，直接做即可

CLASSES=C(4);
!指定潜在类别为4类，通常需要设置1~10类左右

ANALYSIS:
TYPE=MIXTURE;
!设定类别为混合模型
OPTSEED=123;
!根据上一次最优结果的随机种子直接跑出最优模型而不用迭代

OUTPUT:
TECH11 TECH14;
!输出特定项，即LMR(TECH11)和BLRT（TECH14）检验

SAVE:
FILE=cprob.txt;
SAVE=CPROB;
!保存结果，主要是每个个案的分类概率和最后所处的分类
```

### 2. 结果：与LCA的区别

- 没有条件概率

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121127646.png)

给的是各个类别在每个题目上选择的均值和方差

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121128105.png)

# 进阶

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407121129989.png)
