---
date created: Saturday, March 9th 2024, 10:08:02 am
date modified: Monday, April 8th 2024, 12:09:55 pm
---
#docker

[Docker镜像和容器的导入与导出 - 简书](https://www.jianshu.com/p/4e862a2a2d03)


# 镜像
- 保存
```sh
docker save -o <保存路径> <镜像名称:标签>
```

- 导入

```sh
docker load --input ./ubuntu18.tar
```


# 容器

- 保存
```sh
docker export <容器名> > <保存路径>
```

- 导入

```sh
docker import <文件路径>  <容器名>
```