---
date created: Saturday, September 14th 2024, 10:59:33 am
date modified: Saturday, September 28th 2024, 8:08:28 pm
---
meta 包中有计算效应量的函数 `metacont`

## 关于计算前后变化的标准差: SD of Change

仅有干预前后的均值和标准差的数值是不足以计算变化的标准差的，需要额外引入一个相关系数参数，才能计算，Cohran 的推荐值是 0.5

[Chapter 6: Choosing effect measures and computing estimates of effect | Cochrane Training](https://training.cochrane.org/handbook/current/chapter-06#section-6-5-2-8)

- 相关链接
	- [\[Q\] Help calculating the Pre-post Δ (Standard deviation) : r/statistics](https://www.reddit.com/r/statistics/comments/11f6u3y/q_help_calculating_the_prepost_%CE%B4_standard/)
	- [Frontiers | Calculating and reporting effect sizes to facilitate cumulative science: a practical primer for t-tests and ANOVAs](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00863/full)
	- [SD of Change for Meta-Analysis? | ResearchGate](https://www.researchgate.net/post/SD-of-Change-for-Meta-Analysis)

Cohen's d 的计算因设计的不同而有所变化。在独立样本设计中，Cohen's d 使用的是合并标准差 (pooled standard deviation)，而在重复测量（被试内设计）中，标准差的计算则会考虑前后测量之间的相关性。因此，它们的计算方式有所区别。

## Cohen's d 中合并标准差与被试内变化标准差
### 1. **Cohen's d 中的合并标准差计算（独立样本设计）**

在独立样本设计中，合并标准差用于比较两组（如实验组和对照组）的效应量。其公式为：

$S_p = \sqrt{\frac{(n_1 - 1)S_1^2 + (n_2 - 1)S_2^2}{n_1 + n_2 - 2}}$

其中：
- \( S_1 \) 和 \( S_2 \) 分别是两组的标准差。
- \( n_1 \) 和 \( n_2 \) 分别是两组的样本大小。

这就是所谓的**加权标准差**，它考虑了两个组的样本大小。合并标准差通过加权每组的方差，以此来综合组内变异，从而得出一个代表总体变异的标准差。

#### 具体步骤：
1. 计算每个组的方差：\( S_1^2 \) 和 \( S_2^2 \)。
2. 按照每组的自由度加权：\( (n_1 - 1) \) 和 \( (n_2 - 1) \)。
3. 求和并除以总的自由度 \( n_1 + n_2 - 2 \)。
4. 最后取平方根，得到合并标准差 \( S_p \)。

#### 示例代码：
假设实验组和对照组的标准差分别为 5 和 6，样本大小分别为 30 和 35：

```R
# 实验组和对照组的数据
S1 <- 5  # 实验组标准差
S2 <- 6  # 对照组标准差
n1 <- 30  # 实验组样本数
n2 <- 35  # 对照组样本数

# 计算合并标准差
Sp <- sqrt(((n1 - 1) * S1^2 + (n2 - 1) * S2^2) / (n1 + n2 - 2))
Sp
```

### 2. **被试内设计中的变化标准差计算**

在被试内设计（重复测量设计）中，Cohen's d 计算的是相同被试在前后条件（或不同时间点）的均值变化。因此，它使用的不是两组独立样本的合并标准差，而是**变化的标准差** \( SD_{\text{change}} \)，它不仅依赖于前测和后测的标准差，还依赖于前后测量之间的相关性 \( r \)。

#### 变化标准差的计算公式：
$SD_{\text{change}} = \sqrt{SD_{\text{pre}}^2 + SD_{\text{post}}^2 - 2 \times r \times SD_{\text{pre}} \times SD_{\text{post}}}$

其中：
- \( SD_{\text{pre}} \) 和 \( SD_{\text{post}} \) 分别是前测和后测的标准差。
- \( r \) 是前后测量之间的相关性（同一被试在前后测量间的相关性）。
#### 区别：
- 在独立样本设计中，合并标准差只需要考虑每组的标准差和样本大小。
- 在被试内设计中，变化的标准差考虑了**前后测量之间的相关性**，以及每次测量的标准差。
#### 示例代码：
假设前测和后测的标准差分别为 5 和 6，前后测量之间的相关性 \( r = 0.5 \)：

```R
# 前测和后测的标准差
SD_pre <- 5
SD_post <- 6
r <- 0.5  # 前后测量的相关性

# 计算变化标准差
SD_change <- sqrt(SD_pre^2 + SD_post^2 - 2 * r * SD_pre * SD_post)
SD_change
```
### 3. **两者的关键区别**
- **合并标准差**：用于独立样本设计，反映的是两组独立样本的总体变异性，它是基于两组各自的方差和样本大小加权计算的。
- **变化的标准差**：用于被试内设计，反映的是同一被试在前后测量中变化的标准差，它不仅依赖于前后测量的标准差，还考虑了前后测量之间的相关性。变化标准差越小，表示前后测量的变化越一致。
### 总结：
- 在 **独立样本设计** 中，Cohen's d 使用的是合并标准差 \( S_p \)，它通过两组的标准差和样本大小来计算。
- 在 **被试内设计** 中，Cohen's d 使用的是变化的标准差 \( SD_{\text{change}} \)，它不仅考虑前后测量的标准差，还考虑了测量之间的相关性。
两者计算方式的根本区别在于是否考虑了测量之间的相关性。在重复测量的设计中，由于每个被试都有多次测量，因此必须通过变化的标准差来捕捉这种内部的相关性。

# 根据 F 值或 eta^2 计算 Hedge's g

[Effect Size Transformation | Tobiasz Trawinski](https://tobiasztrawinski.com/post/effect-size-transormation/)

