在使用 pip 安装 github 上的库时，出现报错 128，可能是因为电脑设置了代理，而 pip 没有使用。

可以添加代理参数：

```bash
pip install --proxy=http://your_proxy:port git+https://github.com/LeonDLotter/NiSpace.git@dev

```

一般为：

```bash
pip install --proxy=http://127.0.0.1:7890 git+https://github.com/LeonDLotter/NiSpace.git@dev
```