---
date created: Saturday, December 14th 2024, 4:44:19 pm
date modified: Saturday, December 14th 2024, 4:49:14 pm
---
1. 下载并安装 docker
2. 获取 neurodesktop 镜像：`docker pull vnmd/neurodesktop:latest`
3. 命令行运行：

```shell
docker run -it --privileged --user=root --name neurodesktop -v `pwd`:/neurodesktop-storage --mount source=neurodesk-home,target=/home/jovyan -p 8888:8888 vnmd/neurodesktop:latest
```