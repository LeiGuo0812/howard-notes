# 1. afni_proc.py

`afni_proc.py` 是用来生成预处理脚本的脚本，其工作主要是：
- 将所需的输入拷贝到结果文件夹，因此如果预处理流程需要修改，可以直接将结果文件夹删除
- 对数据进行预处理
- 生成结果
- 创建 `html` 脚本，用于质控

`afni_proc.py` 生成的脚本使用 `tsch` 语法


# 数据格式转换

使用 `Dimon` 命令进行格式转换

```bash
Dimon -infile_list uniq_image_list.txt \ # 以文件形式
      -gert_create_dataset             \ # 输出 AFNI 文件
      -gert_write_as_nifti             \ # 输出 nifti 文件
      -gert_to3d_prefix T1.3D          \ # 输出文件前缀
      -gert_outdir ..                  \ # 输出文件路径 
      -dicom_org                       \ # 对 dicom 文件排序
      -use_last_elem                   \ # 防止 dicom 文件信息出错
      -save_details Dimon.details      \ # 输出详细信息
	  -gert_quit_on_err                  # 报错停止
```

可以根据需要进行修改

单 AFNI 结果版
```bash
Dimon -infile_list uniq_image_list.txt \ # 以文件形式
      -gert_create_dataset             \ # 输出 AFNI 文件
      -gert_to3d_prefix T1.3D          \ # 输出文件前缀
      -gert_outdir ..                  \ # 输出文件路径 
      -dicom_org                       \ # 对 dicom 文件排序
      -use_last_elem                   \ # 防止 dicom 文件信息出错
	  -gert_quit_on_err                  # 报错停止
```

Dimon 命令转换的数据头文件信息和 dcm2niix 的会有一些不同，如仿射矩阵、slice timing 的信息等。因此如果**完全使用** AFNI 处理数据，建议还是一开始就使用 Dimon 转换原始数据，避免后续的许多麻烦；如果需要结合 `dcm2niix` 使用，则参考 `Warning`

```ad-warning
如果处理的是**西门子 Siemens** 的数据，则需要额外注意：
西门子使用 mosaic center 而不是 slice center 来定义图像中心，AFNI `Dimon` 使用 slice center，但 `dcm2niix` 直接使用 mosaic center 作为图像中心，因此两个软件转换出的图像中心/原点是不一样的。

如果处理西门子的数据，并用了 `dcm2niix` 转换了 T1 数据，然后又用 Dimon 转换 fMRI 数据，则两者的图像中心/原点相差很大，在后续配准时会产生严重错误，rest 图像严重偏离，导致预处理失败。
可能的解决办法是使用 `3dcopy` 将 `dcm2niix` 转好的 fMRI 数据转换为 AFNI 格式， 再用 `3drefit -Tslices` 写入 slice timing 的信息 （单位为s），以满足 slice timing 需要。然后进行预处理。

参考讨论：[Re: Slice-based center is different from mosaic center](https://afni.nimh.nih.gov/afni/community/board/read.php?1,69785,69806#msg-69806)
```


## Siemens 不同转换方式原点对比

1. T1: `dcm2niix` + rest: `dcm2niix` --> `3dcopy`
![](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221205112451.png)

2. T1: `dcm2niix` + rest: `Dimon`
![](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221205112630.png)

3. T1: `dcm2niix` + rest: `to3d -oblique_origin`
![](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221205112928.png)


## 不要用 SPM 校正原点后的文件给 afni_proc.py 处理

会报错：`** already in tlrc space: -volreg_tlrc_* is not allowed ** invalid block : volreg`

在 SPM 中修改原点后，AFNI 会认为图像已经进行了空间变换，将空间标记为 `tlrc` ，无法进行标准化。

要确认图像目前所在的空间，使用 `3dinfo -av_space` 命令查看

### 在 AFNI 中对图像进行原点校正

