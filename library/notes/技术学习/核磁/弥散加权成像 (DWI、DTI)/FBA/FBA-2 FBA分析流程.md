#影像 #数据处理 #Mrtrix3 #DWI 
# 基本概念和知识

1. *fixel*：refer to a specific population of **fi**bres within a single vo**xel**. (David A.Raffelt, 2015, neuroimage)
2. *response function*: The **diffusion-weighted signal attenuation** that would be measured from a **single coherently oriented fiber population** can be represented by an axially symmetric response function _R_(_θ_); The response function can and **should be estimated directly** from the data by measuring the **diffusion-weighted signal** profile **in regions likely to contain a single coherently oriented fiber population** (i.e., those **with the highest diffusion anisotropy**) (J.-DonaldTournier, 2004, neuroimage)
3. *optimal b value*: the optimal b value lies between 3000 and 4000 s/mm2. (J.-DonaldTournier, 2004, neuroimage)
4. *advantages* (J.-DonaldTournier, 2004, neuroimage)
	1. fast computation
	2. no a priori information is needed regarding the number of distinct fiber orientations present
	3. not dependent on any assumed model of diffusion
5. FBA assumes that all observed variations in diffusion anisotropy are **due purely to partial volume effects**; the response function measured for a typical coherently oriented fiber population is **constant throughout the brain** (J.-DonaldTournier, 2004, neuroimage)
6. Factors may affect FOD estimation (J.-DonaldTournier, 2004, neuroimage)
	1. myelin: complete absence of myelin causes a reduction in anisotropy of approximately 20%
	2. the distribution of axonal diameters, may also exhibit a regional dependence.
	3. artefactual negative side lobes in the reconstructed fiber ODF
		1. ringing, using an inappropriate response function, and noise
7. *FOD ‘peak’* :which we consider the precise direction on the unit hemisphere for which the FOD amplitude is a maximum (Robert E.Smith, 2015, neuroimage)
8. *FOD ‘lobe’*: which can be considered the angular spread of each ‘peak’ (Robert E.Smith, 2015, neuroimage)

**CSD 图示** (J.-DonaldTournier, 2004, neuroimage)
![|500](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221129122657.png)

**fiber density 图示** （DavidRaffelt, 2012, Neuroimage)
注意 C 为 response function, D 为 FOD
![|500](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221129122142.png)

