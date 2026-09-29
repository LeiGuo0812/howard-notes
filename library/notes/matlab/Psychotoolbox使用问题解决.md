---
date created: Sunday, April 23rd 2023, 2:11:07 pm
date modified: Thursday, August 10th 2023, 9:40:40 am
---
#Matlab #Psychotoolbox

运行 psychotoolbox 程序出现以下错误：

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304231412457.png)

这是因为 psychotoolbox 没有 C++编译器正确编译 Screen.mexw64

要解决该问题需要：

1. 安装 C/C++编译器
2. 同时要安装 Gstreamer
3. 以管理员身份运行 matlab

# 安装 C/C++编译器

- 首先安装 MinGW [[windows C++环境配置]], 并添加环境变量
- matlab 要检测到安装过的 MinGW，还需要额外添加环境变量：[I already have MinGW on my computer. How do I configure it to work with MATLAB?](https://ww2.mathworks.cn/matlabcentral/answers/313298-i-already-have-mingw-on-my-computer-how-do-i-configure-it-to-work-with-matlab#:~:text=Accepted%20Answer%201%201%29%20Download%20the%20attached%20MATLAB,3%203%29%20In%20the%20MATLAB%20Command%20Window%20run%3A)


## For MATLAB R2017b and later:

下载 configuremingw.p [点击下载 configuremingw.p](https://ww2.mathworks.cn/matlabcentral/answers/uploaded_files/1119630/configuremingw.p)
运行
```matlab
configuremingw(MINGWROOT)
```

MINGWROOT 为 MinGw 的路径，例如 `D:/Softwares/x86_64-8.1.0-release-win32-seh-rt_v6-rev0/mingw64`

## For MATLAB R2015b through R2017a:

运行
```matlab
setenv('MW_MINGW64_LOC',folder)
```

folder 为 MinGw 的路径

## 验证

```matlab
mex -setup -v
```

选择合适的编译器


# 安装 Gstreamer

[Download GStreamer](https://gstreamer.freedesktop.org/download/#windows)

安装 MSVC runtime installer

正常安装即可

**安装后重启电脑**

# 以管理员身份运行 matlab

如果没有以管理员身份运行 matlab，但运行了 `SetupPsychtoolbox.m`,则 matlab 无法找到 Gstreamer 的安装路径：
![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304231430420.png)

关闭 matlab，以管理员身份重新打开 matlab，运行 `SetupPsychtoolbox.m`（如果之前已经运行过，可以不再运行），出现：

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304231433848.png)

即说明成功，Psychotoolbox 可成功运行。