#影像

[Acquiring and using field maps — LCNI](https://lcni.uoregon.edu/kb-articles/kb-0003)

[OSF | fMRI Wiki](https://osf.io/k6rm5/wiki/1.1_Field_map_correction/)

[Chris Rordens Neuropsychology Lab :: Fieldmaps](https://crnl.readthedocs.io/fieldmaps/index.html)

[FieldMap Toolbox](https://www.fil.ion.ucl.ac.uk/spm/toolbox/fieldmap/)

BIDS 格式中对 fmap 的规定：[Magnetic Resonance Imaging - Brain Imaging Data Structure](https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#fieldmap-data)

EPI 图像通常在磁场不均匀的区域（如大脑的额叶皮层和内侧颞叶）表现出大量信号丢失和空间失真。我们无法恢复丢失的信号，但如果我们收集场图（测量场不均匀性），我们可以尝试消除图像失真（则仅位移的信号可以返回到其在图像中的正确位置）。

场图有两种获取方式：
1. **old fieldmap**: 采集两种不同的回波时间 (TE) 图 （2 magnitude images, one for each echo） + 相位差图像 (phase difference image, the difference of two phase images from each echo)
2. **new fieldmap**: 反相位编码场图, 采集两个相位编码方向不同的图像 (two magnitude images, with opposite phase encoding directions)