AFNI 讨论：
[Re: Setting Origins](https://afni.nimh.nih.gov/afni/community/board/read.php?1,45045,45057#msg-45057)

该例子中，使用 `dcm2niix` 转换 T1、resting 图像。用 `3dcopy` 将 nifti 文件转换为 BRIK/HEAD 文件

读取 T1 作为 underlay， resting 作为 overlay：

![|400](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221207160918.png)

发现 resting 的原点和 T1 无法对齐。T1 的原点在胼胝体后侧，为了对齐，可以也把 rest 的图像原点设置在该位置（一般原点在前联合，此处只是演示）

将 resting 作为 underlay，发现原点位置偏移：
![|475](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221207161355.png)

确定原点校正所需信息
![|475](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221207161938.png)

使用 `3drefit -dxorgin -dyorigin -dzorigin` 来修改头文件原点
![](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221207163703.png)

```ad-note
`3drefit` 命令认为 xyz 是基于 RAI 的，所以要检查数据的 order 是否匹配，在本例中，数据 order 也是 RAI，因此 `-dxorigin -dyorigin -dzorigin` 的输入顺序不需要变化。输入时，使用对应坐标的 **相反数**。

如果数据 order 是 ASL，则坐标中的 x 要放到 `3drefit` 命令的第二个位置，即 `-dyorigin`， 坐标的 y 放到 `-dzorigin`，坐标 z 放到 `-dxorigin`. 即进行坐标轴顺序的对应。该讨论可参考 [Re: Setting Origins](https://afni.nimh.nih.gov/afni/community/board/read.php?1,45045,45057#msg-45057)
```

使用 afni 查看修改后的原点，已经修改到想要的位置
![|450](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221207164007.png)

叠加T1确认
![|450](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221207164057.png)



# Slice timing 

使用 `3dTshift` 命令进行时间层校正

```bash
3dTshift -tzero 0 -quintic -prefix pb02.$subj.r$run.tshift \
             pb01.$subj.r$run.despike+orig
```

可以通过指定 `-tpattern` 来手动指定每一层的采集时间，可以用文件输入，注意此处时间单位是 **ms**.

- 经过测试，如果使用 `.nii` 文件作为输入，则 AFNI 会警告 `dataset is already aligned in time` ，并不进行任何校正. 因为将原始数据转换为 `.nii` 文件后，就丢失了时间层的信息。
	- 可以根据如下文档，使用 `3drefit -Tslices <datasetname>` 重新修改 `.HEAD` 文件的层序信息，注意修改时，使用的单位是 **s**. [https://afni.nimh.nih.gov/pub/dist/edu/latest/afni_handouts/SliceTiming.pdf](https://afni.nimh.nih.gov/pub/dist/edu/latest/afni_handouts/SliceTiming.pdf)
	- 此时再进行 `3dTshift` 进行时间层校正即可正确完成。（经过测试，multiband 采集数据也可以处理）
	- 但是，如果用 afni GUI 查看修改头文件后的 dataset 的每一层的时间 t，依然是现实全部对齐的，原因未知

![|500](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221204185542.png)

# 关于 AFNI 和 Friston's 24 头动回归

[Head motion parameters - proc.py](https://afni.nimh.nih.gov/afni/community/board/read.php?1,168748,168748)

AFNI 专业人员并不推荐使用 Frison's 24 参数

# 回归 ROI 信号

- 在 `afni_proc.py` 可以回归 ROI 中的协变量，语法可以参考该问答：
[regressing out WM in afni_proc.py](https://afni.nimh.nih.gov/afni/community/board/read.php?1,166298,166298#msg-166298)
[Re: regressing out WM in afni_proc.py](https://afni.nimh.nih.gov/afni/community/board/read.php?1,166298,166455#msg-166455)

- 逐步完成可参考 Andy 博客
[Extracting and Regressing Out Signal in White Matter and CSF — Andy's Brain Blog](https://www.andysbrainblog.com/andysbrainblog/2014/05/extracting-and-regressing-out-signal-in.html)

- 注意：AFNI 认为**不是所有的 CSF 信号都适合用来回归**，只有脑室内的信号适合回归，因此要将 CSF mask 和一个标准的脑室 mask 取交集
> While -mask_segment_anat also creates a CSF mask, that mask is ALL
   CSF, not just restricted to the ventricles, for example.  So it is
   probably not appropriate for use in tissue-based regression

- 可以**使用 Freesurfer 的分割结果来获取白质 mask 和侧脑室 mask， 用于回归协变量**，可参考 Example 11：
	- [afni_proc.py — Freesurfer Note](https://afni.nimh.nih.gov/pub/dist/doc/htmldoc/programs/alpha/afni_proc.py_sphx.html#freesurfer-note)
		- 注意 `@SUMA_Make_Spec_FS -sid <subjname> -NIFTI` 要进入到单个被试的 Freesurfer 结果文件夹中运行,  但可以添加参数 `-fspath <subjname>/` 运行后生成的 /SUMA 文件夹 ~ 400M
	- [afni_proc.py — Eample 11](https://afni.nimh.nih.gov/pub/dist/doc/htmldoc/programs/alpha/afni_proc.py_sphx.html#example-11-resting-state-analysis-now-even-more-modern)
		- 需要的文件为 `fs_ap_latvent.nii.gz` 、`fs_ap_wm.nii.gz`
	- 其他所需的 aseg 文件，均可通过 `@SUMA_Make_Spec_FS` 命令获得


# afni_proc.py 文件示例

## resting fMRI 预处理

### 无 freesurfer
修改自 `Example 11b` 

基于 Resting fMRI 和 T1，未经过 freesurfer处理

```bash
afni_proc.py                                                         \
    -subj_id                  sub01_rest                            \ # 输出文件名前缀
    -blocks                   despike tshift align tlrc volreg  \
                              mask scale regress                     \
    -copy_anat                T1.nii                           \ # T1像，dcm2niix转换得到
    -dsets                    rest+orig                    \ # resting fMRI 数据，dcm2niix 转换 + 3dcopy + 3drefit 设置时间层信息
    -tcat_remove_first_trs    5                                      \
    -align_unifize_epi        local                                  \
    -align_opts_aea           -cost lpc+ZZ                           \
                              -giant_move                            \
                              -check_flip                            \
    -tlrc_base                MNI152_2009_template_SSW.nii.gz        \ # 配准模板
    -tlrc_NL_warp                                                    \
    -volreg_align_to          MIN_OUTLIER                            \
    -volreg_align_e2a                                                \
    -volreg_tlrc_warp                                                \
    -volreg_warp_dxyz         2.5                                    \
    -mask_segment_anat        yes                                    \
    -mask_segment_erode       yes                                    \
    -mask_import              Tvent template_ventricle_2.5mm+tlrc    \ # 脑室标准模板，注意该模板是 Tailarach 模板，需修改
    -mask_intersect           Svent CSFe Tvent                       \
    -mask_epi_anat            yes                                    \
    -regress_motion_per_run                                          \
    -regress_ROI_PC           Svent 3                                \ # 回归ROI内前3个主成分
    -regress_ROI_PC_per_run   Svent                                  \
    -regress_make_corr_vols   WMe Svent                              \
    -regress_anaticor_fast                                           \
    -regress_censor_motion    0.2                                    \
    -regress_censor_outliers  0.05                                   \
	-regress_bandpass         0.01 0.1                               \ # 滤波，官方脚本中没有
    -regress_apply_mot_types  demean deriv                           \
    -regress_est_blur_epits                                          \
    -regress_est_blur_errts                                          \
    -regress_run_clustsim     yes
```


### 基于 freesurfer

需要先用 `recon-all` 处理 T1， 然后用 `@SUMA_Make_Spec_FS -sid -fspath -NIFTI` 转换成 AFNI 可读的格式

```bash
afni_proc.py                                                         \
    -subj_id                  sub01                             \
    -blocks                   despike tshift align tlrc volreg       \
                              mask scale regress                     \
    -radial_correlate_blocks  tcat volreg                            \
    -copy_anat                sub01/SUMA/brain.nii.gz                          \ # 可以使用去脑壳结构像
    -anat_has_skull           no                                     \
    -anat_follower            anat_w_skull anat sub01/SUMA/T1.nii.gz         \
	-anat_follower_ROI        aaseg anat                             \
                              sub01/SUMA/aparc.a2009s+aseg_REN_all.nii.gz       \ # 用于可视化
    -anat_follower_ROI        aeseg epi                              \
                              sub01/SUMA/aparc.a2009s+aseg_REN_all.nii.gz       \ # 用于可视化
    -anat_follower_ROI        FSvent epi sub01/SUMA/fs_ap_latvent.nii.gz        \ # 用于回归协变量
    -anat_follower_ROI        FSWe epi sub01/SUMA/fs_ap_wm.nii.gz               \ # 用于回归协变量
    -anat_follower_erode      FSvent FSWe                            \
    -dsets                    rest+orig                    \
    -tcat_remove_first_trs    5                                      \
    -align_unifize_epi        local                                  \
    -align_opts_aea           -cost lpc+ZZ                           \
                              -giant_move                            \
                              -check_flip                            \
    -tlrc_base                MNI152_2009_template_SSW.nii.gz        \
    -tlrc_NL_warp                                                    \
    -volreg_align_to          MIN_OUTLIER                            \
    -volreg_align_e2a                                                \
    -volreg_tlrc_warp                                                \
    -mask_epi_anat            yes                                    \
    -regress_motion_per_run                                          \
    -regress_ROI_PC           FSvent 3                               \
    -regress_ROI_PC_per_run   FSvent                                 \
    -regress_make_corr_vols   aeseg FSvent                           \
    -regress_anaticor_fast                                           \
    -regress_anaticor_label   FSWe                                   \
    -regress_censor_motion    0.2                                    \
    -regress_censor_outliers  0.05                                   \
	-regress_bandpass         0.01 0.1                               \ # 滤波，官方脚本没有
    -regress_apply_mot_types  demean deriv                           \
    -regress_est_blur_epits                                          \
    -regress_est_blur_errts                                          \
    -html_review_style        basic
```

# 基于 afni_proc.py 的预处理批处理

实现基于 `afni_proc.py` 的预处理批处理的步骤包括：
1. 首先用一个被试的数据 + `afni_proc.py` 生成预处理代码
2. 打开预处理代码，进行修改：
	1. 定义脚本第一个参数为 rest 数据
	2. 定义脚本第二个参数为被试 ID
	3. 设置 3dcopy 路径（T1、ROI）等
	4. 设置 3dTcat 路径 （fMRI）
	5. 设置结果路径

```tcsh
#设置第一个参数为 rest 数据，第二个参数为被试ID
set data = $argv[1] 
set subj = $argv[2]

# assign output directory name
set output_dir = $subj.results

# copy anatomy to results dir
3dcopy $subj/SUMA/brain.nii.gz $output_dir/brain

# copy anatomical follower datasets into the results dir
3dcopy $subj/SUMA/T1.nii.gz $output_dir/copy_af_anat_w_skull
3dcopy $subj/SUMA/aparc.a2009s+aseg_REN_all.nii.gz $output_dir/copy_af_aaseg
3dcopy $subj/SUMA/aparc.a2009s+aseg_REN_all.nii.gz $output_dir/copy_af_aeseg
3dcopy $subj/SUMA/fs_ap_latvent.nii.gz $output_dir/copy_af_FSvent
3dcopy $subj/SUMA/fs_ap_wm.nii.gz $output_dir/copy_af_FSWe

# ====== auto block: tcat ======
# apply 3dTcat to copy input dsets to results dir,
# while removing the first 5 TRs
3dTcat -prefix $output_dir/pb00.$subj.r01.tcat $data'[5..$]'
```


```ad-warning
title: Warning 1
如果用WSL处理数据，并从 Excel 表中用 windows 的编辑器拷贝被试 ID，则会带上隐藏的制表符，导致使用 `cat list.txt` 循环的时候读取被试 ID 或文件路径报错。需要使用 Linux 系统下的编辑器如 gedit 或 nano 来进行拷贝。
```

```ad-warning
title: Warning 2
如果使用 AFNI 和 `afni_proc.py` 生成的脚本进行批处理，应该使用 for 循环而不是 parallel 函数，因为 AFNI 预处理过程本身就包括多线程计算，速度并不慢。使用 parallel 可能会导致程序崩溃。
```
