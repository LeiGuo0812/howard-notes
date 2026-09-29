#数据处理 #影像 #DWI 

[https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/TBSS/UserGuide](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/TBSS/UserGuide)

# 数据要求

-   预处理获得的所有被试的FA图像
-   需要进行TBSS分析的其他标量图像

  

[http://www.diffusion-imaging.com/2013/01/relation-between-neural-microstructure.html](http://www.diffusion-imaging.com/2013/01/relation-between-neural-microstructure.html)

# TBSS预处理

## 创建文件夹

```bash
mkdir my
```


将所有FA图像拷贝到TBSS文件夹下，并**重命名为不同的名字**（建议使用被试编号）

```bash
cd mytbss
ls
  CON_N00300_dti_data_FA.nii.gz
  CON_N00302_dti_data_FA.nii.gz
  CON_N00499_dti_data_FA.nii.gz
  PAT_N00373_dti_data_FA.nii.gz
  PAT_N00422_dti_data_FA.nii.gz
  PAT_N03600_dti_data_FA.nii.gz

```

## tbss_1_preproc

```bash
tbss_1_preproc *.nii.gz
```

该命令进行了如下操作

-   将末端slice清零，防止离群值
-   将处理后的FA移动到FA文件夹下
-   将原始FA图像移动到origdata下
-   运行`slicesdir`，便于数据质控

如果图像有缺失，可能是`bet2`力度过大，可以调整阈值

## tbss_2_reg

tbss_2_reg –T/-t/-n

该步骤主要是利用线性和非线性配准将个体FA配准到 111 mm 标准空间  
-T: 配准到 FMRIB58_FA 的FA 模板上 （成人研究建议选这种）  
-t : 配准到自己指定提供的模板上  
-n: 所有的数据相互配准， 找到最具有代表性的图像作为模板， 将所有的图像配到这个具有代表性的图像上， 然后再配准到标准空间（耗时），当使用儿童等特殊人群时，可选择该选项

## tbss_3_postreg

```bash
tbss_3_postreg -S
```

-S: 基于自己的数据构建骨架（推荐）  
-T: 基于标准的FA模板构建骨架  
该步骤

-   将估计得到的变换应用到FA图像上，完成标准化
-   创建名为stats的新目录
-   将投射到标准空间的FA合并到一个名为all_FA的单个 4D 图像文件中，放入stats文件夹
-   创建所有 FA 图像的平均值，称为mean_FA，使用其创建mean_FA_skeleton

## tbss_4_prestats

```bash
tbss_4_prestats 0.2
```

该步骤

-   对生成的mean_FA_skeleton卡阈值，生成mask，用于限定后续分析范围，一般使用0.2效果较好
-   从mask中生成“distance map”，用于后续FA值到skeleton的投射
-   将all_FA图像中的FA值投射到mean_FA_skeleton，用于后续统计分析

## 运行非FA的tbss

建议使用 FA 图像来实现非线性配准和骨架化阶段，并估计从每个个体受试者到平均 FA 骨架的投影向量。然后，非线性扭曲和骨架投影也可以应用于其他图像，例如第二个指标MD

对您的 FA 数据运行完整的 TBSS 分析（请参阅上述所有步骤）。

-   在TBSS 分析目录（包含来自 FA 分析的现有 origdata、FA 和 stats 目录的目录）中创建一个名为MD（或任何其他名称）的新目录。类型：mkdir MD

-   将MD 图像复制到这个新目录中，确保它们的名称与原始 FA 图像的名称**完全相同**（查看 origdata 以检查原始名称 - 并保持它们完全相同，即使它们包含 FA，也可以令人困惑；例如，如果有一个图像 origdata/subj005_FA.nii.gz 那么你需要一个图像 L2/subj005_FA.nii.gz 并且这个文件应该包含MD 数据，即使它的名称中有 FA）。
-   回到 TBSS 目录（现在包含 FA、stats 和MD 子目录的目录）并运行`tbss_non_FA`脚本，告诉它备用数据称为MD。这会将原始非线性配准应用于 MD 数据，将所有受试者的扭曲 MD数据合并为 4D 文件stats/all_MD，将其投影到原始平均 FA 骨架上（使用原始 FA 数据找到投影向量），得到4D 投影数据stats/all_MD_skeletonised。
-   运行：`tbss_non_FA MD`

可以相同的方式对投影的 4D 数据all_MD_skeletonised运行体素统计。

# randomise统计

进入 stats 文件夹

randomise 需要的文件：

-   设计矩阵`design.mat`文件
-   对比矩阵`design.con`文件
-   F检验还需要`design.fts`文件

  

两样本T检验可以直接使用命令生成设计矩阵和对比矩阵：

design_ttest2 design N1 N2

N1和N2分别表示两组被试的数目。 命令运行后将得到`design.mat`和`design.con`等文件， 用于后续的统计分析。  

对于复杂设计的矩阵写法可以参考fslwiki的介绍

[https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/GLM](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/GLM)

可以自己编写好后，用命令从txt转成矩阵

[https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/GLM/CreatingDesignMatricesByHand](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/GLM/CreatingDesignMatricesByHand)

  

**进行randomise设计需要注意的点：**

-   分类变量有多少水平，就添加多少列
-   多因素设计，列数为所有水平的组合
-   协变量只占一列
-   连续变量、协变量要cross all subject demean
-   如果性别作为协变量，则编码0，1，同时demean
-   在设计contrast矩阵时，如果需要去除协变量，协变量对应列设置为0
-   F检验需要提供 `.fts`文件，其中，F检验中的每一个主效应都对应一个F检验，即一行，进行该F检验需要几个contrast（一般为水平数 -1），就需要几列

F-test files must have one row for each F-test, with one column for each contrast. For example, if we are interested in activation in any of the three groups from the contrasts above, we would structure our F-test file as follows:

`1 1 1`

-   TFCE校正：对于一般的4D图像统计，使用`-T`命令即可，但对于TBSS的统计，要用`--T2`(二维骨架上的统计)

  

**双样本T检验命令：**

```bash
randomise -i all_FA_skeletonised -o tbss -m mean_FA_skeleton_mask -ddesign.mat -t design.con -n 5000 --T2

```

**F检验命令：**

```bash
randomise -i <4D_input_data> -o <output_rootname> -d <design.mat> -t <design.con> -f <design.fts> -m <mask_image> -n 5000 --T2
```


可以添加`--uncorrp`输出未校正P值结果

对于三组比较，先使用`--T2`校正F检验，再将差异脑区保存为mask，然后重新设计矩阵，进行t检验两两比较，此时校正使用`-x`校正，p值阈值为校正后p值

# 统计结果提取

1.  cluster工具：将显著结果汇总成不同的clulster

[https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Cluster#reporting](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Cluster#reporting)

```bash
cluster -i tbss_tfce_corrp_tstat1.nii.gz -t 0.95 --scalarname='1-p' -o cluster
```


cluster文件是一个多值mask，每一个mask是一个cluster

  

可以使用`fslmaths`命令提取特定的 cluster mask

```bash
fslmaths cluster.nii.gz -thr n -uthr n cluster_n.nii.gz
```


提取cluster中的FA或其他指标

```bash
提取显著cluster中的FA均值（整个cluster的均值，但cluster是统计的结果，一定落在骨架上，故不用考虑非零值的问题）
fslmeants -i all_FA_skeletonised.nii.gz -m cluster_n.nii.gz

# 提取ROI中的非零FA均值（ROI可能比骨架大，所以可能包含了FA为0的区域，这时需要使用 -M 选项，获取非零FA的均值，而 -m 选项则将ROI内所有体素值平均）
fslstats -t all_FA_skeletonised.nii.gz -k mask.nii.gz -M
```

2.  atlasquery工具：输出显著区域所属白质纤维束的信息

[https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlasquery](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlasquery)

```bash
atlasquery -a "JHU White-Matter Tractography Atlas" -m cluster.nii.gz
atlasquery -a "JHU ICBM-DTI-81 White-Matter Labels" -m cluster.nii.gz
```


# 结果可视化

1.  使用`tbss_fill`方法膨胀结果，便于可视化

```bash
tbss_fill tbss_tfce_corrp_tstat1 0.95 mean_FA tbss_fill
```


2.  使用fsleye可视化

-   使用mean_FA作为底板
-   叠加mean_FA_skeleton，显示为绿色
-   叠加统计结果，显示为红色

  

![](https://cdn.nlark.com/yuque/0/2022/png/1210419/1661667347507-4b1fef08-c880-4b20-b38c-1a6484230f36.png)