---
date created: Monday, August 28th 2023, 10:31:08 am
date modified: Monday, August 28th 2023, 10:33:57 am
---
#Python #matplotlib

```python
import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif']=['SimHei'] #用来正常显示中文标签
plt.rcParams['axes.unicode_minus']=False #用来正常显示负号
# 等价于
plt.rc('axes', unicode_minus = False)
```