---
date created: Thursday, January 11th 2024, 1:41:16 pm
date modified: Thursday, January 11th 2024, 1:42:06 pm
---
#Python #编程

[python设置环境变量(临时和永久) - LuoSpider - 博客园](https://www.cnblogs.com/luocodes/p/10690246.html#:~:text=%E8%AE%BE%E7%BD%AE%E4%B8%B4%E6%97%B6%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F%20import%20os%20%23%20%E8%AE%BE%E7%BD%AE%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F%20os.environ%20%5B%20%27WORKON_HOME%27,os.environ%20%5B%27HOMEPATH%27%5D%3A%E5%BD%93%E5%89%8D%E7%94%A8%E6%88%B7%E4%B8%BB%E7%9B%AE%E5%BD%95%E3%80%82%20os.environ%20%5B%27TEMP%27%5D%3A%E4%B8%B4%E6%97%B6%E7%9B%AE%E5%BD%95%E8%B7%AF%E5%BE%84%E3%80%82%20os.environ%20%5B%27PATHEXT%27%5D%3A%E5%8F%AF%E6%89%A7%E8%A1%8C%E6%96%87%E4%BB%B6%E3%80%82%20os.environ%20%5B%27SYSTEMROOT%27%5D%3A%E7%B3%BB%E7%BB%9F%E4%B8%BB%E7%9B%AE%E5%BD%95%E3%80%82)

```python
import os

# 设置环境变量
os.environ['WORKON_HOME']="value"
# 获取环境变量方法1
os.environ.get('WORKON_HOME')
#获取环境变量方法2(推荐使用这个方法)
os.getenv('path')
# 删除环境变量
del os.environ['WORKON_HOME']  
其他key值：
os.environ['HOMEPATH']:当前用户主目录。
os.environ['TEMP']:临时目录路径。
os.environ['PATHEXT']:可执行文件。
os.environ['SYSTEMROOT']:系统主目录。
os.environ['LOGONSERVER']:机器名。
os.environ['PROMPT']:设置提示符。
```

