---
date created: Tuesday, April 30th 2024, 10:59:29 am
date modified: Tuesday, April 30th 2024, 11:00:05 am
---
[Window10取消文件默认打开方式 - 知乎](https://zhuanlan.zhihu.com/p/105626740)

1.首先win+R在运行窗口输入regedit调出注册表窗口

2.左边找到HKEY_CLASSES_ROOT，在展开的列表中找到你要取消的文件后缀右击选择删除

3.退回到最初的列表，依次展开HKEY_CURRENT_USER→Software→Microsoft →windows→CurrentVersion→Explorer→FileExts继续展开，找到你要取消的文件后缀名右击删除

4.右击任务栏选择任务管理器，在任务管理器中找到：应用→windows资源管理器→右键重新启动