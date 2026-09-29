#linux #软件
## 1. [ANTs](https://link.zhihu.com/?target=http%3A//stnava.github.io/ANTs/)介绍

[ANTs](https://link.zhihu.com/?target=http%3A//stnava.github.io/ANTs/)(Advanced Normalization Tools)是目前配准质量最好的软件 ，是基于c语言写的，运行速度很快。目前医学图像预处理都可以用ANTs

<a name="a7f6b9ed"></a>
## 2. [ANTs](https://link.zhihu.com/?target=http%3A//stnava.github.io/ANTs/)安装

官网上有安装方法介绍：[ANTs源码安装](https://link.zhihu.com/?target=https%3A//github.com/ANTsX/ANTs/wiki)；此安装方法适用于 linux和Mac；具体过程如下：

**2.1 安装**[**ANTs N4BiasFieldCorrection**](https://link.zhihu.com/?target=https%3A//github.com/stnava/ANTs/releases)**(下载到路径＂/home/自己的用户名/ ＂ 目录下)，然后将ANTs库的位置放到环境变量的路径下．**

**2.2 安装cmake**

```latex
wget https://cmake.org/files/v3.12/cmake-3.12.1-Linux-x86_64.sh
```

下载完安装包之后，在安装包的路径下调出终端，输入

```latex
sh cmake-3.12.1-Linux-x86_64.sh
```

解压完成之后还需要输入：

```latex
sudo apt-get install cmake-curses-gui
```

安装完成, 可以使用命令ccmake．

**2.3 运行CMake来配置构建**

a.新建一个文件夹ANTs,用来存放编译之后的文件（xxx 是自己的用户名）

```latex
mkdir -p /home/xxx/ANTs
cd /home/xxx/ANTs
ccmake /home/xxx/ANTs-2.3.1(这是之前下载好的安装包)
```

在跳出来的编译界面，按c，Cmake会做一些检查和给出选择界面（**一定要改的选项！！看官网和别人教程中都没有提到的大坑，先说结论**）

- `SuperBuild_ANTS_USE_GIT_PROTOCOL` 改成 "OFF". (把防火墙关掉，否则后续编译自动适配下载ITK会超时)
- RUN_LONG_TESTS 和 RUN_SHORT_TESTS 改成 "OFF". （否则后续编译会报 recipe for target 错误）

再次按c，做另一轮的configuration．如果没有报错的话，就可以按g来生成生成make files．

如果编译ANTs遇到make error，“ recipe for recipe for target target“具体如下，可以尝试改以上参数设置。

```latex
Examples/TestSuite/CMakeFiles/ANTSFetchData.dir/build.make:536: recipe for target 'ExternalData/TestData/antsApplyTransformsTesting_InputWarpTransform.nii.gz.md5-stamp' failed
make[5]: *** [ExternalData/TestData/antsApplyTransformsTesting_InputWarpTransform.nii.gz.md5-stamp] Error 1
CMakeFiles/Makefile2:8743: recipe for target 'Examples/TestSuite/CMakeFiles/ANTSFetchData.dir/all' failed
make[4]: *** [Examples/TestSuite/CMakeFiles/ANTSFetchData.dir/all] Error 2
make[4]: *** 正在等待未完成的任务....
[ 17%] Linking CXX static library /home/zndx/ANTs/lib/libl_N3BiasFieldCorrection.a
[ 17%] Built target l_N3BiasFieldCorrection
Makefile:162: recipe for target 'all' failed
make[3]: *** [all] Error 2
CMakeFiles/ANTS.dir/build.make:113: recipe for target 'ANTS-prefix/src/ANTS-stamp/ANTS-build' failed
make[2]: *** [ANTS-prefix/src/ANTS-stamp/ANTS-build] Error 2
CMakeFiles/Makefile2:67: recipe for target 'CMakeFiles/ANTS.dir/all' failed
make[1]: *** [CMakeFiles/ANTS.dir/all] Error 2
Makefile:116: recipe for target 'all' failed
make: *** [all] Error 2
```

**2.4 编译**

```latex
make -j 2 2>&1 | tee build.log
```

**2.5检查编译是否成功**

如果一切顺利，`make`打印后将退出并显示代码0

编译完成之后，如果要使用ANTs scripts的话，需要将source文件下Scripts/　里面的所有内容拷贝到生成的ANT/bin/　目录下．

**2.6 安装后：设置环境变量**`**PATH**`**和**`**ANTSPATH**`

如果是按照本文建立的话，二进制文件路径应该是/home/xxx/ANTs/bin

这个文件夹是包含了编译好的程序以及刚刚从源文件夹复制过来的Scripts

对于Linux添加路径:

cd 到　/home/xxx/ANTs/bin　目录下

终端输入:

```latex
sudo gedit ~/.bash_profile
```

在跳出来的编辑器里面输入:

```latex
export ANTSPATH=${HOME}/ANTs/bin/
export PATH=${ANTSPATH}:$PATH
```

保存之后退出，然后终端输入:

这样环境路径就设置好了．检查一下是否正确，终端输入:

应该输出整个路径:

```latex
/home/zndx/ANTs/bin/antsRegistration
```

这是我自己的存放路径．还可以在终端输入:

终端会输出这个script的使用介绍．如果一切没有问题，那么ANTs安装OK了．花了我小一周时间，写下这篇文章给大家避避坑，欢迎做医学图像分割的朋友一起交流～～
