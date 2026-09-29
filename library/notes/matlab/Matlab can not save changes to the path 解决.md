---
date created: Wednesday, July 10th 2024, 1:04:21 am
date modified: Wednesday, July 10th 2024, 1:21:38 am
---
[Setpath error: the path file pathdef.m might be read only - MATLAB Answers - MATLAB Central](https://www.mathworks.com/matlabcentral/answers/454488-setpath-error-the-path-file-pathdef-m-might-be-read-only)

这一问题是由于 pathdef.m 文件的读写修改权限不够所导致的，另外，如果管理员身份也没有该文件的修改权限，那么用管理员权限打开 matlab 也是没有用的

# 解决方法

- 使用 everything 等工具找到 pathdef.m  文件，如果有多个，那么就多个都处理
- 打开 pathdef.m 文件的属性，切换到安全选项卡，选择编辑 
- 点击 Users 组，将所有权限设置为允许（允许完全控制）
- 确定保存，如果有多个 pathdef.m 则全部操作
- 重新启动 matlab，即可保存 savepath 设置

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202407100119490.png)
