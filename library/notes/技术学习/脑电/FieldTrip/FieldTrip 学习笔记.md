#EEG #fieldtrip #数据处理 
# 总体介绍
- 快速入门 [Quick intro to FieldTrip]( https://laumollerandersen.org/onewebmedia/workshops/2018_05/Very-Quick%20intro%20to%20FieldTrip.pdf )

- 可通过 Githup 下载 [GitHub - fieldtrip/fieldtrip: The MATLAB toolbox for MEG, EEG and iEEG analysis](https://github.com/fieldtrip/fieldtrip)

- 启用 FieldTrip
```matlab
addpath ‘~/mypath/fieldtrip’
ft_defaults
cd ‘/my_working_directory’
```

与 SPM 冲突，使用前删除路径

- FieldTrip 函数
	- FieldTrip 函数的参数通过 cfg 结构体来提供
![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/20230313231457.png)

- FieldTrip 数据结构
![image.png|500](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/20230313231542.png)


# 读取数据

[Preprocessing - Reading continuous EEG and MEG data - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/continuous/)
[Preprocessing - Segmenting and reading trial-based EEG and MEG data - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/preprocessing/)

使用 `data = ft_preprocessing(cfg)` 来读取和预处理数据（读取和预处理同时进行，包括分段）

```matlab
cfg = [];
cfg.dataset = 'subj2.vhdr';
data_eeg    = ft_preprocessing(cfg)
```


# 数据预处理
FieldTrip 认为预处理有两种方式，一种是将所有数据直接读进内存，然后进行滤波等处理，最后分段。另一种是先将数据分段，然后只对这些分段做滤波处理。
将全部数据读取进来进行分析的好处是，可以避免在过短的分段上滤波导致的边缘效应，也可以探测到连续数据才能揭示的伪影。

预处理包括的几个主要步骤：
- 分段
- 滤波/陷波
- 去坏段
- 去坏导
- 电极定位
- 插值坏导
- 重参考
- ICA

## 分段

在 FieldTrip 中，通过设置

```matlab
cfg = [];
cfg.dataset = 'Subject01.ds';
cfg.trialfun = 'ft_trialfun_general';
cfg.trialdef.prestim = 0.2; % (in second)
cfg.trialdef.poststim = 1; % (in second)

cft = ft_definetrial(cfg);
```


来进行分段，其中有默认的 `cft.trialfun` 也可以自己定义 [Preprocessing of EEG data and computing ERPs - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/preprocessing_erp/#appendix-the-trialfun-used-in-this-example)

使用 `cft = ft_definetrial(cfg);` 将上述参数放入（主要是数据参数和 trialfun，其他可以灵活使用），获得 `cfg.trl`, 其中定义了所需的 trigger （如果有多个水平，此时可以先放到一起，后续再分开）, 用于 `ft_preprocessing` 时进行分段。 

可以设置 `cfg.demean = 'yes'` 和 `cfg.baselinewindow = [-0.2 0]` 来进行分段后的基线校正 [Preprocessing of EEG data and computing ERPs - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/preprocessing_erp/#pre-processing-and-re-referencing)

## 滤波

```matlab
% 低通滤波
cfg.lpfilter = 'yes';
cfg.lpfreq = 120;
cfg.lpfiltord = 15000;

% 高通滤波
cfg.hpfilter = 'yes';
cfg.hpfreq = 0.5;
cfg.hpfiltord = 15000;

% 带通滤波
cfg.bpfilter = 'yes';
cfg.bpfreq = [0.5 120];
cfg.bpfiltord = 15000;

% 陷波
cfg.bsfilter = 'yes';
cfg.bsfreq = [49 51];
cfg.bsfiltord = 15000;
```

## 去坏段

[Visual artifact rejection - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/visual_artifact_rejection/)
[Automatic artifact rejection - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/automatic_artifact_rejection/)

## 电极定位，插值坏导

[Time-frequency analysis of combined MEG/EEG data - FieldTrip toolbox](https://www.fieldtriptoolbox.org/workshop/natmeg/timefrequency/#clean-data-1)


## 重参考

[Preprocessing of EEG data and computing ERPs - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/preprocessing_erp/#pre-processing-and-re-referencing)

```matlab
cfg.reref = 'yes';

% set to average reference (note if there are non-EEG channels, use custom expression)
cfg.refchannel = 'all';

% add original refchannel back as zero channel 
cfg.implicitref;
```

## ICA

[Cleaning artifacts using ICA - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/ica_artifact_cleaning/)

# ERP 和 TFA

## ERP

[Preprocessing of EEG data and computing ERPs - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/preprocessing_erp/)

### 计算 ERP

使用 `cfg.trials` 参数和 `ft_timelockanalysis` 来计算每个条件下的 ERP

```matlab
% use ft_timelockanalysis to compute the ERPs
cfg = [];
cfg.trials = find(data_clean.trialinfo==1);
task1 = ft_timelockanalysis(cfg, data_clean);

cfg = [];
cfg.trials = find(data_clean.trialinfo==2);
task2 = ft_timelockanalysis(cfg, data_clean);

cfg = [];
cfg.layout = 'mpi_customized_acticap64.mat';
cfg.interactive = 'yes';
cfg.showoutline = 'yes';
ft_multiplotER(cfg, task1, task2)
```

### 计算差异波

使用 `ft_math` 计算差异波

```matlab
cfg = [];
cfg.operation = 'subtract';
cfg.parameter = 'avg';
difference = ft_math(cfg, task1, task2);

% note that the following appears to do the sam
% difference     = task1;                   % copy one of the structures
% difference.avg = task1.avg - task2.avg;   % compute the difference ERP
% however that will not keep provenance information, whereas ft_math will

cfg = [];
cfg.layout      = 'mpi_customized_acticap64.mat';
cfg.interactive = 'yes';
cfg.showoutline = 'yes';
ft_multiplotER(cfg, difference);
```

## TFA

[Time-frequency analysis using Hanning window, multitapers and wavelets - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/timefrequencyanalysis/)

基于小波的 TFA

```matlab
cfg = [];
cfg.channel    = 'MEG';
cfg.method     = 'wavelet';
cfg.width      = 7;
cfg.output     = 'pow';
cfg.foi        = 1:2:30;
cfg.toi        = -0.5:0.05:1.5;
TFRwave = ft_freqanalysis(cfg, dataFIC);

% Plot the result
cfg = [];
cfg.baseline     = [-0.5 -0.1];
cfg.baselinetype = 'absolute';
cfg.zlim         = [-2e-25 2e-25];
cfg.showlabels   = 'yes';
cfg.layout       = 'CTF151_helmet.mat';
cfg.colorbar     = 'yes';
figure
ft_multiplotTFR(cfg, TFRwave)
```

# 统计分析

## TFA

统计分析前对 TFA 结构体的处理

```matlab
load('../results/cue/G005ZLS_Cuereac_TFR.mat');

% baseline correction
cfg = [];
cfg.baseline = [-0.2 0];
cfg.baselinetyep = 'relative';
TFR_base = ft_freqbaseline(cfg, TFR);

% select drug trials
cfg = [];
cfg.trials = find(TFR.trialinfo == 1);
TFR_drug = ft_selectdata(cfg, TFR_base);
% average drug trials
cfg = [];
cfg.keeptrials = 'no';
drug_avg = ft_freqdescriptives(cfg, TFR_base);

% select neutral trials
cfg = [];
cfg.trials = find(TFR.trialinfo == 2);
TFR_neutral = ft_selectdata(cfg, TFR_base);
% average drug trials
cfg = [];
cfg.keeptrials = 'no';
neutral_avg = ft_freqdescriptives(cfg, TFR_neutral);
```

### 统计分析之前数据的组织形式

[Parametric and non-parametric statistics on event-related fields - FieldTrip toolbox](https://www.fieldtriptoolbox.org/tutorial/eventrelatedstatistics/#reading-in-preprocessed-and-time-locked-data-in-planar-gradient-format-and-grand-averaged-data)
官方建议，将每个被试的结构体组装成 cell-array of structures，而不是 struct-array.

### 基于置换检验的各种统计方法的实现

[Cluster-based permutation tests on resting-state EEG power spectra - FieldTrip toolbox](https://www.fieldtriptoolbox.org/workshop/madrid2019/tutorial_stats/)

关于使用 permutation 方法进行复杂交互作用的讨论：

[\[FieldTrip\] 2x3 anova in cluster analysis](https://mailman.science.ru.nl/pipermail/fieldtrip/2011-December/017428.html)