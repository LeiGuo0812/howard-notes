---
date created: Wednesday, December 6th 2023, 11:02:50 am
date modified: Wednesday, December 6th 2023, 11:28:54 am
---
#python #影像 #数据处理 #数据库
# 使用

[templateflow](https://www.templateflow.org/) 是一个用于神经影像学研究的资源，提供了一个大型的、公开的模板库。这些模板用于标准化大脑成像数据的处理和分析。

可以使用 python client 调用：[Python Client - TemplateFlow](https://www.templateflow.org/usage/client/)

安装
`pip install templateflow`

使用

```python
from templateflow import api as tflow
tflow.get('MNI152NLin6Asym', desc=None, resolution=1,
		  suffix='T1w', extension='nii.gz')
```


# windows 下获取模版报错：not a gzip file

这是因为获取到了大小为 0 的模板文件 ： [Python Client - TemplateFlow### Why am I getting zero-sized NIfTI files?](https://www.templateflow.org/usage/client/#why-am-i-getting-zero-sized-nifti-files)

可能的解决方法为：
- 安装最新版本的 templateflow：`pip install -U templateflow`

- 找到 templateflow 的模板储存路径，默认为：`$C:\Users\Username\.cache\templateflow`

- 将路径下的文件全部删除

- 下载最新 template 路径结构：[GitHub - templateflow/templateflow: The TemplateFlow Archive - A DataLad super-dataset](https://github.com/templateflow/templateflow)，解压后，拷贝所有 tpl 开头文件到 template 模板储存路径

- 重新打开 python，再运行 `get` 函数，恢复正常