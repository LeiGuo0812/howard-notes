---
date created: Saturday, August 10th 2024, 6:25:44 pm
date modified: Monday, August 12th 2024, 10:45:35 pm
---
如果发现无法使用 doc 函数，并报出奇怪的错：

```matlab
doc mean
usage: unique (x) or unique (x, 'rows')错误使用  > 
不支持在 string 和 double 之间进行比较。
```

1. 可能是 matlab 的搜索路径出现了问题，可以使用：

`restoredefaultpath; rehash toolboxcache;`

来重置 matlab 路径

这个问题一般出现在未能成功设置 setpath 后出现 [[Matlab can not save changes to the path 解决]]。

2. 可能是脚本编码出现问题，可以将脚本另存为 utf-8 再试