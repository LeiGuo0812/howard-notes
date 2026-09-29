#Conda

发布时间：2022-07-20 16:59:20 来源：亿速云 阅读：1758 作者：iii 栏目：[开发技术](https://www.yisu.com/zixun/kf/)

这篇文章主要讲解了“conda虚拟环境默认路径如何修改”，文中的讲解内容简单清晰，易于学习与理解，下面请大家跟着小编的思路慢慢深入，一起来研究和学习“conda虚拟环境默认路径如何修改”吧！

<a name="b7a07579"></a>
### 改变conda虚拟环境的默认路径

conda环境默认安装在用户目录C:\Users\username.conda\envs下，如果选择默认路径，那么之后创建虚拟环境，也是安装在用户目录下。不想占用C盘空间，可以修改conda虚拟环境路径。

(1)首先，找到用户目录下的.condarc 文件（C:\Users\username）。**注意，如果使用的是 mamba，且目录下没有.mambarc，则会自动使用.condarc 的设置，因此设置.condarc 也能生效，自己创建.mambarc 会报错**

![](https://cache.yisu.com/upload/admin/Ueditor/2022-07-20/62d7c3c868327.png#alt=)

(2)打开.condarc文件之后，添加或修改.condarc 中的 env_dirs 设置环境路径，按顺序第⼀个路径作为默认存储路径，搜索环境按先后顺序在各⽬录中查找。直接在.condarc添加：

```
envs\_dirs:
  - D:\\Anaconda3\\envs
```

然后，在Anaconda Prompt执行**conda info**命令，就可以看到修改默认环境路径成功

![](https://cache.yisu.com/upload/admin/Ueditor/2022-07-20/62d7c3d4858fb.png#alt=)

当新创建虚拟环境验证时，可能会发现它还是默认安装在C盘用户目录下的envs

（3）或者在Anaconda Promp执行命令：

**conda config --add envs_dirs newdir # 增加环境路径 newdir**

![](https://cache.yisu.com/upload/information/20220720/112/57238.png#alt=)

通过执行命令conda env list查看有哪些虚拟路径以及它们的存储路径，* 号表示当前所处的环境。

```
(pytor) C:\\Users\\username>conda env list
#conda environments:
#
pytor                 \*  D:\\Anaconda3\\envs\\pytor
base                     d:\\Anaconda3
pytor                    d:\\Anaconda3\\envs\\pytor
                         d:\\anaconda3
```

（4）如果还是没有修改成功，则需要**更改D:\Anaconda3的权限**：选中Anaconda3文件夹，然后右击选则属性，找到安全，Users权限全部允许。接下来确定后，时间稍微有点长，等待完成即可。

![](https://cache.yisu.com/upload/admin/Ueditor/2022-07-20/62d7c3bca51ef.png#alt=)

这时新创建一个虚拟环境验证时，发现在D:\Anaconda3\envs下。

[linux 修改conda默认环境位置 - 知乎](https://zhuanlan.zhihu.com/p/617285330)
### 附：conda新建虚拟环境

1）指定位置新建虚拟环境

```
conda create
```

注意：路径/home/conda_env是自己先建立好的，也就是必须存在这个路径，后面的mmcv就是你想给这个环境取的一个名称

2）激活这个环境

```
source activate /home/conda\_env/mmcv
```

注意：Linux下是source，Windows下是conda

3）可以在这个虚拟环境下，正常安装包，笔者没有发现错误，例如

```
pip install numpy
conda install numpy
```

4）退出该虚拟环境

```
deactivate
```

5）删除该虚拟环境

```
conda remove
```

感谢各位的阅读，以上就是“conda虚拟环境默认路径如何修改”的内容了，经过本文的学习后，相信大家对conda虚拟环境默认路径如何修改这一问题有了更深刻的体会，具体使用情况还需要大家实践验证。这里是亿速云，小编将为大家推送更多相关知识点的文章，欢迎关注！

推荐阅读：[怎么修改Jenkins的默认工作路径](https://www.yisu.com/zixun/7754.html)
