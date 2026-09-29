---
date created: Sunday, December 8th 2024, 10:53:28 am
date modified: Sunday, December 8th 2024, 11:04:01 am
---
一些 mlr3 的学习器需要加载 RWeka 包，该包依赖 Java，因此需要现在电脑上正确安装 Java （JDK 和 JRE）才能使用

安装和配置：
[Java基础1-环境篇：JDK安装与环境变量配置-CSDN博客](https://blog.csdn.net/godot06/article/details/104378253)

安装：
[Java Downloads | Oracle](https://www.oracle.com/java/technologies/downloads/)

旧版本的 java 在安装时应选中同时安装 JRE，新版本默认没有 JRE

[安装完JDK后没有JRE文件怎么办\_jdk20没有jre-CSDN博客](https://blog.csdn.net/Leol_emon/article/details/122278256)

- 注意：应用管理员模式打开 cmd
- 切换到 jdk 目录下
-  运行 `bin\jlink.exe --module-path jmods --add-modules java.desktop --output jre`

即可生成 jre 文件夹

配置环境变量：
- 系统环境变量中配置 JAVA_HOME
- 系统环境变量 PATH 中，添加 %JAVA_HOME%\bin 和 %JAVA_HOME%\jre\bin

完成上述配置后，即可正确加载 RWeka 包