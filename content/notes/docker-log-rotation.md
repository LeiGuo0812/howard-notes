---
title: 给 Docker 容器设置日志轮转
description: 用 max-size 和 max-file 控制日志增长，并检查配置是否真正生效。
date: 2026-09-30
created: 2024-04-08
modified: 2026-09-30
tags:
  - Docker
  - 运维
category: 系统与开发环境
type: article
featured: true
publish: true
draft: false
---
容器持续输出日志时，先给日志文件设置大小和保留数量，能让磁盘占用更容易管理。这篇笔记整理了 `json-file` 驱动的最小配置。

## 为新容器设置上限

```bash
docker run -d \
  --name log-demo \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  nginx:stable
```

`max-size=10m` 指定单个日志文件的轮转阈值，`max-file=3` 指定最多保留的日志文件数。两者需要一起配置：只设置 `max-file` 不会启用按大小轮转。[Docker 日志驱动文档](https://docs.docker.com/engine/logging/drivers/json-file/)

## 检查当前配置

```bash
docker inspect --format '{{json .HostConfig.LogConfig}}' log-demo
docker logs --tail 20 log-demo
```

第一条命令应包含 `json-file`、`max-size` 和 `max-file`；第二条用于确认仍能读取日志。无需直接操作 Docker 内部的日志文件。

> [!tip] 已存在的容器
> 修改 Docker 的默认日志配置不会自动改变已有容器。更新服务配置后，应按自己的部署流程重新创建相应容器。

日志配置是日常维护的一部分。需要把环境转移到另一台机器时，可以继续阅读 [[notes/docker-save-export|Docker 镜像与容器导出，分别保存了什么]]。

## 原笔记与参考

本文由原有的 Docker 日志设置笔记整理而来，补充了驱动声明与验证步骤。原笔记参考：[Docker 控制容器日志大小的方法](https://zhuanlan.zhihu.com/p/651102277)。
