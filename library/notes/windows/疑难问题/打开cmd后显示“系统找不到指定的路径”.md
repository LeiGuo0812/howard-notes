---
date created: Sunday, September 24th 2023, 11:01:10 am
date modified: Sunday, September 24th 2023, 11:05:57 am
---
#windows

[WIN10 运行cmd显示“系统无法找到指定的路径”\_cmd gclient 系统找不到指定的路径。\_weixin\_43096051的博客-CSDN博客](https://blog.csdn.net/weixin_43096051/article/details/89950392)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309241103494.png)

打开注册表编辑器

找到 `计算机\HKEY_CURRENT_USER\Software\Microsoft\Command Processor`

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202309241103424.png)

查看是否有 AutoRun，如果其中内容无用，可以删除