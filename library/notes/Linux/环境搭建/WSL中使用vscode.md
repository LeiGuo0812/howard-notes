WSL 2 推荐用法不是在 Linux 里装一个独立的 VS Code GUI，而是：

> **Windows 版 VS Code 作为界面，WSL 里运行 VS Code Server、Python、conda、扩展和终端。**

官方文档也是这么建议的：Windows 侧安装 VS Code，安装 WSL 扩展，然后在 WSL 里用 `code .` 打开项目；之后 VS Code 左下角应显示 `WSL: Ubuntu` 之类的标识，所有命令和扩展会在 WSL 环境里执行。

### 1. 先确认 VS Code 是否真的进入了 WSL 模式

在 WSL 2 终端里进入你的项目目录：

```
cd ~/your_projectcode .
```

打开后看 VS Code 左下角，应该显示类似：

```
WSL: Ubuntu
```

如果没有，说明你只是打开了普通 Windows 本地窗口。此时在 VS Code 里按：

```
Ctrl + Shift + P
```

然后执行：

```
WSL: Reopen Folder in WSL
```

或者：

```
WSL: Connect to WSL
```

如果没有这些命令，先在 Windows 版 VS Code 里安装扩展：

```
WSL
```

扩展名通常是 **WSL / Remote - WSL**。