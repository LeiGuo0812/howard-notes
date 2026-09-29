---
date created: Friday, December 29th 2023, 1:04:29 am
date modified: Friday, December 29th 2023, 1:09:40 am
---
#Python #EEG #预处理

[基于python的EEG预处理 (in progress) #Python #EEG · GitHub](https://gist.github.com/LeiGuo0812/56e37abd8b287cb2b872e801255ed942)

# 关于 Cleanline 方法
MNE 的 notch_filter 方法中自带该方法，但参数是隐藏的 `spectrum_fit` 

[mne-python/mne/io/base.py at maint/1.6 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/blob/maint/1.6/mne/io/base.py#L1146-L1256)


# 关于 ASR 方法
- 相关讨论：

[EEG noise reduction with ASR · Issue #7479 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/issues/7479)

[Artifact Subspace Reconstruction by DiGyt · Pull Request #9302 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/pull/9302)

- 可用工具：

[GitHub - nbara/python-meegkit: 🔧🧠 MEEGkit: MEG & EEG processing toolkit in Python](https://github.com/nbara/python-meegkit)

[GitHub - DiGyt/asrpy: Artifact Subspace Reconstruction for Python](https://github.com/DiGyt/asrpy)