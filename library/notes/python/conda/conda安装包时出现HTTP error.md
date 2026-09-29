#Conda

> 本文由 [简悦 SimpRead](http://ksria.com/simpread/) 转码， 原文地址 [zhuanlan.zhihu.com](https://zhuanlan.zhihu.com/p/368458730)

如图所示

![](https://pic1.zhimg.com/v2-cff7779da0336b8fe5f1e9a0f34061f8_r.jpg)

解决方式：

1. 网上教程多为在命令行中输入如下指令，再进行第二步（使用虚拟环境需要首先进入虚拟环境）。

**但大概率解决不了问题，若未解决则将所有 https 改为 http，再进行第二步则问题解决。**

```
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/msys2/
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free/
conda config --set show_channel_urls yes
```

2. 在 C:/user/xx/（xx 为用户名）目录下，找到 .condarc 文件，用记事本打开，删掉 channels 下面的 -defaults 一行。

![](https://pic4.zhimg.com/v2-ed73a6291cb787606717cc9223a860d3_r.jpg)

1. 若问题还未解决，将 1 中的所有 https 改为 http，问题解决。



另一种方式为：
[Conda SSL Error: OpenSSL appears to be unavailable on this machine. OpenSSL is required to download and install packages. · Issue #11982 · conda/conda · GitHub](https://github.com/conda/conda/issues/11982)

```ad-note
This is due to .dll error

go to location where you've install anaconda anaconda3>Library>bin. search and copy following dll files

libcrypto-1_1-x64.dll  
libssl-1_1-x64.dll

and paste to anaconda3>DLLs.

then restart your pc.

issue will get resolved.
```
