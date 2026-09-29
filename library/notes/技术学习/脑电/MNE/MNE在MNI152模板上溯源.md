---
date created: Thursday, January 11th 2024, 10:13:33 pm
date modified: Monday, January 15th 2024, 12:46:27 am
---
MNE 默认的头模板是 fsaverage, 但使用 volume 的方法溯源后，多用 MNI152 template 兼容的 atlas 进行提值。因此需要修改默认的 volume 脑模板。有两个思路：
- 使用 MNI152 template 进行 freesurfer 的 `recon-all` 分割得到模板的分割模型，然后用 `mne.bem.maked_watershed_bem` 获取分界，再和标准 10-20 电极匹配后构建头模型和源模型。
- 先使用 fsaverage 的头模板进行源估计，再将源空间的结果配准到 MNI 模板上。

# 方案 1：使用 MNI 模板分割构建头模型

模板取自：[Atlases – NIST](https://nist.mni.mcgill.ca/atlases/)

- 使用 MNI152Nlin2009cSym 模板，用 MNE 的分水岭算法会导致错误的边界分割。
- 使用 152 nonlinear extended 2020 （带面部脖子版本）可以得到正确边界

## Step 1: MNI template 和 10-20 系统配准 (获取 -trans.fif)

创建一个虚拟数组，设置为 MNE 的标准 1020 电极位置，并使用 MNI152 extended 分割好的模板进行电极-MRI 配准：

```python
# import libraries
import mne
import os
import numpy as np
import nibabel as nib
from nilearn.image import resample_to_img

# set temperoal environment variable to load
# freesurfer outputs
os.environ['SUBJECTS_DIR'] = "D:/Data/MNE_source_estimation"

subject = 'mni152ext'
subjects_dir = './'

# fetch a standard montage
montage = mne.channels.make_standard_montage('standard_1020')
# montage.save('standard_1020.fif.gz', overwrite = True)

# generate random data for creating fake inst
data = np.random.randn(10, 94, 3000) * 50e-7
info = mne.create_info(ch_names=montage.ch_names, sfreq=1000, ch_types='eeg')
epoch = mne.EpochsArray(data, info)

# set montage as standard 10-20
epoch.set_montage(montage)
epoch.save('epoch_1020.fif.gz', overwrite=True)
epoch = mne.read_epochs('epoch_1020.fif.gz')

# check sensor location
epoch.plot_sensors(show_names=True)

# check segmentation
mne.viz.plot_bem(subject='mni152ext', brain_surfaces='white')

# run mne make_scalp_surfaces before this line
mne.gui.coregistration(inst='epoch_1020.fif.gz')

# save *-trans.fif file

# check alignment
mne.viz.plot_alignment(
    epoch.info,
    trans = './MNI152_standard1020-trans.fif',
    subject=subject,
    dig=True,
    eeg=['original','projected'],
    # valid only after run mne make_scalp_surfaces
    surfaces="head-dense" 
)
```

从 MNE 提供的 template 的电极位置来看，MNE 默认的电极位置应该是和 MNI 空间头模刚体变换的。（eeg_positions 库，但并没有明确说明：[Compute and plot standard EEG electrode positions — eeg\_positions 2.2.0.dev0 documentation](https://stefanappelhoff.com/eeg_positions/#footcite-10-05-article)）

在使用 `mne.gui.coregistration` 图形化配准界面之前，应该通过 `mne.bem.make_scalp_surfaces` 或者 command line tools (使用装有 MNE 环境的 terminal 运行)运行 MNE 的 `mne make_scalp_surfaces` 命令来生成高清头部表面，会在 subject 的 bem 和 surf 文件夹下生成  head-dense.fif 和 l/rh.seghead 文件，该文件也可以用于 `mne.viz.plot_alignment` 函数中的 `surfaces="head-dense"` 参数，使用高清表面可以使电极位置配准更佳。

[Command line tools using Python — MNE 1.6.1 documentation](https://mne.tools/stable/generated/commands.html#mne-make-scalp-surfaces)

>[!warning] 
>MNE 认为 MRI 图像和电极位置之间是刚体变换，因此 scaling 的结果不会储存到 -trans.fif 文件中

[Scaling identified in the coregistration does not become part of the transformation matrix · Issue #10410 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/issues/10410)

## Step 2: 准备 head model 和 source model

```python
# Prepare head model
# conductivity = (0.3,)  # for single layer
conductivity = (0.3, 0.006, 0.3)  # for three layers

# ico=4 is enough
model = mne.make_bem_model(
    subject=subject, ico=4, conductivity=conductivity, subjects_dir=subjects_dir
)

bem = mne.make_bem_solution(model)

# save bem model
mne.write_bem_solution('bem_sol_MNI152.h5', bem)

# Now bem and trans are ready, we can prepare source model
# use surface to constrain the boundary
surface = './mni152ext/bem/inner_skull.surf'

vol_src = mne.setup_volume_source_space(
    subject = subject,
    subjects_dir = subjects_dir,
    surface = surface
)

# save source model
vol_src.save('vol_src_MNI152_default-src.fif.gz', overwrite=True)   

plot_bem_kwargs = dict(
    subject=subject,
    subjects_dir=subjects_dir,
    brain_surfaces="white",
    orientation="coronal"
)

# plot source model
mne.viz.plot_bem(src=vol_src, **plot_bem_kwargs)

# check sources in 3d view
fig = mne.viz.plot_alignment(
    subject=subject,
    subjects_dir=subjects_dir,
    surfaces="white",
    coord_frame="mri",
    src=vol_src,
)

mne.viz.set_3d_view(
    fig,
    azimuth=173.78,
    elevation=101.75,
    distance=0.30,
    focalpoint=(-0.03, -0.01, 0.03),
)


```

## Step 3: 准备正向模型
```python
fwd = mne.make_forward_solution(
    epoch.info,
    trans='./MNI152_standard1020-trans.fif',
    src=vol_src,
    bem=bem,
    eeg=True,
    mindist=5.0,
    n_jobs=None,
    verbose=True,
)

# save
mne.write_forward_solution('standard_1020-fwd.fif.gz', fwd, overwrite=True)
```

## Step 4: 求解逆问题
```python
# compute noise covariance
noise_cov = mne.compute_covariance(
    epoch, tmax=0.5, method=["shrunk", "empirical"], rank=None, verbose=True
)

fig_cov, fig_spectra = mne.viz.plot_cov(noise_cov, epoch.info)

# average epochs to evoked
evoked = epoch.average()

# mandatory to set average reference with projection
evoked.set_eeg_reference(projection=True)

# make inverse operator
# for volume source estimate, set loose as 'auto'
inverse_operator = mne.minimum_norm.make_inverse_operator(
    evoked.info, fwd, noise_cov, loose='auto', depth=0.8
)

# apply inverse estimate
method = "dSPM"
snr = 3.0
lambda2 = 1.0 / snr**2
stc, residual = mne.minimum_norm.apply_inverse(
    evoked,
    inverse_operator,
    lambda2,
    method=method,
    pick_ori=None,
    return_residual=True,
    verbose=True,
)

# convert and save as volume
stc_img = stc.as_volume(vol_src)

stc_img.to_filename('./stc_img.nii.gz')
```
## Step 5: 用 Atlas 提值

```python
# import nilearn
from nilearn.maskers import NiftiLabelsMasker

# create NiftiLabelsMasker
masker = NiftiLabelsMasker(labels_img='./aal2mni152.nii', strategy = 'mean')

# extract time series (scans, number of labels)
masker.fit_transform(stc_img)
```

# 方案 2：使用 fsaverage 头模溯源后配准结果到 MNI152

[EEG forward operator with a template MRI — MNE 1.6.1 documentation](https://mne.tools/stable/auto_tutorials/forward/35_eeg_no_mri.html)

# 关于溯源后使用 volume 模板

## 只支持 freesurfer mgz 格式：
[[Feature Request] Volume labels using AAL atlas · Issue #6278 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/issues/6278)

[ENH: Volume labeling · Issue #6155 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/issues/6155)

[MRG, ENH: Add volumetric atlas support by larsoner · Pull Request #7639 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/pull/7639)

- [mne.VolSourceEstimate  extract_label_time_course](https://mne.tools/stable/generated/mne.VolSourceEstimate.html#mne.VolSourceEstimate.extract_label_time_course)
- [mne.VolSourceEstimate in_label](https://mne.tools/stable/generated/mne.VolSourceEstimate.html#mne.VolSourceEstimate.in_label)

MNE 内置的 API 只鼓励用户输入 freesurfer 兼容的 mgz 格式，想要将 AAL 等 MNI152 template 上的图谱转换为 mgz 并应用比较麻烦，且需要对标签等进行编辑。
## 简单方法：输出为 volume 后使用 nilearn 处理

[extract time series on volume source estimates · Issue #7003 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/issues/7003)


fieldtrip

[How can I map source locations onto an anatomical label in an atlas? - FieldTrip toolbox](https://www.fieldtriptoolbox.org/faq/how_can_i_map_source_locations_between_two_different_representations/)