#影像 #统计学 #SPM

记录被试间设计方差分析、被试内设计方差分析以及混合设计方差分析在SPM中的实现

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605534320228-abab4490-7fa3-47b4-9fae-f5b27fe462d0.png)

SPM构建设计矩阵的地方

# 1. 被试间设计方差分析：

-   进入Specify 2nd-level

![](https://cdn.nlark.com/yuque/0/2021/png/1210419/1625794425570-1a9df795-ea81-4644-ab30-2456ddec6b76.png)

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605539399075-bf1ce4f7-59a0-45a7-a9ac-5d6ded7b6131.png)

-   所有内容输入完毕后，先保存batch，再点击运行，生成设计矩阵：

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605535635922-224738da-193f-47c9-b0cf-5715a0a3c3ba.png)

-   点击Estimate，运行刚才生成的SPM.mat矩阵，生成结果
-   选择Results, 选择Estimate结束后的SPM.mat矩阵。对于Full factorial设计的矩阵，会自动生成所有可能的contrasts

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605536143259-bdcf450d-3d9a-4e13-8918-3c681aefe182.png)

-   点击对应的contrast，查看结果

# 被试内设计方差分析

## 方法1：使用 Flexible factorial 设计

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605578037219-32036d4c-1de8-44e3-a34a-3b2e78433f6f.png)

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605539202739-da481323-60b6-41c6-a177-84fe02d8fa0e.png)

## 方法2：使用 One-way ANOVA - within subject 设计

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605578152742-6b9cd541-7cf1-49d6-8b80-bd662f0a5bd3.png)

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605578174644-7748a570-50ba-477a-a1de-d3df61728aa0.png)

-   输入完毕，保存batch，点击run，得到设计矩阵

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605539635683-d65a0159-ad9b-4080-bd46-dd618b67513d.png)

-   点击Estimate，然后点击Results查看结果

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605539720710-457ceec6-8575-416f-a9f1-cb6a1f411261.png)

-   方差分析的结果，都是选择F-contrasts， Define new contrast
-   示例中有三次重复测量，故零假设为A=B=C，即A=B且B=C，而要进行备择假设的检验，就要将检验过程分解为2部分，即A和B的比较，以及B和C的比较（其中任意两对比较均可），因此，水平数为3 的重复测量因素的主效应应该写两行，水平数为N的因素，主效应要写N-1行（被试间因素同理）。

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605541863705-aadce943-d040-4c38-ab19-1313c1fa5962.png)

# 混合设计方差分析

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605578288819-3a884288-e5fb-40f5-bb98-caeb033e8688.png)

## 输入被试方法1：逐个输入

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605542982845-d6c5c0b3-6884-4c79-b899-b8f3af82a516.png)

## 输入被试方法2：一次性输入

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605630159804-4894b4e1-04c8-45df-8c6e-384fdc5d1a40.png)

-   Scans：一次性输入**所有被试的imge**
-   Factor matrix: 指定因子矩阵

-   **行**数与Scans中images的数目一致，**代表每一个image**
-   **第一列**是固定的内置重复数字（**全部填1**），**不可改动**，**其他列代表各实验因素**，值为该因素下的水平，顺序与Factor输入顺序一致。（**即第2列代表第一个因素[通常为subject]**，第3列代表第2个因素...）
-   **Flexible factorial 只能做两因素设计（代码已限制好），即4列内容是固定的**

-   如果是混合设计，第一列全部填1，第二列给subject因素，三四列留给两个因素
-   如果没有被试内因素，第一列填1，第二三列留给其他因素，最后一列填1

  

**例：**2组(group)被试，每组3人，前后测量（time），之前因子的输入顺序为 subject - group -time，scan中按照每组-每个被试-前后测的顺序输入image，则因子矩阵应该是 （12 * 4或5）：

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605631163954-130d6f1e-db9c-4f12-935b-a3a24a4b9ba8.png)

  

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605543302669-68b506e8-7085-454c-b203-038fb53003cb.png)

-   定义完成后，保存batch，运行

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605543440330-d4972d9f-8de9-44a7-a241-9d82210ec8b6.png)

-   进行Estimate，然后Results查看结果
-   所有contrast均为F检验，对于被试内因素的主效应，可以直接根据不同condition进行对比

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605543596258-c18623fe-9be5-4295-9d4e-d413f78a1c41.png)

-   对于被试间的主效应，则**较为特殊**

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605543728021-3e04d797-17d9-4411-969f-54df725a7ccb.png)

假设被试间因素有两个水平，前5个被试为水平1，后5个被试为水平2，则组别系数应该写（1 1 -1 -1）/2 **其中分母2为被试内因素水平数**，被试的系数也要定义，根据组别分配正负号，ones(1,5)/5 -1*ones(1, 5)/5,其中**分母为每组的人数**

-   对于交互作用，则是两个主效应对应位置相乘的结果，注意在该处被试间效应的对比矩阵写法和被试内效应的写法一致了。即被试内（1 -1 1 -1），被试间（1 1 -1 -1），两者相乘即交互作用（1 -1 -1 1）
-   如果交互作用的两个因素水平数大于2，思路也和上面一样，即主效应相乘，此时交互作用的行数等于两个主效应行数的乘积，对于这里的多行，没有顺序要求，软件可以自动识别

  

## 有协变量时的被试间因素主效应

**Flexible factorial 设计**，在写**被试间因素主效应**的对比矩阵时，**不能加协变量**，否则认为是无效contrast

解决办法是对于被试间因素主效应，**如果水平为2，做一次 two sample T-test**， **如果水平>2, 则做一次 oneway-ANOVA**， 每个cell中放入该组被试的所有数据，并加入协变量，这时得到的结果可以处理协变量，**相当于检验了被试间因素的主效应**

**注意！！！经过和老师讨论，这样另外做T-test或Anova是不正确的！！**

-   首先这不是同一个模型
-   单独检验被试间因素时，是把其他因素的所有水平都放进去检验，被试间因素某水平中包含了一个被试的多个被试内因素水平，这样会使得模型将同一个被试的不同被试内水平当成独立的多个被试看待，造成错误结果。

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605606144858-1d704283-fe6b-4647-8c9f-67c2328f7c19.png)

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605606175392-774b84e6-574b-4f81-b16e-eff7e0ecc6c7.png)

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605606197872-d1e1c42d-6441-431d-add5-642d1c9f0074.png)

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605606281463-c8a3f159-50b0-4217-af9f-98dc81d111b7.png)

  

可以使用MRtools包进行任意因素的复杂GLM设计

[📎MRtools_2018-03-17.zip](https://www.yuque.com/attachments/yuque/0/2020/zip/1210419/1605682389393-22158981-5b8e-4fab-92eb-a073c19eb6ed.zip)

-   网址：

-   [https://github.com/martynmcfarquhar/MRM](https://github.com/martynmcfarquhar/MRM)
-   [https://habs.mgh.harvard.edu/researchers/data-tools/](https://github.com/martynmcfarquhar/MRM)

-   文献：[https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4862963/](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4862963/)
-   手册：
[Manual.pdf](https://www.yuque.com/attachments/yuque/0/2022/pdf/1210419/1661746409551-53c9885d-042e-42b2-8dcd-b4396dfa90df.pdf)

# Post-hoc 分析

## 方法1 ROI提均值

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605606354570-3c2f2510-c0e3-4821-a65a-5f28b0cc6791.png)

## 方法2 ROI作mask

![](https://cdn.nlark.com/yuque/0/2020/png/1210419/1605606655555-5efcb7f1-3b19-4a86-8e68-bfa95ec69fc2.png)