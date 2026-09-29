---
date created: Sunday, October 29th 2023, 11:33:11 am
date modified: Sunday, October 29th 2023, 9:50:01 pm
---
#windows #Powershell #编程

CMD 是 Windows 操作系统中的命令行解释器，它允许用户在图形界面之外执行命令和脚本。CMD 继承了 DOS 的命令行传统，提供了许多类似于 DOS 的命令和语法。它是 Windows 中的标准命令行工具，仍然被广泛使用。

# cmd 基本命令

使用 `help` 命令查看 CMD 的基本命令


```batch
ASSOC          显示或修改文件扩展名关联。
ATTRIB         显示或更改文件属性。
BREAK          设置或清除扩展式 CTRL+C 检查。
BCDEDIT        设置启动数据库中的属性以控制启动加载。
CACLS          显示或修改文件的访问控制列表(ACL)。
CALL           从另一个批处理程序调用这一个。
CD             显示当前目录的名称或将其更改。
CHCP           显示或设置活动代码页数。
CHDIR          显示当前目录的名称或将其更改。
CHKDSK         检查磁盘并显示状态报告。
CHKNTFS        显示或修改启动时间磁盘检查。
CLS            清除屏幕。
CMD            打开另一个 Windows 命令解释程序窗口。
COLOR          设置默认控制台前景和背景颜色。
COMP           比较两个或两套文件的内容。
COMPACT        显示或更改 NTFS 分区上文件的压缩。
CONVERT        将 FAT 卷转换成 NTFS。你不能转换
               当前驱动器。
COPY           将至少一个文件复制到另一个位置。
DATE           显示或设置日期。
DEL            删除至少一个文件。
DIR            显示一个目录中的文件和子目录。
DISKPART       显示或配置磁盘分区属性。
DOSKEY         编辑命令行、撤回 Windows 命令并
               创建宏。
DRIVERQUERY    显示当前设备驱动程序状态和属性。
ECHO           显示消息，或将命令回显打开或关闭。
ENDLOCAL       结束批文件中环境更改的本地化。
ERASE          删除一个或多个文件。
EXIT           退出 CMD.EXE 程序(命令解释程序)。
FC             比较两个文件或两个文件集并显示
               它们之间的不同。
FIND           在一个或多个文件中搜索一个文本字符串。
FINDSTR        在多个文件中搜索字符串。
FOR            为一组文件中的每个文件运行一个指定的命令。
FORMAT         格式化磁盘，以便用于 Windows。
FSUTIL         显示或配置文件系统属性。
FTYPE          显示或修改在文件扩展名关联中使用的文件
               类型。
GOTO           将 Windows 命令解释程序定向到批处理程序
               中某个带标签的行。
GPRESULT       显示计算机或用户的组策略信息。
GRAFTABL       使 Windows 在图形模式下显示扩展
               字符集。
HELP           提供 Windows 命令的帮助信息。
ICACLS         显示、修改、备份或还原文件和
               目录的 ACL。
IF             在批处理程序中执行有条件的处理操作。
LABEL          创建、更改或删除磁盘的卷标。
MD             创建一个目录。
MKDIR          创建一个目录。
MKLINK         创建符号链接和硬链接
MODE           配置系统设备。
MORE           逐屏显示输出。
MOVE           将一个或多个文件从一个目录移动到另一个
               目录。
OPENFILES      显示远程用户为了文件共享而打开的文件。
PATH           为可执行文件显示或设置搜索路径。
PAUSE          暂停批处理文件的处理并显示消息。
POPD           还原通过 PUSHD 保存的当前目录的上一个
               值。
PRINT          打印一个文本文件。
PROMPT         更改 Windows 命令提示。
PUSHD          保存当前目录，然后对其进行更改。
RD             删除目录。
RECOVER        从损坏的或有缺陷的磁盘中恢复可读信息。
REM            记录批处理文件或 CONFIG.SYS 中的注释(批注)。
REN            重命名文件。
RENAME         重命名文件。
REPLACE        替换文件。
RMDIR          删除目录。
ROBOCOPY       复制文件和目录树的高级实用工具
SET            显示、设置或删除 Windows 环境变量。
SETLOCAL       开始本地化批处理文件中的环境更改。
SC             显示或配置服务(后台进程)。
SCHTASKS       安排在一台计算机上运行命令和程序。
SHIFT          调整批处理文件中可替换参数的位置。
SHUTDOWN       允许通过本地或远程方式正确关闭计算机。
SORT           对输入排序。
START          启动单独的窗口以运行指定的程序或命令。
SUBST          将路径与驱动器号关联。
SYSTEMINFO     显示计算机的特定属性和配置。
TASKLIST       显示包括服务在内的所有当前运行的任务。
TASKKILL       中止或停止正在运行的进程或应用程序。
TIME           显示或设置系统时间。
TITLE          设置 CMD.EXE 会话的窗口标题。
TREE           以图形方式显示驱动程序或路径的目录
               结构。
TYPE           显示文本文件的内容。
VER            显示 Windows 的版本。
VERIFY         告诉 Windows 是否进行验证，以确保文件
               正确写入磁盘。
VOL            显示磁盘卷标和序列号。
XCOPY          复制文件和目录树。
WMIC           在交互式命令 shell 中显示 WMI 信息

```

