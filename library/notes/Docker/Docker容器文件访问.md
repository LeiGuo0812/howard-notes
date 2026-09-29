---
date created: Thursday, December 12th 2024, 10:17:47 pm
date modified: Thursday, December 12th 2024, 10:27:55 pm
---
## 查看运行中的容器


```bash
# 查看正在运行的容器 
docker ps 
# 查看所有容器(包括已停止的) 
docker ps -a
```

## 容器文件操作方法

### 1. 常规运行的容器

```bash
# 进入容器内部查看 
docker exec -it <容器ID> /bin/bash 
# 直接查看指定目录 
docker exec <容器ID> ls <目录路径> 
# 文件拷贝（容器 -> 本地） 
docker cp <容器ID>:<容器内路径> <本地路径> 
# 文件拷贝（本地 -> 容器） docker cp <本地路径> <容器ID>:<容器内路径>
```

### 2. 需要输入才能运行的容器

**方法一：使用新终端操作**

- 在一个终端运行容器
- 在另一个终端执行文件操作命令

**方法二：不启动容器直接操作**

```bash
# 创建但不启动容器 
docker create <镜像名> 
# 直接拷贝文件 
docker cp <容器ID>:<容器内路径> <本地路径>
```

**方法三：修改入口点运行**

```bash
# 使用 tail 命令保持容器运行 
docker run -d --entrypoint=tail <镜像名> -f /dev/null 
# 使用 sleep 命令保持容器运行 
docker run -d --entrypoint=sleep <镜像名> infinity 
# 使用 shell 循环保持容器运行 docker run -d --entrypoint=/bin/sh <镜像名> -c "while true; do sleep 1; done"
```

## 注意事项

- 容器ID不需要输入完整，前几位能唯一标识即可
- 遇到权限问题可以尝试加上 sudo
- 如果容器没有 bash，可以使用 sh：`docker exec -it <容器ID> /bin/sh`
- 使用 `docker inspect <容器ID>` 可以查看容器详细信息

## 选择建议

- 仅需查看/复制文件：使用 `docker create` 方法最简单
- 需要容器保持运行：使用修改入口点的方法
- 容器正在运行但需要输入：使用新终端执行操作命令


## 在 Docker 容器中查找文件的方法

1. 使用 `find` 命令（最常用）：
```bash
# 在整个容器中查找文件
docker exec <容器ID> find / -name "<文件名>"

# 在特定目录下查找
docker exec <容器ID> find /path/to/dir -name "<文件名>"

# 使用通配符查找
docker exec <容器ID> find / -name "*.txt"
```

2. 使用 `locate` 命令（如果容器中安装了）：
```bash
# 先更新数据库
docker exec <容器ID> updatedb
# 然后查找
docker exec <容器ID> locate <文件名>
```

3. 使用 `grep` 递归搜索文件内容：
```bash
# 递归搜索包含特定内容的文件
docker exec <容器ID> grep -r "搜索内容" /path/to/dir

# 显示文件名和行号
docker exec <容器ID> grep -rn "搜索内容" /path/to/dir
```

一些实用的 `find` 命令选项：
```bash
# 忽略大小写
docker exec <容器ID> find / -iname "<文件名>"

# 仅查找文件
docker exec <容器ID> find / -type f -name "<文件名>"

# 仅查找目录
docker exec <容器ID> find / -type d -name "<目录名>"

# 按大小查找（大于100MB的文件）
docker exec <容器ID> find / -size +100M
```

注意事项：
- 如果容器未运行，可以先用前面讨论的方法启动容器
- 查找系统文件时可能需要 root 权限，可以加上 `--user root`
- 查找大文件系统时可能比较慢，建议指定特定目录
- 某些系统目录可能会报权限错误，可以忽略错误输出：`2>/dev/null`

完整示例：
```bash
# 忽略错误信息查找文件
docker exec <容器ID> find / -name "config.json" 2>/dev/null

# 使用root权限查找
docker exec --user root <容器ID> find / -name "config.json" 2>/dev/null

# 在特定目录下查找并忽略大小写
docker exec <容器ID> find /etc -iname "*.conf" 2>/dev/null
```