#Cpp

[vscode配置c语言环境 c/c++ - 知乎](https://zhuanlan.zhihu.com/p/380578316)

# vscode

安装 C/C++ Extension Pack 扩展


# 安装 MinGw （windows 下的 gcc）

官方压缩资源列表

[MinGW-w64 - for 32 and 64 bit Windows - Browse Files at SourceForge.net](https://sourceforge.net/projects/mingw-w64/files/)

[Windows下MinGW-w64的安装 - 知乎](https://zhuanlan.zhihu.com/p/355510947)

[Mingw快捷安装教程 并完美解决出现的下载错误：The file has been downloaded incorrectly\_百色彭于晏的博客-CSDN博客](https://blog.csdn.net/yvge669/article/details/124564622)

- 下载压缩包

![image.png|475](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304121530046.png)

- 将解压后路径的 bin 目录添加到环境变量

![image.png|475](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304121530249.png)

![image.png|475](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304121530168.png)

- 添加环境变量后重启生效

- 打开 cmd，运行 `gcc -v` 查看是否生效