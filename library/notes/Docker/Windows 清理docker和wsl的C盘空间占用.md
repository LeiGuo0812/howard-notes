[Windows11下清理Docker Desktop与wsl的C盘空间占用\_wsl清理缓存-CSDN博客](https://blog.csdn.net/qyfx123456/article/details/133779551)

# Docker 清理

```sh
//【查看docker 占用的空间】
docker system df


TYPE 列出了docker 使用磁盘的 4 种类型：
Images：所有镜像占用的空间，包括拉取下来的镜像，和本地构建的。

Containers：运行的容器占用的空间，表示每个容器的读写层的空间。

Local Volumes：容器挂载本地数据卷的空间。

Build Cache：镜像构建过程中产生的缓存空间（只有在使用 BuildKit 时才有，Docker 18.09 以后可用）。

RECLAIMABLE ：可回收大小。


//【镜像的磁盘占用】
//列出所有悬挂状态的镜像：docker image ls -f dangling=true
//1-删除镜像
docker image prune  或者 docker image rm $(docker image ls -f dangling=true -q)

                     

//【数据卷的磁盘占用】
//2-删除不再使用的数据卷
docker volume prune   或者   docker volume rm $(docker volume ls -q)


//【Build Cache 的磁盘占用】
//3-删除 build cache磁盘占用
docker builder prune  


//【4-一键清理】
docker system prune
```

# WSL 清理

找到docker 使用的wsl ext4.vhdx 文件，然后压缩 [[windows/WSL/WSL相关（升级、图形界面、释放空间）|WSL相关（升级、图形界面、释放空间）]]

