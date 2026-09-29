---
date created: Tuesday, November 28th 2023, 9:57:43 am
date modified: Saturday, December 2nd 2023, 11:39:28 pm
---
#数据处理 #预处理 #EEG

[EEG\_preproc EEG预处理代码，由丁悦老师提供 · GitHub](https://gist.github.com/LeiGuo0812/cc2f039b93099aaf34da57cc777fb9e2#file-preproc_eeglab_new-m)

- 关于坏道检测：使用了 RANSAC 算法（参考文档： `clean_channels`）
# 关于脚本中的几个问题（GPT）

## eegfilt 和 eegfiltnew 的区别

EEGLAB 中的 `eegfilt` 和 `eegfiltnew` 是两个用于滤波的函数，它们在处理脑电图（EEG）数据时被广泛使用。这两个函数虽有共同的目的，但在实现细节和性能上存在一些关键差异：

1. **实现方式**：
    
    - `eegfilt`: 这是一个较早的滤波函数，它使用传统的FIR或IIR滤波器设计方法。这种方法在某些情况下可能导致信号的相位失真和滤波延迟。
    - `eegfiltnew`: 这是一个更新的滤波函数，采用了改进的滤波器设计，目的是减少相位失真和提高计算效率。`eegfiltnew`通常使用零相位滤波技术（即前向-后向滤波），这有助于保持信号的相位信息。
2. **性能和效率**：
    
    - `eegfilt`: 在大数据集或高采样率的情况下，`eegfilt`可能表现出较低的计算效率和较长的处理时间。
    - `eegfiltnew`: 由于采用了更高效的算法，`eegfiltnew`在处理大规模数据时通常更加高效，处理速度更快。
3. **相位失真**：
    
    - `eegfilt`: 由于其使用的传统滤波器设计，可能会在一定程度上引起相位失真，尤其是在边缘频率附近。
    - `eegfiltnew`: 设计用于尽可能减少相位失真，特别是在使用零相位滤波技术时。
4. **适用性**：
    
    - `eegfilt`: 对于一些特定的分析和较小的数据集，可能仍然是一个可行的选择。
    - `eegfiltnew`: 对于需要高效处理和减少相位失真的应用，尤其是在处理大规模数据集

## binica 和 runica 算法的区别
在 EEGLAB 中，`binica` 和 `runica` 是两种独立分量分析（ICA）算法的实现。ICA 是一种常用于脑电图（EEG）数据分析的技术，用于分离混合信号中的独立源。`binica` 和 `runica` 虽然都是实现 ICA 的方法，但它们在一些关键方面有所不同：

1. **实现和算法基础**：
    
    - `runica`：由Scott Makeig和他的团队开发，是EEGLAB中默认的ICA算法。它是基于Infomax算法的一种实现，该算法通过最大化输出的信息量来找到独立成分。
    - `binica`：是`runica`的一个二进制版本，通常被认为在某些系统配置上运行得更快。它实际上是`runica`的一个编译版本，因此在功能上与`runica`相同，但是以二进制形式执行。
2. **性能和效率**：
    
    - `runica`：作为一个MATLAB脚本运行，它的性能和效率受限于MATLAB的运行环境。
    - `binica`：作为编译好的二进制文件运行，通常在执行速度上更快，尤其是在处理大型数据集时。
3. **系统兼容性**：
    
    - `runica`：由于它是MATLAB代码，可以在任何安装了MATLAB的系统上运行。
    - `binica`：需要在安装了相应编译器的系统上运行。这意味着在某些操作系统上可能需要额外的配置或安装步骤。
4. **用户友好性**：
    
    - `runica`：由于它是纯MATLAB实现，对于MATLAB用户来说可能更易于理解和修改。
    - `binica`：作为二进制文件，对于想要理解或修改算法底层的用户来说不太透明。

总的来说，`runica` 和 `binica` 在功能上是相同的，它们的主要区别在于实现方式和运行效率。`binica` 可能在某些情况下提供更快的处理速度，但它可能需要额外的配置步骤，并且在可访问性和透明度方面不如 `runica`。用户可以根据自己的需求和系统配置选择使用哪种版本。

## 关于滤波范围
ICAlabel 训练集使用了 1-100 的滤波，建议使用相同的滤波参数对数据预处理，否则可能带来负面影响（icalabel 原文未讨论）

[Repairing artifacts with ICA automatically using ICLabel Model — MNE-ICALabel](https://mne.tools/mne-icalabel/stable/generated/examples/00_iclabel.html#repairing-artifacts-with-ica-automatically-using-iclabel-model)
## 关于多次平均参考

![image.png|325](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202311281017167.png)
