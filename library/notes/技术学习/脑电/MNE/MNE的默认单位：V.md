---
date created: Saturday, December 2nd 2023, 10:41:17 pm
date modified: Saturday, December 2nd 2023, 11:54:08 pm
---
[Got some problem in raw.plot function · Issue #8694 · mne-tools/mne-python · GitHub](https://github.com/mne-tools/mne-python/issues/8694)

![image.png](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202312022243611.png)

如果数据的 plot 看上去很奇怪，很可能是读取数据时数据的单位并没有被正常解析，依然以微幅 uV 数值读取进来。此时应该将数据乘以 `1e-6`，以获得正确的单位。


注：eeglab 的默认单位是 uV