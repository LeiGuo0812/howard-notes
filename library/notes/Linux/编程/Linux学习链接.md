---
date created: 2022-11-03 09:56
---
#linux #编程
# 系统/软件安装

[Windows10 安装 Ubuntu 16.04LTS 双系统及fsl/freesurfer/matlab 软件安装全流程](https://www.cnblogs.com/howard-guo/p/11249289.html)

[Ubuntu16.04 使用优化记录](https://www.cnblogs.com/howard-guo/p/11256990.html)

[关于Ubantu18　点击ｓｅｔｔｉｎｇ死机解决方案 - 简书](https://www.jianshu.com/p/fee3dc7d0ba6)

[Windows 下安装 Ubuntu 双系统(更新) - duan22677 - 博客园](https://www.cnblogs.com/Duane/p/6776302.html)

[ubuntu 怎样修改grub.cfg_百度知道](https://zhidao.baidu.com/question/460580772094101805.html)

[FSL/FreeSurfer安装教程 - 简书](https://www.jianshu.com/p/4db8227cbb81)

[Linux系统更新最新版R语言方法](https://blog.csdn.net/m0_37601622/article/details/93135920)

[Linux（Ubuntu16.04）安装Nvidia显卡驱动循环登录问题 - kingthon的博客 - CSDN博客](https://blog.csdn.net/kingthon/article/details/81151843)

[安装Ubuntu 16.04时卡住的那些坑 - Dod_Jdi的博客 - CSDN博客](https://blog.csdn.net/Dod_Jdi/article/details/78635126)

[解决装了Windows/Ubuntu双系统后Windows时间混乱的问题 - 点点的博客 - CSDN博客](https://blog.csdn.net/weixin_38708130/article/details/83858837)

[Ubuntu16.04下AFNI快速安装 - x_zliang的专栏 - CSDN博客](https://blog.csdn.net/x_zliang/article/details/89704005)

<https://afni.nimh.nih.gov/pub/dist/doc/htmldoc/background_install/download_links.html#choosing-an-afni-that-s-right-for-you>

[Cygwin中如何像在Ubuntu中一样安装软件](https://blog.csdn.net/xun527/article/details/79778923)

[cygwin 安装 apt-cyg](https://www.cnblogs.com/asnjudy/p/4025887.html)

[Windows下安装Cygwin及apt-cyg](https://www.jianshu.com/p/fac45920628d)

[Ubuntu下创建新用户（服务器增加访问用户）](https://blog.csdn.net/taolusi/article/details/81304057)

使用`sudo adduser name`，设置好用户密码即可。远程访问密码即该密码

[在Ubuntu 18.04上安装和配置Xrdp服务器（远程桌面）的方法](https://www.ywnz.com/linuxyffq/5657.html)

# 系统操作

文件匹配：

- [命令行通配符教程](http://www.ruanyifeng.com/blog/2018/09/bash-wildcards.html)

- [linux文件名匹配——通配符](https://blog.csdn.net/MoFengLian/article/details/88670808)

[Linux下环境变量设置 - Joans - 博客园](https://www.cnblogs.com/Joans/p/7760378.html)

[Comprehensive Linux Cheatsheet](https://gto76.github.io/linux-cheatsheet/)

[Shell的格式化输出](https://blog.csdn.net/csdn_kerrsally/article/details/79901445)

[linux中字符串截取的八种方法](https://blog.csdn.net/qq_26442553/article/details/79916527)

[Bash test: what does “=~” do?](https://unix.stackexchange.com/questions/340440/bash-test-what-does-do)

正则匹配捕获引用

```bash
for i in `cat list.txt`
do
# 使用if 和 [[ ]] 的组合进行正则表达匹配判断，[[ ]]内放入正则表达式判断语句，内侧前后空格， =~ 用于正则表达式判断，左边是要匹配的字符，（若不用$ 引用，则应该用引号将字符串引起），右边是正则表达式，不用引号。
		if [[  $i =~ (._)_(._)_(.*) ]]; then
#如果正则表达式中使用了括号进行分组匹配，则可以用BASH_REMATCH[n]进行提取
mv $ i  ${BASH_REMATCH[1]}_${BASH_REMATCH[2]}_${BASHI_REMATCH[3]}
else
echo 'format of name not match'
fi
done
```

[Linux—shell中$(( ))、$( )、``与${ }的区别](https://blog.csdn.net/number_0_0/article/details/73291182)

[Shell 变量引用实例](https://www.cnblogs.com/daodaotest/p/12683675.html)

[linux shell 逻辑运算符、逻辑表达式详解](https://www.cnblogs.com/chengmo/archive/2010/10/01/1839942.html)

[SHELL逻辑运算总结, 包括[[]]与[]的区别，&&与-A的区别，||与-O的区别](https://www.cnblogs.com/tony1314/p/8315666.html)

[判断linux文件、文件夹是否存在](https://blog.csdn.net/felix_cb/article/details/90643073)

[Linux修改终端显示前缀及环境变量](https://www.cnblogs.com/charlesblc/p/5427350.html)

# 命令学习

[Linux查看文件夹中文件的个数/数目/数量/多少](https://blog.csdn.net/program_developer/article/details/88831692)

[qsub命令](https://www.cnblogs.com/overmore/archive/2012/05/29/2524824.html)

[linux ls 只显示文件或者文件夹](https://www.cnblogs.com/ryanzheng/p/12144262.html)

[在ls中排除某些文件](https://www.kutu66.com/ubuntu/article_165010)

## 输出文件的绝对路径

`readpath filename` 或

`readlink -f filename`

- 保存到文件

for i in `cat list.txt`
do
echo `realpath $i/filename` >> full_path.txt
done

使用场景：PANDA分步骤跑数据

# WSL

[WSL 使用指南](https://zhuanlan.zhihu.com/p/36482795)

[WSL 使用指南——01 WSL入门](https://zhuanlan.zhihu.com/p/34885179)

[win10 terminal配色可以好看到什么程度？](https://www.zhihu.com/question/330813656/answer/735410227)

[Windows Terminal美化界面](https://juejin.im/post/6844904116322304014)

[解决WSL下目录显示绿底的问题](https://szukevin.site/2019/10/17/%E8%A7%A3%E5%86%B3WSL%E4%B8%8B%E7%9B%AE%E5%BD%95%E6%98%BE%E7%A4%BA%E7%BB%BF%E5%BA%95%E7%9A%84%E9%97%AE%E9%A2%98/)

[mbadolato / iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes)

[Windows Terminal 终极指南](https://www.bilibili.com/read/cv5624035/)

[添加 windows terminal 到右键菜单](https://blog.csdn.net/Jioho_chen/article/details/101159291)

```powershell
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\Directory\Background\shell\wt]
@="Windows Terminal here"
"Icon"="%USERPROFILE%\AppData\Local\Terminal_ico\windowsTerminal.ico"

[HKEY_CLASSES_ROOT\Directory\Background\shell\wt\command]
@="C:\Users\GuoLei\AppData\Local\Microsoft\WindowsApps\wt.exe"

[HKEY_CLASSES_ROOT\Directory\Background\shell\wt]
"Extended"=""
```

建立 windows terminal 右键菜单并设置为隐藏（shift + 右键显示）

参考：

<https://www.cnblogs.com/FairlyHarmony/p/10441121.html>

<http://www.cfan.com.cn/2019/0126/131900.shtml>

## 在WSL下使用FSL和freesurfer

- 首先，先将FSL和freesurfer的安装包下载到想要的位置，解压（任意位置均可，不一定是C盘），过程可以完全参考如下教程，路径换成WSL下读取到的路径即可

此处为语雀内容卡片，点击链接查看：<https://www.yuque.com/howardgl/vht5ip/37205f47-175f-4d56-8c6f-1b6a2aa97aec>

- 根据教程安装完成、解决报错后，继续安装所需的库：

- freesurfer需要 `libgomp.so.1` 库，输入 `sudo apt install libgomp1` 安装即可

- fsl需要python2，可以输入 `sudo apt install python-minimal` 安装

- 这样基本的流程就可以用WSL跑了

- 如果出现 .bashrc 文件权限不够（可能在windows下编辑过）， `.bashrc: Permission denied` 的报错，修改 .bashrc文件的权限即可： `chmod 0644 /home/howard/.bashrc` 

- 所以不要在 windows 下编辑 Linux 系统中的文件！


FSL:

```bash
export FSLDIR=/opt/fsl
export PATH=$PATH:$FSLDIR/bin
source $FSLDIR/etc/fslconf/fsl.sh
```

Freesurfer：

```bash
export FREESURFER_HOME=/opt/freesurfer
source $FREESURFER_HOME/SetUpFreeSurfer.sh
```

## 在WSL下使用ANTS

- github下载linux的release <https://github.com/ANTsX/ANTs/releases>
- 添加路径：

```bash
export ANTSPATH=/mnt/g/MRItoolbox/ANTs.2.1.0.Debian-Ubuntu_X64
export PATH=$PATH:$ANTSPATH
```