# 获取帮助

命令后跟 `/?` 获取帮助文档

# 一些基本知识

## 创建变量
使用 `set` 语句创建变量：

`set variable=value`

如果需要创建数值型变量，需要添加 `/a` 参数，以声明后面的赋值是算数运算

`set /a variable=1`

`set /a variable+=1`

## 变量的引用

在创建变量后，如果需要引用变量，则需要在变量的两侧添加 `%`，以声明引用了一个普通变量

```batch
set varible=test
echo %variable%
```

在循环中，循环变量的引用有所不同，只需要在循环变量的左侧添加 `%` 即可，但是注意：

>[!warning]
>如果使用.bat 脚本，循环变量前需要两个%，如果在 CMD 控制台直接运行，则一个%即可

在使用了延迟扩展的脚本中，如果需要在循环中实时更新外部变量，则需要用两个 `!` 将变量围起来
## 取消回显

CMD 在输出结果时默认将输出该结果的命令一同打印到屏幕，如果希望只看到输出本身而不是命令，则需要在命令前加上 `@` ，以取消回显

`for %i in (*) do @echo %i`

`for %i in (*) do @if not "%~ai"=="d" @echo %i`

对于 if 语句来说，如果某条件不满足，依然会在屏幕上弹出警告，会导致困惑，因此可以在 if 前添加 `@` 以避免冗余信息

## 在一行中运行多个命令

在一行中运行多个命令时，可以用 `&&` 连接

## .bat 文件执行后不立即关闭窗口

可以在文件的最后添加 `pause` 关键字，这样程序在执行完后不会立即关闭窗口。

## 字符串截取

在 CMD 中，可以对字符串进行截取和替换：

**替换**

```batch
@echo off
setlocal enabledelayedexpansion

for %%i in (example_old.txt example_old2.txt) do (
    set "filename=%%i"
    set "newfilename=!filename:old=new!"
    echo !newfilename!
)

endlocal

```

set 后面使用" "将表达式括起来，可以防止 CMD 将特殊字符或空格解释为其他符号

替换时，使用 `%variable:str_old=str_new%` 或 `!variable:str_old=str_new! ` ，等号右边什么都不加时，可以将字符串删除

**截取**

```batch
@echo off

setlocal enabledelayedexpansion

for %%i in (example.txt example2.txt) do (
    set "filename=%%i"
    set "substring=!filename:~0,3!"
    echo !substring!
)

endlocal

```

对 `%variable:~start,length%` 从特定位置截取特定长度的字符，注意，CMD 从 0 开始。

