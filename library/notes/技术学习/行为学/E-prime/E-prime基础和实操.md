#Eprime #行为学 #软件

[https://www.bilibili.com/video/BV14f4y127XC?p=1](https://www.bilibili.com/video/BV14f4y127XC?p=1)

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629438065757-4df6c080-137c-471c-834c-3f3800f2e3d6.png)

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629438122996-b2ead1e7-1131-4ad6-92a2-41eee79e34ad.png)

1.  E-Objects: 实验控件
2.  环境浏览器

1.  结构视图、浏览视图等

3.  对象属性
4.  输出
5.  界面视图
6.  代码建议

# 1. E-Object

控件

## 1.1 Experiment Object：

整个实验最高阶位置，掌管实验运行必不可少的变量，对象和设备等。在structure界面双击可打开属性对话框

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629446104076-33fe152d-4c6d-4e1e-80fe-3b0411f1df33.png)

## 1.2 SessionProc

实质上是Procedure实验过程控件，上面可以拖放其他E-Object控件，用来控制实验过程。

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629446250551-9e576453-8559-4739-a064-2970a32a99cd.png)

  

## 1.3 TextDisplay

是E-studio中的图片控件，用来呈现图片实验材料。将TextDisplay拖放到SessionProc中，双击即可打开属性对话框。

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629446350241-deb18203-79e1-483c-9cab-a857f2e6ed46.png)![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629446469300-4962502b-2919-4450-9e26-737ebb8f619a.png)![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629446800881-86cfc004-d81f-4f0c-89c1-69efdd794c79.png)

  

## 1.4 ImageDisplay

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629446921834-1a50b4c0-23dd-4925-87ec-b94f8925cf02.png)

  

## 1.5 SoundOut

语音播放实验材料

## 1.6 SoundIn

声音记录插件

## 1.7 MovieDisplay

播放视频材料

## 1.8 Slide

富刺激控件，可呈现“文本，图片，语言，视频”中的单独一类，或不同类别的材料

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629447143607-6b1d36f6-8c74-435d-b116-aedc3f557ccc.png)

  

## 1.9 Wait

等待控件，有两个作用

1.  将前一个控件的呈现过程延长
2.  用作探测界面以及收集前一控件的反应信息

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629447343673-629fac42-1e05-4672-89f2-dc5098f61792.png)

  

## 1.10 Label

E-studio中的间隔控件，用来引导程序运行逻辑和过程，作为程序跳转的依据

## 1.11 Inline

编程控件，用来控制复杂一些的实验设计

## 1.12 PackageCall

调用第三方软件包的命令

## 1.13 FeedbackDisplay

反馈控件，主要用来强化实验练习效果

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629447987610-47a486cb-6996-444d-9fd5-4afdcf2e975f.png)

## 1.14 List

过程控件, 有三个作用：

1.  存放实验材料
2.  指定实验过程
3.  设置实验显示效果

## 1.15 E-Run

脚本运行器，在E-stuido完成实验设计后，点击“Run”，或编译命令“Generate”后会生成一个类vb的脚本文件（Script），这个脚本文件可以脱离E-studio，在E-Run中单独运行

## 1.16 E-DataAid

数据打开工具，E-prime程序运行完以后，会在本地生成一个扩展名为*edatx的数据文件，E-DataAid除了可以打开行为数据，还支持对行为数据的简单编辑，筛选，分析和导出功能。

## 1.17 E-Basic语言

标准语言程序，实现控件拖拽不能满足的实验要求，需要使用Inline语句实现

## 1.18 E-merge

用于合并E-DataAid数据，可以将多个被试的行为数据合并为一个文件，方便进行数据整理和统计分析

## 1.19 E-Recovery

是E-prime中的数据恢复工具，程序出错时，可能只生成了*txt文件而没有*edatx文件，此时可以用E-Recovery程序恢复为*edatx文件

## 1.20 Factor Table Wizard

更灵活的生成list

# 2. E-prime实验中的六要素

  

## 2.1 时间（Duration）

-   固定时间
-   随机时间 `Object.duration = random(2000, 6000)`
-   无限时间

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629449196873-5f08b69d-b807-45fc-a423-c7f45ef9b0f6.png)

## 2.2 方式（Mode）

-   自动消失
-   按键消失
-   反应消失
-   自动+反应消失

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629449465002-4c3a38b7-0e47-4f2a-bf95-10b9e80d9d74.png)

## 2.3 格式（Format）

-   物理属性
-   位置
-   边框

## 2.4 反应（Response）

-   键盘按键
-   语音反应
-   反应盒
-   脚踏

## 2.5 记录（DataLogging）

-   RT
-   ACC
-   RESP

  

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629449676004-38a8f350-fa56-4ea3-91b4-aab34ab7f648.png)

  

## 2.6 材料（Material）

-   固定内容
-   变化内容

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629450361712-138cba95-77f0-48f5-bc28-cc3422f5ffd5.png)

  

# 3. E-prime的实验模式

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629450390143-1223480f-ed80-4b3f-b1fd-e5bfb578d243.png)![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629450397244-4bcb9f7d-a2fb-4608-8ef6-a4d9442b71c8.png)

# 4. E-prime的强制结束快捷键

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629450403508-03c9990e-7657-41b3-93c4-9bd343484232.png)


# 操作

[轻松学习E-Prime.pdf](https://www.yuque.com/attachments/yuque/0/2021/pdf/1210419/1629528797492-ac8dec1b-a854-43e9-bd7b-9987e7972fdb.pdf)

  

E-Basic 官方帮助文档

[📎E-Basic.chm](https://www.yuque.com/attachments/yuque/0/2021/chm/1210419/1629530267296-ca18b8cb-e8c8-422b-8a73-fb938d8ebcd7.chm)

  

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629530444721-964e954b-3fb6-4abc-b9da-7cfb91570361.png)

# 1. 实验开始收集的信息：

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629528936444-17272834-93f5-4004-8296-8df6f72fc09f.png)

  

# 2. List的设置

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629561304632-54f3e8bf-6443-49ea-a505-eb7ba3ad40b2.png)

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629561365970-2df5d79c-426e-4c5b-93e9-fae969b1d378.png)![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629561484845-90b699ad-c003-4603-b514-b5f79db197b4.png)

  

# 3. 脑电打Mark方法

## 3.1 并口

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723490218-295e2a7d-e512-4355-81a1-e2c984a24351.png)

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723554770-251692c0-1e9e-448b-8356-f89cf586d23f.png)

## 3.2 串口

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723634351-82beeddc-58d6-41a1-a3d9-871064bdf31f.png)

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1629723731963-9e24186c-4617-4f42-9fcf-c2c074cf228a.png)

  

# E-prime 同一个刺激收集多个响应

[https://support.pstnet.com/hc/en-us/articles/115001908708-Multiple-Response-Collection-30022-](https://support.pstnet.com/hc/en-us/articles/115001908708-Multiple-Response-Collection-30022-)