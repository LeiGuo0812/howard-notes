#Python #jupyter

jupyterlab 安装：

```powershell
mamba install jupyterlab
```

jupyterlab 启动：
```powershell
jupyter lab
```

重要参数：指定启动位置：`--notebook-dir D:`

安装 variable inspector:

[GitHub - conda-forge/jupyterlab-variableinspector-feedstock: A conda-smithy repository for jupyterlab-variableinspector.](https://github.com/conda-forge/jupyterlab-variableinspector-feedstock)

- 直接使用命令行安装，可以使用，但无法和变量互动。
- 通过 UI 安装，则 jupyterlab 会 rebuild 失败