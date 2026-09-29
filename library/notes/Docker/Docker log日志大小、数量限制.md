---
date created: Monday, April 8th 2024, 12:11:10 pm
date modified: Friday, April 12th 2024, 10:58:18 am
---
# 大小、数量限制

[Docker 控制容器日志大小的方法 - 知乎](https://zhuanlan.zhihu.com/p/651102277)

运行docker 时添加额外参数：

```
docker run -d \
  --name example-container \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  nginx:latest
```