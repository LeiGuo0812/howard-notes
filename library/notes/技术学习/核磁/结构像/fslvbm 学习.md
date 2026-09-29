---
date created: Monday, February 12th 2024, 4:31:12 pm
date modified: Friday, March 8th 2024, 1:21:17 pm
---
#影像 #数据处理 #FSL 
# 相关资料

**步骤讲解**

[FSLVBM/UserGuide - FslWiki](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/FSLVBM/UserGuide)

[learning-archive.org/wp-content/uploads/2017/11/使用FSL进行VBM分析.pdf](https://learning-archive.org/wp-content/uploads/2017/11/%E4%BD%BF%E7%94%A8FSL%E8%BF%9B%E8%A1%8CVBM%E5%88%86%E6%9E%90.pdf)

[FSL\_VBM\_instructions\_MM.pdf](https://cpb-us-e1.wpmucdn.com/sites.usc.edu/dist/1/803/files/2013/06/FSL_VBM_instructions_MM.pdf)

**脚本解析**

[learning-archive.org/wp-content/uploads/2022/08/解析FSL-VBM脚本.pdf](https://learning-archive.org/wp-content/uploads/2022/08/%E8%A7%A3%E6%9E%90FSL-VBM%E8%84%9A%E6%9C%AC.pdf)

**原脚本**

[FSL-scripts/rsc/fsl/orig at master · ahheckel/FSL-scripts · GitHub](https://github.com/ahheckel/FSL-scripts/tree/master/rsc/fsl/orig)

# 相关问题
- 在实际使用时，由于 fsl 的 fsleyes 作为单独的 python 库安装，有些命令如 `imcp`、`imglob` 等命令可能提示找不到，可以按照以下步骤恢复 [[FSL6.0.3、FSL6.0.4完整安装与FSLeyes、imcp、dcm2niix等Not Found修复(centos和ubuntu)#填坑——批量建立软连接]]

## WSL 下使用 fslvbm 的问题

- 发现 `fslvbm_1_bet` 脚本中默认使用 `bet` 命令，但 WSL 下，`bet` 命令会默认唤起图形界面

- 同样地，WSL 下 `fslvbm_2_template` 也会唤起图形界面

- 执行脚本中的 `standard_space_roi` 会卡住不动，目前不清楚原因

使用 linux 服务器运行则没有问题
## fslvbm_2_template 不输出 template 的问题
[bash - How to fix error in fslvbm\_2\_template where no template\_4D\_GM file is created - Stack Overflow](https://stackoverflow.com/questions/58334794/how-to-fix-error-in-fslvbm-2-template-where-no-template-4d-gm-file-is-created)

下载 nii.gz 版本的灰质模板：

[Cascade/data/std/avg152T1\_gray.nii.gz at master · Damangir/Cascade · GitHub](https://github.com/Damangir/Cascade/blob/master/data/std/avg152T1_gray.nii.gz)

修改原有脚本中的 T 变量为新的 nii.gz 文件，并保存成 `.sh` 文件后，按照原命令的传参方式运行该脚本。

如果要修改 `fast` 分割的方式，也应该可以修改对应位置代码。

## 直接从 fslvbm_2_template 开始
如果使用

>Antonopoulos, G., More, S., Raimondo, F., Eickhoff, S. B., Hoffstaedter, F., & Patil, K. R. (2023). A systematic comparison of VBM pipelines and their application to age prediction. _Neuroimage_, _279_, 120292. [https://doi.org/10.1016/j.neuroimage.2023.120292](https://doi.org/10.1016/j.neuroimage.2023.120292)

中介绍的 fmriprep + fslvbm 的方式进行数据处理，则可以直接使用 fmriprep 预处理后的 T1 + mask 获取预处理后的大脑图像，因此不需要进行 `fslvbm_1_bet` 命令，但数据准备需要注意几点：

- 准备一个 struc 文件夹，并拷入两类数据
	- 预处理后，没有 bet 的 T1 数据，并命名为 `*_struc.nii.gz`
	- 应用了 brainmask 后的 T1 数据，命名为 `*_struc_brain.nii.gz`
- 在 fslvbm 的主文件夹下，准备 `template_list`
	- `template_list` 中的文件名，应为 `*.nii.gz`

> [!warning]
>  `template_list` 文件名之间的换行符应该为 `LF`，而 windows 系统中生成的文件，换行符为 `CRLF`，会导致 fslvbm 无法正确读取，导致无法生成模板。
>  使用文本文档中**视图**菜单中的显示全部符号，即可检查确认。
>  
>同样地，如果在 windows 下生成 `design.mat` 和 `design.con` 等，也要注意！此外，准备好后，需要使用 FSL 提供的 `Text2Vest` 函数将数据转换成 `randomise` 可读的形式，否则会报错：[GLM/CreatingDesignMatricesByHand - FslWiki](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/GLM/CreatingDesignMatricesByHand?highlight=%28Text2Vest%29)

 在 R 语言中，要输出正确的 `template_list`，可使用：

```r
fwrite(data, file = "template_list", eol = "\n")
```

其中 `eol` 参数指定换行符，windows 下默认为 `\r\n`，即 `CRLF`，而修改成 `\n` 即可改为 `LF`

- 如果命令正确运行，则应该先在控制台打印出所有 `*_struc`，然后输出相应的命令提交log

![202403072225026.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202403072225026.png)

