# 读取和修改snirf文件

[Standalone SNIRF loading and saving · BUNPC/Homer3 Wiki](https://github.com/BUNPC/Homer3/wiki/Standalone-SNIRF-loading-and-saving)

  

# 不同水平的预处理运行问题

[Group, Subject, Run Levels Processing stream](https://openfnirs.org/community/homer3-forum/group-subject-run-levels-processing-stream/)

  

-   每个水平都有各自的公式流
-   运行更高级的水平会将低级水平的流程也运行一遍（Group水平即可将所有run运行）

  

# 头动校正算法选择

[Correction Motion Artifacts - Day4 of 2020 course](https://openfnirs.org/community/homer3-forum/correction-motion-artifacts-day4-of-2020-course/)

  

-   尝试多种看效果，但只使用一种

# 处理后结果的导出

1.  **血红蛋白浓度数据：**

-   存放在homerOutput文件夹下的每个subject文件夹（如果没有subject，则在homerOutput文件夹）的 `.mat`文件
-   load `.mat` 文件后，获得 `output` 变量

-   OD值在 `output.dod.dataTimeSeries` 内，time _(HbO/HbR/HbT_ 通道数)，注意，每个通道的HbO，HbR，HbT是连在一起，所以第i个通道的HbO在 `(i - 1) * 3 + 1` 列，HbR在 `(i - 1) * 3 + 2` 列，HbT在 `(i -1) * 3 + 3` 列
-   血红蛋白浓度在 `output.dc.dataTimeSeries` 内，time _(波长1_ 通道数 + 波长2 * 通道数)，每个波长的通道是放在一起的，如果有n个通道， 则前n列是波长1， 然后n列是波长2，以此类推

  

1.  **手动剔除坏通道数据：**

-   保存在homerOutput文件夹下的 `groupResults.mat` 内
-   load `groupResults.mat`  后，获得 `group` 变量

-   每个被试各自的信息在 `subjs` 域内，每个subject都有各自的 `run`，点进 `runs` ，进入 `procStream` ，有 `input` 的信息，其中 `mlActMan` 即所有channel的剔除与否情况，其中是一个 （通道数 * 2）的cell，取前n个即可（后n个为另一个波长，重复的）
-   `group.subjs(1, 1).runs(1, 1).procStream.input.mlActMan{1, 1}`
-   `group.subjs(1, 1).runs(1, 2).procStream.input.mlActMan{1, 1}`