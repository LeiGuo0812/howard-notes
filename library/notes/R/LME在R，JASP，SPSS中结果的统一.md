---
date created: Monday, January 22nd 2024, 8:08:49 pm
date modified: Thursday, January 25th 2024, 5:18:44 pm
---
#R语言 #SPSS #JASP #LME

记录如何在 R，JASP，SPSS 中获得统一的 LME 结果

# R
## 设置因子内对照方式为 constr.sum

```r
options(contrasts = c('contr.sum','contr.poly'))
```

R 中默认的对照方式为 `contr.treatment`, 而 SPSS 和 JASP 的默认对照方式为 `contr.sum`, 对照方式会影响线性模型系数估计和检验的结果，**也会影响方差分析表的结果**。如果想获得完全一致的结果，则需要修改内对照方式，且模型的参照水平/对比矩阵要一致。

## 拟合模型

```r
# fit linear mixed effect model for rt with right answer
fit = lmer('rt ~ group * session * condition + (1| ID)', 
           data = data)

# check result
summary(fit)

# check anova table
# use Kenward-Roger `"F"` tests with Satterthwaite degrees of freedom (_warning:_ the KR F-tests can be very time-consuming).
Anova(fit, type = 3, test.statistic = 'F')
```

# JASP

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222022573.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222023153.png)

这里的检验方式选择 Kenward-Roger 方法，其自由度估计方式就和 R 一致了

# SPSS
![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222024690.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222025515.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222025677.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222025542.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222025315.png)

这里的自由度方式也选择 Kenward-Roger 方法

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222026737.png)

设置好以后 run 即可


# 结果对比

## R

### 线性模型表

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222030582.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222030087.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222031670.png)

### 方差分析表

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222031764.png)


## JASP

### 线性模型表

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222033324.png)

### 方差分析表

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222033590.png)

## SPSS

### 线性模型表

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222032329.png)

### 方差分析表

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202401222034778.png)


可见，方差分析表的结果是完全一致的

# 总结

因此，要想三个软件的结果完全一致，需要注意几个方面：

- 模型中因子型的变量类型要指定正确
- R 的因子内对照方式应该设置为 `contr.sum`
	- 相关讨论
		- [Reproducing GLMM in R — Forum](https://forum.cogsci.nl/discussion/7544/reproducing-glmm-in-r)
		- [Using Generalized Linear Mixed Model for Signal Detection Theory — Forum](https://forum.cogsci.nl/discussion/7311/using-generalized-linear-mixed-model-for-signal-detection-theory)
		- [LMM in JASP: factor coding — Forum](https://forum.cogsci.nl/discussion/6580/lmm-in-jasp-factor-coding)
- 方差分析表的方差类型应为 3 类方差
- 关于方差分析表中自由度的估计方式
	- 对于一般 LME，如果使用 `car` 包的 `Anova` 函数获取方差分析表，自由度估计方式应该统一为 Kenward-Roger 方法，即可获得一致结果，但对于 GLME，`Anova` 函数则无法提供对应方法
	- `afex` 包提供了更佳灵活的的选择方法，不管是一般 LME 还是 GLME，其 `method` 参数中都有对应相同的估计方式，能够保证获得完全一致的结果 [[线性混合效应模型#afex 包]]
- 对于 GLME 中的 contrast，R 和 SPSS 之间的 contrast 方式有所区别，可以参考讨论：[Different post hoc contrast results of Generalized Linear Mixed Model in R and JASP — Forum](https://forum.cogsci.nl/discussion/9097/)