#影像 #DWI

![](http://www.mrihome.com/data/attachment/forum/201904/14/004736ilaau449aijaaqqm.jpg)

  

不同模型扩散成像图解

  

**相关名称及解释：**

  

非高斯分布：组织中水分子的扩散由于受细胞器、细胞膜和细胞外间隙等因素限制，其扩散位移及分布在各个方向不同将呈各向异性扩散。

  

DWI 是目前唯一能够无创性对活体组织内水分子扩散运动进行微观结构检测的功能性成像技术。常规的 DWI 及 DTI 是假设水分子在随机运动情况下满足高斯分布的理想状态。但对于真实生物体细胞微环境复杂其运动并不是高斯分布，随着 B 值的升高，非高斯扩散越明显。

  

根据人体组织中水分子扩散速率的不同，将水分子的扩散运动分为两部分，扩散相对较慢部分—水分子真实扩散和扩散相对较快部分—毛细血管网血液微循环或灌注为了区分组织内不同扩散速率的两部分扩散运动，Le Bihan 等提出了体素内不相干运动（IVIM）理论。由于体素内多个质子池的扩散速率具有连续分布的可能性，而且基于扩散发生在一个或两个特定质子池中的假设缺乏确切理论依据，因此，IVIM 模型设计上也有一定局限性。Bennett 等假设每个体素包含连续分布的扩散速率，提出了拉伸指数模型。上述这两种模型可以区分体素内速率不同的水分子产生的信号，能够更真实地反映正常与病变组织的生理特点

  

扩散张量成像（DTI）基于高斯模型在单指数扩散成像的基础上，利用各向异性扩散张量重建组织微观结构。但人体各种组织都具有复杂多样的系统特性，仅用简单的各向同性或各向异性难以表示人体复杂的系统特性，高斯模型的单指数扩散张量模型难以获得精准的组织结构特性，为了更准确地揭示组织的微观结构特性和水分子分布和运动特点更接近组织真实情况，目前研究微观结构的扩散模型也在向高阶复杂化方向发展，包括扩散峰度成像（DKI，方向至少 15 个，B 值至少 3 个）、神经突离散度和密度成像（NODDI）等。

  

以往对纤维束的显示主要运用 DTI 技术，然而该技术不能显示交叉、分叉的纤维与肿瘤周围水肿区域的纤维。纤维走向型扩散成像模型主要包括利用更大的 b 值和更多的扩散梯度方向（典型的是 64 个方向）进行采样的高角度分辨率扩散成像（HARDI）和基于概率密度函数的多 B 值、多方向 Q 采样成像的扩散频谱成像（DSI），该类成像模型克服了 DTI 的局限性，能够显示纤维束交叉、分叉等更复杂的结构，获取更加真实、丰富的纤维束走向和连接信息。

  

DWI (Diffusion Weighted Imaging): 扩散加权成像

  

D（Diffusion）: 扩散运动扩散系数

  

ADC（Apparent Diffusion Coefficient）: 表观扩散系数

  

eADC:（Exponential Apparent Diffusion Coefficient）: 指数化表观扩散系数

  

IVIM(Intro-Voxel Incoherent Movement): 体素内不相干运动

  

f: 体内毛细血管容积占整个容积的比值

  

Dslow（同 D）: 真实组织中水分子的扩散运动

  

Dfast：（同 D*）: 毛细血管网的微循环灌注信息

  

DTI（Diffusion Tensor Imaging）: 扩散张量成像

  

FA（Fractional Anisotraphy）: 部分各向异性

  

RA（Relative Anisotraphy）: 相对各向异性

  

MD（Mean Diffusivity，同 ADC 值）: 平均弥散率

  

AD（Axial Diffusion）: 轴向扩散张量

  

RD（Radical Diffusion）: 径向扩散张量

  

DSI（Diffusion Spectrum Imaging）: 弥散频谱成像

  

HARDI(High Angular Diffusion Magnetic Imaging): 高角分辨率弥散加权成像

  

DKI（Diffusion Kurtosis Imaging）: 扩散峰度成像

  

FAK（Fractional Anisotropy Of Kurtosis）: 同 FA 类似

  

MK（Mean Kurtosis）: 平均峰度系数，所有方向上 K 值的平均值

  

AK（Axial Kurtosis）: 轴向峰度系数

  

RK（Radial Kurtosis）: 径向峰度系数

  

SEM（Stretched Exponential Mode）: 拉伸指数模型

  

High Order-Tensor Mode: 高阶张量模型

  

DDC（Distributed Diffusion Coefficient）: 扩散分布系数

  

AQP（Aquaporin）: 水通道蛋白

  

FQC（Fractional Order Calculus）: 分数阶微分模型

  

CS(Compressed Sensing Or Compressed Sampling): 压缩感知

  

NODDI（neurite orientation dispersion and density imaging）: 神经突离散度和密度成像

  

**参考文献：**

  

索学玲, 龚启勇. DWI 技术在中枢神经系统中的应用及研究进展[J]. 放射学实践, 2018.

  

邢春华, 陈宏伟, 崔兴宇. 腹部 IVIM-DWI 应用研究及进展[J]. 国际医学放射学杂志, 2015(4):335-338.

  

王玉亮, 初建平. 磁共振扩散峰度成像 (DKI) 临床研究进展[J]. 影像诊断与介入放射学, 2015, 24(4):340-345.

  

赵智勇, 刘小征, 范明霞, et al. 弥散频谱成像的研究进展[J]. 磁共振成像, 2016, 7(7).

  

张艳, 宋志坚. 脑白质纤维束跟踪算法的研究进展[J]. 复旦学报：医学版, 2014, 41(1):1-7.

  

周杰, 曾艺君, 王甄, et al. 双指数扩散及扩散峰度成像鉴别诊断乳腺良恶性病变[J]. 中国医学影像技术, 2018, 34(10):79-83.

  

付修威, 陈元园, 倪红艳. 基于不同模型的多种新型 MR 扩散成像的原理与临床应用[J]. 中华放射学杂志, 2017(11).

  

周洋, 徐鹏举. 扩散峰度成像 (DKI) 在体部应用的研究进展[J]. 复旦学报 (医学版), 2018(6).

  

版权所有，如需转载，请联系作者！

  

![](http://www.mrihome.com/data/attachment/forum/201904/14/005020tbmcmgb2gmbvb0gs.png)  
[http://www.mrihome.com/forum.php?mod=viewthread&tid=4558](http://www.mrihome.com/forum.php?mod=viewthread&tid=4558)