#linux #编程

一、 通配符

通配符是一种特殊语句，主要有星号(*)、问号(?)等表示，用来模糊搜索文件，当查找目录或文件时，可以使用通配符来代替一个或多个真正字符。

作用范围：目录和文件名

常见通配符：常用通配符包括 "*"、"?" 、"[ ]"、 "[^ ]" 、"[! ]"和"{}"，具体含义见下表

表1-1 通配符具体含义及用法表


| 字符            | 含义                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| *               | 匹符配任意字                                                                                                                      |
| ？              | 匹配单个字符                                                                                                                      |
| []              | 匹配方括号中的任意一个，不能用于创建目录和文件                                                                                    |
| [^]             | 匹配方括号中的任意一个字符或数字后进行取反，等同于[!  ]，表示范围可以用".."或"—”，用于查找和删除目录和文件，不用于创建目录和文件  |
| [!]             | 匹配方括号中的任意一个字符或数字后进行取反,  等同于[^ ]，表示范围可以用".."或"—"， 用于查找和删除目录和文件，不用于创建目录和文件 |
| [？-？]         | 匹配方括号范围内任意一个，用于查询、删除，但不能用于创建目录和文件                                                                |
| {string,string} | 匹配括号中的任意一个字符串，表示一个范围时，字符串之间个".."                                                                      |


具体用法一一举例说明

root一次性创建目录f1和f2，现要求一次性通过通配符删除f1和f2文件

![](https://www.linuxidc.com/upload/2017_08/170823191574386.png#crop=0&crop=0&crop=1&crop=1&id=RRe1k&originHeight=120&originWidth=635&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

root创建f1到f9，现要求一次性通过通配符创建，并删除f5到f8

错误用法1：使用方括号创建f1到f9的目录,

![](https://www.linuxidc.com/upload/2017_08/170823191574383.png#crop=0&crop=0&crop=1&crop=1&id=woHS4&originHeight=59&originWidth=623&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

错误用法2：使用大括号用-表示范围创建目录f1到f9

![](https://www.linuxidc.com/upload/2017_08/170823191574384.png#crop=0&crop=0&crop=1&crop=1&id=qodNv&originHeight=62&originWidth=622&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

创建目录正确做法：正确做法是采用大括号，范围用“..”表示

![](https://www.linuxidc.com/upload/2017_08/170823191574381.png#crop=0&crop=0&crop=1&crop=1&id=KgbML&originHeight=195&originWidth=628&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

删除目录正确方法之一：用[^ ] 或者 [! ] 取反删除

![](https://www.linuxidc.com/upload/2017_08/170823191574385.png#crop=0&crop=0&crop=1&crop=1&id=Z1xD5&originHeight=119&originWidth=629&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

二、元字符<br />      元字符：shell负责解释处理，特殊的字符具有特殊的含义。

| 字符                      | 含义                                                     |
|-------------------------|--------------------------------------------------------|
| =                       | 设定变量、函数赋值等                                             |
| $                       | 作为变量或运算替换                                              |
| > 或  》                  | 重定向 stdout                                             |
| < 或 《                   | 重定向 stdin                                              |
| &                       | 2>1&  把标准错误输出转化为标准正确输出，1>2$把标准正取输出转化为标准错误输出 &>正取错误一起输出 |
| ( )                     | 结合$符合"$(  )"实现命令调用，综合运算中括号优先                           |
| {}                      | 范围界定，如 for I in  {1..10},变量i取值范围1到10                   |
| ;                       | 分号，多条命令同行依次执行，执行过程无依赖                                  |
| &&                      | 上一命令执行反馈正确，即$?=0，则继续执行下一条命令                            |
| \|\|                     | 上一命令执行反馈错误，即$?=1，则继续执行下一条命令                            |
| ！ 和 ~                   |  ！引用history历史语句，~是home目录 |

举例说明：

通过ls查看/app/hellohh 和/app 目录的文件，并重定向到1.log文件中，便于问题分析

![](https://www.linuxidc.com/upload/2017_08/170823191574387.png#crop=0&crop=0&crop=1&crop=1&id=zcYL4&originHeight=181&originWidth=1319&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

通过&>将正确的和错误的标准输出都进行重定向

三、转义字符

转义字符：将通配符和元字符变为本身的字符含义

| 字符 | 含义 |<br />| ‘ ’ | 硬转义，比较傻的字符引用，保留原有字符含义，不进行转义 |<br />| " " | 软转义，对特殊字符进行转义变为具有特殊含义的字符 |<br />| $()等价于`` | 强制引用命令， |<br />| \ | 显示原本的特殊字符 |

具体举例如下：

定义别名baketc，每天手工定期备份/etc目录下所有的文件，备份到/testdir独立子目录，并要求子目录格式bakupyyyy-mm-dd，备份过程可见（强引用``）

![](https://www.linuxidc.com/upload/2017_08/170823191574388.png#crop=0&crop=0&crop=1&crop=1&id=yIhEG&originHeight=31&originWidth=628&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

增加用户bash、testbash、basher、sh、nologin（shell为/sbin/nologin),找出/etc/passwd文件中，用户名和shell同名的行

![](https://www.linuxidc.com/upload/2017_08/170823191574389.png#crop=0&crop=0&crop=1&crop=1&id=UMYox&originHeight=88&originWidth=630&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

其中.*后面的第一个\就是转义字符，代表以/string$结尾的字符串

刚配置完网卡信息后，发现IP配置错误，因此利用history命令中记录重新配置网卡信息

![](https://www.linuxidc.com/upload/2017_08/170823191574382.png#crop=0&crop=0&crop=1&crop=1&id=ldQvO&originHeight=47&originWidth=615&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

**本文永久更新链接地址**：[http://www.linuxidc.com/Linux/2017-08/146463.htm](https://www.linuxidc.com/Linux/2017-08/146463.htm)