参考文献
> Sydnor, V. J., Cieslak, M., Duprat, R., Deluisi, J., Flounders, M. W., Long, H., Scully, M., Balderston, N. L., Sheline, Y. I., Bassett, D. S., Satterthwaite, T. D., & Oathes, D. J. (2022). Cortical-subcortical structural connections support transcranial magnetic stimulation engagement of the amygdala. _Science Advances_, _8_(25), eabn5803. [https://doi.org/10.1126/sciadv.abn5803](https://doi.org/10.1126/sciadv.abn5803)

# 数据情况

_b_ = 1000 s/mm2 (and one _b_ = 0 volume) with the following parameters: repetition time = 4000 ms, echo time = 72.60 ms, flip angle = 90°, voxel size = 2 mm3, and slice number = 76.

处理pipline: QSIPrep 0.6.3RC3

# 预处理

预处理细节，参考[[FBA-1 Mrtrix3 预处理]]

- denoise
- FSL 头动涡流校正，outlier replacement 
- 反相位编码 b0 磁敏感校正
- 偏差场校正
	- `dwibiascorrect ants` for generate mask
- 预处理后的 b0 像 配准到 T1 (已剥头皮、AC-PC校正) 
- 弥散像上采样到1.3mm，并配准到T1像

# FBA 计算

**分析流程** (David A.Raffelt, 2017, Neuroimage)
![|500](https://ars.els-cdn.com/content/image/1-s2.0-S1053811916304943-gr3_lrg.jpg)


基本知识：预处理后的文件、FOD文件、response function文件、指标文件都是一个文件的形式存储；fixel 文件以一个文件夹形式存储，如 `<fixel_mask_dir>` 即模板空间的 fixel，定义了 fixel 的数量和方向

1. 对每个被试进行基于 CSD 的 1-shell-3-tissue 的 respnse function 计算
	1. `dwi2mask` + `maskfilter -npass 3 <input> -dilate <output>` 生成 dilate mask (估计 response function 的时候用不到)
	2. `dwi2response dhollander` 估计 3 tissue 的 response function
2. 使用 average response function 计算每个被试的 FOD
	1. `responsemean <response_file_list> <mean_response.txt>`
	2. 上采样 DWI 数据 `mrgrid <sub/unbiased_dwi> regrid -vox 1.25 <sub/upsampled_dwi>`
	3. `dwi2mask` 基于 `<sub/upsampled_dwi>` 生成 conserve mask 
	4. `ss3t_csd_beta1` 估计三个组织的FOD，该函数在 Mrtrix3 中找不到，但 single shell 数据计算的三个 tissue 的 FOD，在`mtnormalise` 阶段会报错， 可以只估计 WM 的，参考 [[FBA-1 Mrtrix3 预处理]]，该步骤可以用 dilate 的 mask，也可以用 conserve mask。
3. three-tissue bias field correction + global intensity normalization across group
	1. `mtnormalise` **use consrvative mask!** （`mtnormalise` 对非脑组织敏感，应使用只包含脑组织的mask，文章提供的代码似乎使用了 dilate 的 mask，这是有误的）[Fibre density and cross-section - Multi-tissue CSD — MRtrix 3.0 documentation](https://diigo.com/0qug9y)
4. 创建 study-specific FOD 模板
	1. `ln` 创建 WM-FOD 和 mask（dilate） 的软链接
	2. `population_template <template/input_dir> -mask_dir <template/mask_dir> <template/template_FOD> -voxel_size 1.3`
5. 估计个体的 FOD 图像配准到 FOD 模板上的变形场
	1. `mrregister <sub/normed_WM_FOD> -mask1 <sub/conserve mask> <template/template_FOD> -nl_warp <sub/sub2template_warp> <sub/template2sub_warp>` 此处得到的变形场内有 reorient 的信息，但是在后续的配准中并不使用，而是单独做
6. 将个体的脑 mask 配准到 FOD 模板上，并生成模板mask
	1. `mrtransform <sub/input_mask> -warp <sub/sub2template_warp> -interp nearest -datatype bit <sub/output_mask_in_template>`
	2. `mrmath <mask_in_template_list> min <template/template_mask> -datatype bit`
7. 计算模板的分析 Fixel mask (注意 fixel 文件以文件夹形式保存)
	1. `fod2fixel -mask <template/template_mask> -fmls_peak_value 0.10 <template/template_FOD> <template/fixel_mask_dir>` （文档中 `-fmls_peak_value` 使用了0.06）
8. 将个体的 FOD 配准到 FOD 模板上，不重新转换方向
	1. `mrtransform <sub/normed_WM_FOD> -warp <sub/sub2template_warp> -reorient_fod no <sub/FOD_in_template_noreorient>`
9. 计算每个被试在模板空间上的 fixel 和 Fiber density，并重新转换方向
	1. `fod2fixel -mask <template/mask_in_template> <sub/FOD_in_template_noreorient> <sub/output_noreorient_fixel_dir> -afd <sub_FD>` 此处输出的 FD 在被试文件夹中的 fixel 文件夹中
	2. `fixelreorient <sub/noreorient_fixel_directory> <sub/sub2template_warp> <sub/output_reoriented_fixel_dir>`
10. 对应被试在模板空间的 Fixel 到 模板上的 Fixel，使用 FD 文件，输出的 FD 用于后续的统
	1. 计算`fixelcorrespondence <sub/output_reoriented_fixel_dir/fd.mif> <template/fixel_mask_dir> <template/output_fd_dir> <output_FD>`
11. 计算 FC、logFC
	1. `warp2metric -warp <sub/sub2template_warp> -fc <template/fixel_mask_dir> <template/output_fc_dir> <output_FC>`
	2. 准备 logFC 文件夹，复制 fixel 的 index 和 direction
		1.  `mkdir <template/logfc_dir>`
		2. `cp template/<fc_dir>/index.mif template/<fc_dir>/directions.mif template/<logfc_dir>/`
		3. 计算 logFC `mrcalc <fc_file> -log <logfc_file>`
12. 计算 FDC
	1. 准备 FDC 文件夹，复制 fixel 的 index 和 direction
		1. `mkdir template/<fdc_dir>`
		2. `cp template/<fc_dir>/index.mif template/<fc_dir>/directions.mif template/<fdc_dir>/`
	2. 计算 FDC `mrcalc template/<fd_dir>/<fd_file> template/<fd_dir>/<fc_file> -mult <fdc_file>`
13. 基于 FOD 模板的 全脑纤维追踪 （Mrtrix3默认参数，生成250万条纤维）
	1. `tckgen -angle 22.5 -maxlen 250 -minlen 10 -power 1.0 <template/template_FOD> -seed_image <template/template_mask> -mask <template/template_mask> -select 2500000 -cutoff 0.10 <template/.tck file>`
14. 降低纤维图密度 (文章和代码中没有出现)
	1. `tcksift <template/.tck file> <template/template_FOD> <template/output.tck file> -term_number 2000000`
15. 计算 Fixel-Fixel 连接矩阵，并用于 smooth 指标 (文章和代码中没有体现，但应该做了)
	1. 计算连接矩阵：`fixelconnectivity <template/fixel_mask_dir> <template/output.tck mask> matrix/`
	2. smooth 指标：`fixelfilter fd smooth fd_smoothed logfc smooth logfc_smoothed fdc smooth fdc_smoothed -matrix matrix/`

# Tractography 
1. ROI 准备：基于 HCP FA 模板和研究 FA 模板，将 MNI 空间的 ROI 配准到研究模板上
	1. 研究 FA 模板准备
		1. 获取个体 FA map`dwi2tensor` + `tensor2metric`
		2. 将个体 FA map 配准到研究模板 `mrtransform <sub/FA> -warp <sub/sub2template_warp> -interp cubic <sub/FA_in_template>`
		3. 平均所有模板空间上的 FA：`mrcat <FA_in_template_list> <template/FA_in_template_all>` + `mrmath <template/FA_in_template_all> mean <mean_FA_in_template>`
		4. 转换成 nii 格式 `mrconvert`
		5. 生成模板 FA mask：![[#生成模板 FA mask 代码]]
	2. 将 HCP FA map 配准到模板空间的平均 FA map 上
		1. 将 HCP FA map 重采样模板 FA 的分辨率：`ResampleImage 3 <HCP_FA> <HCP_FA_resampled> 1.3X1.3X1.3 0 4`
		2. 执行配准：`antsRegistrationSyN.sh -d 3 -m <HCP_FA_resampled> -f <template/mean_FA_in_template>  -o <MNI2template>
	3. MNI ROI 提取：`fslmaths <atlas> -thr <ROI_index> -uthr <ROI_index> <ROI>`
	4. 将 ROI 配准到研究模板上：`antsApplyTransforms -d 3 -i <ROI> -r <FOD_template0.nii.gz> -o <ROI_in_template> -n NearestNeighbor -t <MNI2template1Warp.nii.gz> -t <MNI2template0GenericAffine.mat>`
2.  基于 ROI (vlPFC - amygdala) 的纤维束提取 (使用 `-ends_only` 提取起止于 ROI 内的纤维)`tckedit <template/.tck file> -include <ROI1_in_template> -include <ROI2_in_template> -ends_only <TOI.tck>`
3. 将提取的纤维束重新映射回单个 Fixel （streamline to fixel, threshold 5, replicated with 2, 4, 6, 8, and 10 streamlines）
	1. 将纤维重新映射回对应的 fixel：`tck2fixel <TOI.tck> <template/fixel_mask_dir> <TOI_fixel_dir> <TOI_fixel.mif>
	2. fixelcrop：将 fixel 数目限制在一定数量
		1. 生成 fixel mask `mrthreshold <TOI_fixel.mif> -abs $num <TOI_fixel_mask.mif>
		2. fixelcrop：`fixelcrop template/<FD/logfc/fdc_smooth> <TOI_fixel_mask.mif> <fd/logfc/fdc_TOI>`
4. 计算每个被试对应 Fixel  的平均 fiber density 和 fiber cross section 等指标 `mrstats <fd_TOI/subj_fd.mif> -output mean`

## 生成模板 FA mask 代码

```bash
# extract first image of FOD in template
mrconvert <template/FOD_template> -coord 3 0 -axes 0,1,2 <template/FOD_template0>
# convert to .nii.gz
mrconvert <template/FOD_template0> <template/FOD_template0.nii.gz>
# threshold absolute value
fslmaths <template/FOD_template0.nii.gz> -thr 0.001 <template/FOD_template0.nii.gz>
# binarize the image
fslmaths <template/FOD_template0.nii.gz> -bin <template/FA_in_template_mask.nii.gz>
# rm <FOD_template0.nii.gz> 代码中删除了，但后面还用到了，所以先不删除
# Erode three times by zeroing non-zero voxels when zero voxels found in kernel
fslmaths <template/FA_in_template_mask.nii.gz> -ero <template/FA_in_template_mask.nii.gz>
fslmaths <template/FA_in_template_mask.nii.gz> -ero <template/FA_in_template_mask.nii.gz>
fslmaths <template/FA_in_template_mask.nii.gz> -ero <template/FA_in_template_mask.nii.gz>
# confine FA in template in the mask
fslmaths <template/mean_FA_in_template> -mul <template/FA_in_template_mask.nii.gz> <mean_FA_in_template>
```

# 个体 FOD 配准时为什么分开做 reorient

> Raffelt, D. A., Tournier, J.-D., Smith, R. E., Vaughan, D. N., Jackson, G., Ridgway, G. R., & Connelly, A. (2017). Investigating white matter fibre density and morphology using fixel-based analysis. _NeuroImage_, _144_, 58–73. [https://doi.org/10.1016/j.neuroimage.2016.09.029](https://doi.org/10.1016/j.neuroimage.2016.09.029)

文献中指出：分开做 reorient 使得该 pipline 可以应用于任何弥散指标

> We note that performing fixel reorientation as a separate step in the processing pipeline (as opposed to performing FOD reorientation when transforming FOD images) (Fig. 3) enables any fixel-based measure of FD to be investigated within this framework (see Section 5 for more details).

> The analysis pipeline in MRtrix was designed to enable FBA on any fixel-based measure. This can be achieved by replacing the steps indicated by the red boxes in Fig. 3. Instead of warping FODs, DWI images can be warped (without any reorientation of the DW gradients since this is performed in a subsequent step), and instead of computing fixel directions and FD from FODs, one could estimate them from another DWI model (e.g. CHARMED).

在 Mrtrix3 的讨论中说明，reorient 步骤也可以直接在 FOD 中一步做好：
[FBA analysis pipeline help - General Discussion - MRtrix3 Community](https://community.mrtrix.org/t/fba-analysis-pipeline-help/1276)

![|575](https://raw.githubusercontent.com/LeiGuo0812/pic_cloud_gl/main/img/20221129195831.png)

# 相关文献

[[皮质-皮质下结构连接支持经颅磁刺激刺激杏仁核]]