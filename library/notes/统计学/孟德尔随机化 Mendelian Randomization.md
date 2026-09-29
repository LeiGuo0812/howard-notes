---
date created: Saturday, April 8th 2023, 6:06:08 pm
date modified: Monday, July 31st 2023, 9:10:24 am
---
#孟德尔随机化 

[科研小白没人带，能靠自学孟德尔随机化自救吗？ - 知乎](https://www.zhihu.com/question/557029131/answer/2754441921?utm_campaign=shareopn&utm_medium=social&utm_oi=53453552353280&utm_psn=1626537299021447168&utm_source=wechat_session)

[孟德尔随机化之基础概念与研究框架 - 知乎](https://zhuanlan.zhihu.com/p/125153774)

[内生性问题及其产生原因 - 知乎](https://zhuanlan.zhihu.com/p/110645711)

# 1.内生性问题

在一个模型中，有些变量的值是在模型内部决定的，是内生的（endogenous）；有些变量的值是被模型外界决定的，是外生的（exogenous）。在一般模型中，_被解释变量应该是内生的，解释变量应该是外生的_，解释变量的取值是不能被我们的模型所决定的。内生性问题字面意思指的是解释变量不是完全外生了，有了内生性了。

1.X 是 “外生变量”，而 Y 是“内生变量”，2. 整个系统中或者不存在其他方程，或者其他方程的存在不影响当前方程的估计结果。因此，当人们说你的模型有内生性问题的时候，他们的意思其实是：有没有可能真实的系统中实际上有另外一个方程，在其中当前的 X 位于等号左边？在这个方程中，如果右端是 Y，我们就说 X 和 Y **互为因果**；如果右端是另一个变量 Z，我们就说存在**遗漏变量**。这也就是导致内生性的两个基本原因。假如真实系统里有两条方程，你只用 OLS 估计了一条，那么因果链条的一部分就被忽视了，得到的估计也就无法反映系统中的实际情况。


# 2.孟德尔随机化

R 包：
- MendelianRandomization
- TwoSampleMR

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304082038851.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304082038285.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304082038329.png)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304082038461.png)
