#影像 #数据处理 #预处理 #ANTS #linux

```bash
# ANTs binary Installation

# decompress --------------------------------

tar -C /opt -zxvf ANTs.tar.gz
tar -C /opt -zxvf antsbin.tar.gz

# Bash configuaration ------------------------

nano ~/.bashrc
export ANTSPATH=/opt/antsbin/bin
export PATH=$PATH:$ANTSPATH
export PATH=$PATH:/opt/ANTs/Scripts

source ~/.bashrc

# Subject T1  ->   MNI T1  Example -------------------
antsRegistrationSyN.sh -d 3 -f MNI152_T1_1mm.nii.gz -m t1.nii.gz -o a2t_


# Two Step Normalization  Example ---------------------
antsRegistrationSyN.sh -d 3 -f ct1.nii -m meanafunc.nii -t 'r' -o f2a_  
#变形关系1 线性变换将平均功能像配准到结构像 -f代表fixed 固定 -m代表需要变换的图像  -t ‘r’代表刚体变换（如果不写默认的就是线性+非线性） -d 3 图像维度 3d
#这一步比较快，几分钟

antsRegistrationSyN.sh -d 3 -f MNI152_T1_1mm.nii.gz -m ct1.nii -o a2t_
#变形关系2和3 线性变换+非线性变换 将个体结构像配准到标准T1像   

antsApplyTransforms -d 3 -i rafunc.nii -o wra.nii.gz -r EPI_3mm.nii -t a2t_1Warp.nii.gz -t a2t_0GenericAffine.mat -t f2a_0GenericAffine.mat -e 3 
#应用变形关系
#                        -i input 输入数据 头动校正后的功能像 -o 输出                    变形关系必须倒着写 从变形关系3 2 1   -e 3代表对4d图像做变换


# If necessary, bet T1  ----------------------
# FSL bet

# Atlas  ->   Subject T1  Example -------------------
antsRegistrationSyN.sh -d 3 -o t2a_ -f ct1.nii -m MNI152_T1_1mm.nii.gz
#将标准脑配准到个体空间T1脑

antsApplyTransforms -d 3 -i Atlas.nii.gz -r ct1.nii -n GenericLabel[Linear] -t t2a_1Warp.nii.gz -t t2a_0GenericAffine.mat -o Native_atlas.nii.gz
#将标准脑到个体T1的变换关系，应用到Atlas上，注意 -n 参数指定不要对Atlas插值，以防止原有标签被破坏
```