如果想截取最后 3 位，则可以使用 `%variable:~-3`

### 循环中的字符串截取

在循环中，不能对循环变量直接进行截取操作，需要**先开启延迟扩展，将当前循环变量赋值给一个临时变量，然后对临时变量进行截取**，最好写成.bat 文件之后操作

```batch
@echo off
setlocal enabledelayedexpansion

for %%i in (example.txt example2.txt) do (
    set "filename=%%i"
    echo !filename:~0,3!
)

endlocal
```

## 延迟扩展和立即扩展

通常，在批处理脚本中，使用 `%` 符号来表示常规变量，例如 `%variable%`。这种方式在脚本开始执行时就被解释和替换，因此如果在循环或条件语句中改变了变量的值，这些变化在同一个代码块内是**不会被立即生效的**。

延迟扩展引入了 `!` 符号来表示变量。启用延迟扩展后，在脚本执行过程中，使用 `!variable!` 的形式来表示变量。这样，**变量的值在每次执行时都会被重新解释和替换**，从而可以实现在循环或条件语句中动态改变变量的值。

- %variable%：立即扩展，在执行脚本时，在循环或条件语句代码块中修改了变量的值不会立即生效，需要等代码块执行完成后才修改
- !variable!：延迟扩展，执行脚本时，变量的值在每次执行时都会被重新解释替换，动态改变

要开启延迟扩展功能，可在需要使用该功能的代码块之间前添加：
```batch
setlocal enabledelayedexpansion

::codes

endlocal
```


对比立即扩展和延迟扩展：

```batch
@echo off
setlocal enabledelayedexpansion

set count=0

for /l %%i in (1,1,5) do (
    set /a count+=1
    echo Count inside loop: %count% (Immediate Expansion)
)

echo Count outside loop: %count%

set count=0

for /l %%i in (1,1,5) do (
    set /a count+=1
    echo Count inside loop: !count! (Delayed Expansion)
)

echo Count outside loop: !count!

endlocal

pause

```

## 字符串格式化输出

CMD 命令中，字符串格式化输出功能十分有限，但可以通过一些方法得到同样的效果，例如将 1，2，3 格式化输出为 01，02，03：

```batch
@echo off
setlocal enabledelayedexpansion

set "numbers=1 2 3"
for %%i in (%numbers%) do (
    set "formattedNumber=00%%i"
    echo !formattedNumber:~-2!
)

endlocal

```

# 打开路径的资源管理器

在 CMD 窗口中，你可以使用 `start` 命令来打开资源管理器并指定特定的路径。以下是几种常见的用法：

### 打开当前路径的资源管理器：

batchCopy code

`start .`

这个命令中的`.`表示当前路径，`start .` 将会打开当前路径的资源管理器窗口。

### 打开特定路径的资源管理器：

batchCopy code

`start "窗口标题" "C:\路径"`

在这个命令中，`窗口标题`是你希望资源管理器窗口显示的标题，`C:\路径`是你想要打开的特定路径。请将`窗口标题`和`C:\路径`替换为你希望使用的窗口标题和路径。

例如，要打开`D:\Documents`路径的资源管理器，可以使用以下命令：

batchCopy code

`start "我的文档" "D:\Documents"`

这个命令将会打开一个标题为“我的文档”的资源管理器窗口，并显示`D:\Documents`路径的内容。


# 常用命令

**列出当前文件夹下的所有文件：**

`for %i in (*) do @echo %i`

**列出所有文件名的名称（不带后缀）**

`for %i in (*) do @echo %~ni`

`~n` 参数限定了获取变量的基本名

**列出所有文件名的后缀**

`for %i in (*) do @echo %~xi`

`~x` 参数限定了获取变量的后缀

**列出当前文件夹下所有文件夹：**

`for /d %i (*) do @echo %i`

`/d` 参数限定了循环变量的内容是文件夹

