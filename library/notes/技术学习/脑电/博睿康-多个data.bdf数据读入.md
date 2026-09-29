---
date created: Wednesday, November 13th 2024, 8:52:31 pm
date modified: Wednesday, November 13th 2024, 9:42:33 pm
---
博睿康 W 3 脑电在数据录制的过程中，如果进行了阻抗检测，会导致 `data.bdf` 被分割，多出一个 `data.1.bdf`，此时，可以用博睿康 `readmultibdfdata` 包来解决。

使用 GUI 选择：

```matlab
clear all; clc;close all
[filename, pathname] = uigetfile({'*.bdf;*.edf;*.json';'*.*'}, 'Pick a recorded EEG data file','MultiSelect', 'on');
EEG1 = readmultibdfdata(filename, pathname);
```

使用代码读取：

```matlab
path_struct = {dir(data_path).name};

filename = path_struct(3:end);

EEG = readmultibdfdata(filename, data_path);

% convert to fieldtrip data structure if needed (need eeglab)
data = eeglab2fieldtrip(EEG, 'raw');
```

- **该工具也适用于数据没有被分割的情况，因此可以通用**