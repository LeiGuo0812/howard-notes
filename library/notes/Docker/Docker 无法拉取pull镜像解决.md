---
date created: Friday, July 12th 2024, 11:26:10 pm
date modified: Friday, July 12th 2024, 11:34:54 pm
---
[两种方案解决无法拉取 docker 镜像的问题\_哔哩哔哩\_bilibili](https://www.bilibili.com/video/BV1w4421X7jE/?spm_id_from=333.1007.top_right_bar_window_history.content.click&vd_source=f05e6f927cb14747ba5653a9619a978c)

# 更换镜像源

一些可用的镜像源
https://dockerpull.com
https://docker.1panel.live 
https://dockerproxy.cn 
https://docker.hpcloud.cloud

## 永久更换

### linux

```bash
sudo mkdir -p /etc/docker 
sudo tee /etc/docker/daemon.json <<-'EOF' {  "registry-mirrors": ["请替换为您自己的代理服务ip或者域名"]  } 
EOF 
sudo systemctl daemon-reload 
sudo systemctl restart docker
```

### windows

搜索 docker 目录下的 daemon.json，添加代码：

```
{  
"registry-mirrors": ["请替换为您自己的代理服务ip或者域名"]
} 
```

## 单次拉取更换

**假如拉取原始镜像命令如下**

```bash
docker pull whyour/qinglong:latest
```

**仅需在原命令前缀加入加速镜像地址例如：**

```bash
docker pull dockerpull.com/whyour/qinglong:latest
```

# 自行配置服务器
# 注意

在服务器宝塔面板的 docker 中，使用命令也无法拉取，可以远程 ssh 服务器，并通过命令行进行 pull，然后回到宝塔面板中，即可看到刚下载的镜像，并用于容器更新