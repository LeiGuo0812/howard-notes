---
date created: Saturday, August 5th 2023, 9:08:34 pm
date modified: Saturday, August 5th 2023, 9:39:18 pm
---
#网络分析

![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202308052110255.png)

Isvoranu, A.-M., Guloksuz, S., Epskamp, S., Os, J. van, Borsboom, D., & Investigators, G. (2020). Toward incorporating genetic risk scores into symptom networks of psychosis. _Psychological Medicine_, _50_(4), 636–643. [https://doi.org/10.1017/S003329171900045X](https://doi.org/10.1017/S003329171900045X)

首先构建一个 qgraph 网络

```r
library(qgraph)
library(bootnet)

network <- estimateNetwork(mtcas, default = "EBICglasso")
net = qgraph(network)
```

然后使用 `qgraph` 包中的 `flow()` 函数，并选定一个节点为主节点，它作为最左侧的一个节点

```r
flow(net, 'mpg')
```
