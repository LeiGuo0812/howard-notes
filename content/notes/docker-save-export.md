---
title: Docker 镜像与容器导出，分别保存了什么
description: 区分 save/load 与 export/import，避免把文件系统快照当成完整运行环境备份。
date: 2026-09-30
created: 2024-03-09
modified: 2026-09-30
tags:
  - Docker
  - 环境配置
category: 系统与开发环境
type: article
featured: false
publish: true
draft: false
---
Docker 的两组导出命令面对不同对象。迁移镜像时用 `save/load`；需要容器文件系统快照时用 `export/import`。

| 目标 | 导出 | 导入 |
| --- | --- | --- |
| 镜像及其层和标签 | `docker save` | `docker load` |
| 容器文件系统 | `docker export` | `docker import` |

## 保存并加载镜像

下面以本机已有的 `nginx:stable` 镜像为例：

```bash
docker save -o nginx-image.tar nginx:stable
```

把文件传到目标机器后加载：

```bash
docker load --input nginx-image.tar
docker image ls nginx
```

`save` 保存镜像层以及所选标签，适合传递已构建的镜像。[docker image save](https://docs.docker.com/reference/cli/docker/image/save/)

## 导出容器文件系统

下面假设本机已有名为 `example-container` 的容器：

```bash
docker export --output container-rootfs.tar example-container
docker import container-rootfs.tar local/rootfs:imported
```

`import` 的结果是镜像，最后的名称是镜像引用，不是新容器的名字。

> [!warning] 数据卷需要单独备份
> `docker export` 不会导出挂载数据卷里的内容。数据库文件或其他持久化数据如果存放在卷中，需要单独设计备份与恢复步骤。

有关挂载卷的行为，参见 [docker container export](https://docs.docker.com/reference/cli/docker/container/export/)。

迁移后还需要恢复启动参数、端口、环境变量和卷挂载等配置。日志设置也应写进部署配置，见 [[notes/docker-log-rotation|给 Docker 容器设置日志轮转]]。

原笔记参考：[Docker 镜像和容器的导入与导出](https://www.jianshu.com/p/4e862a2a2d03)。
