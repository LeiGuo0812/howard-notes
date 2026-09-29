---
date created: Saturday, April 15th 2023, 6:14:32 pm
date modified: Tuesday, October 1st 2024, 10:10:47 pm
---
#预处理 #影像 #docker 
# 1.安装 docker 和 fmriprep

1. 安装 WSL2 [[Linux/环境搭建/WSL相关（升级、图形界面、释放空间）]]
2. 安装 docker [[Docker]]

# 2. 将数据整理为 BIDS 格式

1. [[Brain Imaging Data Structure (BIDS)]]

运行前，可以使用 [GitHub - bids-standard/bids-validator: Validator for the Brain Imaging Data Structure](https://github.com/bids-standard/bids-validator) 来检查 BIDS 格式是否正确，通过后，在正式运行时即可使用 `--skip_bids_validation` 参数

- bids-validator 网页版：[bids-standard.github.io/bids-validator/](https://bids-standard.github.io/bids-validator/)

即使 bids-validator 没有抛出错误，warning 等也是很重要的，例如提示数据集中并非所有被试参数一致、个别被试缺少个别数据等等。
# 3. 进行预处理

注意，如果要进行 surface 分析，可以先用 parallel + freesurfer 预先将结构像处理好，然后再送给 fmriprep 进行分析。因为 fmriprep 可能无法完全利用所有的 cpu 进行 recon-all 操作，处理速度大大变慢，且运行 autorecon2 命令时会出现未知原因的报错

[Reusing precomputed derivatives fmriprep](https://fmriprep.org/en/stable/usage.html#reusing-precomputed-derivatives)

- 如果 out 文件夹内存在名为 /sourcedata/freesurfer 的处理后的 SBUJECTS_DIR,则 fmriprep 默认会直接使用 (注意是 sourcedata/freesurfer, 更新了)
- 也可以通过指定 `--fs-subjects-dir` 参数来指定特定文件夹
- 注意！如果是用 freesurfer 预先跑了，检查 SUBJECTS_DIR 中的 fsaverage 是文件夹还是软连接，新版本的 freesurfer 只会放一个软链接进去，导致 fmriprep 输出 fsaverage 空间的 func 时找不到文件报错

最后运行 fmriprep [[Docker#3. 运行镜像]]

[第5期之Docker和fmriprep\_苑瑞\_哔哩哔哩\_bilibili](https://www.bilibili.com/video/BV1T7411U7KK?p=6&vd_source=f05e6f927cb14747ba5653a9619a978c)

[OSF | BrainsCAN Computational Core Neuroimaging Wiki Wiki](https://osf.io/k89fh/wiki/fmriprep-docker/)

![202403302056864.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202403302056864.png)


ps. 如果数据中使用了 fieldmap [[关于场图 Field map fmap]]，处理时间会明显增加

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202304190855188.png)


# 一些需要注意的问题
## 关于 dummy scans
- fmriprep 自动识别 dummy scans，但是不会从图像中删除任何数据
- 如果不指定 `--dummy-scans` 参数，则fmriprep 自动检测 dummy scan


# fmriprep 之后的文件接口

使用 pybids 可以读取 BIDS 格式数据以及其derivatives

[bids.layout.BIDSLayout — PyBIDS 0.16.4 documentation](https://bids-standard.github.io/pybids/generated/bids.layout.BIDSLayout.html#bids.layout.BIDSLayout)

[Introduction to pybids — PyBIDS 0.16.4 documentation](https://bids-standard.github.io/pybids/examples/pybids_tutorial.html)

derivatives 的定义和读取：
- 使用 `BIDSLayout` 时，定义 `derivatives` 参数为路径
- 使用 `get` 方法时，定义 `scope` 为`derivatives`

```python
from bids import BIDSLayout

layout = BIDSLayout('BIDS/', derivatives= True, absolute_paths=True)

layout.get(scope='derivatives', return_type='file')

layout.get(extension='nii.gz', 
            suffix='bold', 
            return_type='file', 
            scope='derivatives', 
            session = 'pre', 
            space = 'MNI152NLin6Asym')
```

derivatives 参数的输入：
- **derivatives** ([_bool_](https://docs.python.org/3.5/library/functions.html#bool "(in Python v3.5)") _or_ [_str_](https://docs.python.org/3.5/library/stdtypes.html#str "(in Python v3.5)") _or_ [_list_](https://docs.python.org/3.5/library/stdtypes.html#list "(in Python v3.5)")_,_ _optional_) – Specifies whether and/or which derivatives to index. If True, all pipelines found in the derivatives/ subdirectory will be indexed. If a str or list, gives the paths to one or more derivatives directories to index. If False or None, the derivatives/ directory is ignored during indexing, and derivatives will have to be added manually via add_derivatives(). Note: derivatives datasets MUST contain a dataset_description.json file in order to be indexed.

# 应用fmriprep 输出的变形场文件

[Problem applying h5-files from fmriprep outputs for reproduction of normalization - Neuro Questions - Neurostars](https://neurostars.org/t/problem-applying-h5-files-from-fmriprep-outputs-for-reproduction-of-normalization/20959/4)

`antsApplyTransforms -d 3 -e 3 -n LanczosWindowedSinc -i sub-000480a3_ses-1_desc-preproc_T1w.nii.gz -r sub-000480a3_ses-1_space-MNI152NLin6Asym_desc-preproc_T1w.nii.gz -o t1_in_mni.nii.gz -t sub-000480a3_ses-1_from-T1w_to-MNI152NLin6Asym_mode-image_xfm.h5`