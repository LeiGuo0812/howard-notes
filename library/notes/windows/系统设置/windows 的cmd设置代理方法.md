[windows 的cmd设置代理方法-CSDN博客](https://blog.csdn.net/SHERLOCKSALVATORE/article/details/123599042)

最新推荐文章于 2025-09-16 08:01 :50 发布

原创 于 2022-03-19 17:44:28 发布 · 8.3w 阅读

1、首先打开 cmd （win + R，输入 cmd，然后按 enter 键）

2、输入以下命令

set http\_proxy=http://127.0.0.1:端口号  
set https\_proxy=http://127.0.0.1:端口号

代理服务器的地址的查看：直接搜代理服务器设置

当然了，最好还是验证是否生效了，我用的curl来验证，命令如下  
```
#一些参数解释  
#-v verbose (print errors/warnings while in event loop)  
#-vv very verbose (also print client commands/reponses)  
#-vvv extremely verbose (also print internal state transitions)  
#-k 关闭SSL证书检查  
#更多配置命令，请看https://www.jianshu.com/p/07c4dddae43a  
curl -vvvk https://www.google.com
```


3、如果你的代理服务器要求用户名和密码的话，那么还需要：

set http\_proxy\_user=  
set http\_proxy\_pass=  
4、设置完成之后就可以在 cmd 下正常使用网络了。（npm install -g gulp）

如果需要永久生效的话，是需要配置系统的环境变量的，配置方法如下：

1、右键【我的电脑 】-> 属性 -> 高级系统设置 -> 高级 -> 环境变量

2、添加如下的[系统环境变量](https://so.csdn.net/so/search?q=%E7%B3%BB%E7%BB%9F%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F&spm=1001.2101.3001.7020)（对应的值记得修改）

![](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/ddc9aa974360c3a752a6b953821d14ff.png)