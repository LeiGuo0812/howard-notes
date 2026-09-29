# 相关链接

[Uncovering the heterogeneity and temporal complexity of neurodegenerative diseases with Subtype and Stage Inference \| Nature Communications](https://www.nature.com/articles/s41467-018-05892-0)

[pySuStaIn: A Python implementation of the Subtype and Stage Inference algorithm - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2352711021001096)

[GitHub - ucl-pond/pySuStaIn: Subtype and Stage Inference (SuStaIn) algorithm with an example using simulated data.](https://github.com/ucl-pond/pySuStaIn)

[Microsoft C++ 生成工具 - Visual Studio](https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/)

# 安装 pySuStaIn

按照 github 的指示，有本地和在线两种安装方法


将库克隆到本地后，移动到该文件夹，执行：

```python
pip install .
```

或直接运行：

```python
pip install git+https://github.com/ucl-pond/pySuStaIn
```


## trouble shooting

### github 拉取失败

参考 [[git push运行后出现错误：|github 代理设置]]

### pip安装：Microsoft Visual C++ 14.0 or greater is required

[How to solve "error: Microsoft Visual C++ 14.0 or greater is required" when installing Python packages? - Stack Overflow](https://stackoverflow.com/questions/64261546/how-to-solve-error-microsoft-visual-c-14-0-or-greater-is-required-when-inst)

[Microsoft C++ 生成工具 - Visual Studio](https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/)

下载后，安装工具：

![]( https://i.sstatic.net/DKWVM.png )

然后重新安装即可

## 测试

If you want to check that the installation was successful, you can run the end-to-end tests. For this, you will need to navigate to the `tests/` subfolder (wherever pySuStaIn has been installed on your system). Then, you can use the following command to run all SuStaIn variants (this may take a bit of time!):

```python
python validation.py -f
```

For a quicker run (using just `MixtureSustain`), just use:

```python
python validation.py
```

instead. Testing of single classes is possible using the `-c` flag, e.g. `python validation.py -c ordinal`. To see all options, run `python validation.py --help`.