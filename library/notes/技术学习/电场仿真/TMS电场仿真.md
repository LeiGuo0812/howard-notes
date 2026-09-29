#TMS #电场仿真

[Thielscher 等。 - 2015 - Field modeling for transcranial magnetic stimulati.pdf](https://www.yuque.com/attachments/yuque/0/2022/pdf/1210419/1660209608135-ce762846-dc64-4db2-8bf1-0611ee0ef0ed.pdf)
<a name="QgFpP"></a>
# 基本功能

1. 基于MRI的大脑分割 
2. 设置刺激参数，电场仿真  
3. 将仿真结果投射到 volume 或 surface， 或 MNI 及 fsaverage 空间 
4. 基于ROI加权平均的电场结果分析 

<a name="K41Qi"></a>
# Step 1 大脑分割及mesh生成

数据需要T1，T2（optional）

SimNIBS有两种工具，取决于不同的系统

|  | [headreco](https://simnibs.github.io/simnibs/build/html/documentation/command_line/headreco.html#headreco-docs) | [mri2mesh](https://simnibs.github.io/simnibs/build/html/documentation/command_line/mri2mesh.html#mri2mesh-docs) |
| --- | --- | --- |
| Operating Systems | Windows, Linux, MacOSX | Linux, MacOSX |
| External Dependencies | MATLAB | FreeSurfer and FSL |
| Coverage | Whole head and neck | Above the mouth |
| Time to run | ~2 hours (with CAT12), ~1 hour (without CAT12) | ~10 hours |
| Reference | [Nielsen et al., 2018](https://doi.org/10.1016/j.neuroimage.2018.03.001) | [Windhoff et al., 2013](https://doi.org/10.1002/hbm.21479) |

<a name="sXEzi"></a>
## headreco

```bash
# 使用T1和T2
headreco all ernie org/ernie_T1.nii.gz org/ernie_T2.nii.gz

# 仅使用T1
headreco all ernie org/ernie_T1.nii.gz

# 不使用CAT
headreco all --no-cat ernie org/ernie_T1.nii.gz

# 检查结果
headreco check ernie
```
**补充**

- `-v`调整mesh网格的密度 （默认 0.5 nodes/mm2）
- `--noclean`保留中间文件
- 可以修改`m2m__subID_/mask_prep/`下的mask，再运行`headreco surfacemesh subID` and `headreco volumemesh subID`以使用新的mask
- 结果可以被投射到个体空间和MNI空间，变换在SPM对T1进行Segmentaiton时决定。**注意**，**subject space并非原始T1，而是在**`**m2m_**_**subID**_**/T1fs_conform.nii.gz**`**，在根目录下，也有**`_**subID**_**_T1fs_conform.nii.gz**`**文件。程序对T1进行了位置调整，不要使用原始T1！**
- log文件可以在`m2m__subID_/headreco_log.html`找到
<a name="b5YqN"></a>
## mri2mesh

```bash
# 使用T1和T2
mri2mesh --all ernie org/ernie_T1.nii.gz org/ernie_T2.nii.gz

# 仅使用T1
mri2mesh --all ernie org/ernie_T1fs.nii.gz

# 检查结果
mri2mesh -c ernie
```
`mri2mesh`分为两步：

- 调用freesurfer，对皮层进行分割
- 使用freesurfer的结果进行mesh构建

输出：

1. _subID._msh （mesh的结果）
2. fs__subID _文件夹（freesurfer分割结果）
3. m2m__subID_ 文件夹 （meshing所需的文件）

当存在freesurfer结果文件时，`mri2mesh --all`会直接使用已经存在的freesurfer结果

**补充**

- 快速质控`mri2mesh --qc ernie`
- 调整mesh分辨率`--numvertices=<mynumber>`
- `--noclean`保留中间文件
- `--t2pial`使用T2提高分割分辨率，但只有1mm以上分辨率的图像推荐使用
- 要改进GM,WM表面，可以根据freesurfer wiki中的提示修改初步输出文件，再运行`mri2mesh --all`。要改进小脑、脑脊液、颅骨、皮肤的mask，可以修改`m2m__subID_/mask_prep/`下的mask文件，再运行 `mri2mesh --all --keep_masks`，`--keep_masks`防止覆盖修改的mask
- 结果可以被投射到个体空间和MNI空间，使用FSL的`fnirt`命令，如果使用不压脂的T1，可能会将skull投射为皮肤或脑组织，可以使用`-mnimaskskull`来避免。投射到MNI的结果在`m2m__subID_/_toMNI/_`。**注意**，**subject space并非原始T1，而是在**`m2m_subID/T1fs_conform.nii.gz`**，在根目录下，也有**`_subID_T1fs_conform.nii.gz`**文件。程序对T1进行了位置调整，不要使用原始T1！**
- log文件可以在`m2m__subID_/mri2mesh_log.html`找到

<a name="dd8SJ"></a>
# Step2 设置及开始仿真
<a name="pcxo5"></a>
## 基于 gui界面
<a name="ypaAY"></a>
## 基于command line
可以去SimNIBS文件夹中的examples去学习, 有Python和Matlab两种版本

**基于MNI空间坐标的TMS仿真**
```bash
import simnibs
from simnibs import sim_struct

### General Infoarmation
S = sim_struct.SESSION()
S.fnamehead = 'ernie.msh'  # head mesh
S.pathfem = 'tms_hand'  # Directory for the simulation


## Define the TMS simulation
tms = S.add_tmslist()
tms.fnamecoil = 'Magstim_70mm_Fig8.nii.gz'  # Choose a coil from the ccd-files folder

# Define the coil position
pos = tms.add_position()
# Place coil over the hand knob
# Here, the hand knob is defined in MNI coordinates (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2034289/)
# And transformed to subject coordinates
# We can use positions in the cortex. SimNIBS will automatically project them to the skin surface
# and add the specified distance
pos.centre = simnibs.mni2subject_coords([-37, -21, 58], 'm2m_ernie') 
# Point the coil handle posteriorly, we just add 10 mm to the original M1 y coordinate
pos.pos_ydir = simnibs.mni2subject_coords([-37, -21-10, 58], 'm2m_ernie')
pos.distance = 4  #  4 mm distance from coil surface to head surface


# Run Simulation
simnibs.run_simnibs(S)
```

**组水平的tACS仿真**
```bash
'''
    This example runs tDCS simulations with a bipolar montage for five subjects
    The dataset with the five head models is avaliable at https://osf.io/ah5eu/
    please look at the "group_average" for how to do a simple analysis of the group data
'''
import os
from simnibs import sim_struct, run_simnibs

# Set the subjects
subjects = ['sub01', 'sub09', 'sub10', 'sub12', 'sub15']

# Set a TDCSLIST structure with the simulation set-up
tdcslist = sim_struct.TDCSLIST()
tdcslist.currents = [0.001, -0.001]

anode = tdcslist.add_electrode()
anode.channelnr = 1
anode.centre = 'C3'
anode.pos_ydir = 'C1'
anode.shape = 'rect'
anode.dimensions = [50, 50]
anode.thickness = 4


cathode = tdcslist.add_electrode()
cathode.channelnr = 2
cathode.centre = 'AF4'
cathode.pos_ydir = 'F6'
cathode.shape = 'rect'
cathode.dimensions = [50, 70]
cathode.thickness = 4


# Run the simulation in each subject
for sub in subjects:
    # ALWAYS create a new SESSION when changing subjects
    s = sim_struct.SESSION()
    s.map_to_fsavg = True
    s.map_to_MNI = True
    s.fields = 'eEjJ'
    s.fnamehead = os.path.join(sub, sub + '.msh')
    s.pathfem = os.path.join(sub, 'bipolar')
    # Don't open in gmsh
    s.open_in_gmsh = False
    # Add the tdcslist we defined above
    s.add_poslist(tdcslist)
    # Run the sumulation
    run_simnibs(s)

```

Python脚本学习：<br />拟合过程涉及的**三个对象**

1. session对象：控制整个拟合过程的计算指标、计算输出等
   1. `s = simnibs.sim_struct.SESSION()`创建
2. timslist/tdcslist：添加的tms或tdcs刺激
   1. `tmslist = s.add_tmslist()`向session `s`中添加tmslist，同时返回该list，该list是s中添加的tmslist的引用
3. position：tms或tdcs的刺激位点，控制具体的刺激位点和方向、头皮距离、电流密度等参数
   1. `pos = tmslist.add_position()`向tmslist中添加position，同时返回该postion，该position是tmslist中添加的position的引用

使用`run_simnibs(s)`或`s.run()`均可执行仿真

<a name="FLasS"></a>
# Step3 仿真后处理
<a name="Muwmn"></a>
## 基于MNI坐标的分析
```bash
'''
Simple ROI analysis of the electric field from a simulation.

We will calculate the mean electric field in a gray matter ROI defined around M1
'''
import os
import numpy as np
import simnibs

## Load simulation result

# Read the simulation result
head_mesh = simnibs.read_msh(
    os.path.join('tdcs', 'ernie_TDCS_1_scalar.msh')
)

# Crop the mesh so we only have gray matter volume elements (tag 2 in the mesh)
gray_matter = head_mesh.crop_mesh(2)


## Define the ROI

# Define M1 from MNI coordinates (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2034289/)
# the first argument is the MNI coordinates
# the second argument is the subject "m2m" folder
ernie_coords = simnibs.mni2subject_coords([-37, -21, 58], 'm2m_ernie')
# we will use a sphere of radius 10 mm
r = 10.

# Electric fields are defined in the center of the elements
# get element centers
elm_centers = gray_matter.elements_baricenters()[:]
# determine the elements in the ROI
roi = np.linalg.norm(elm_centers - ernie_coords, axis=1) < r
# get the element volumes, we will use those for averaging
elm_vols = gray_matter.elements_volumes_and_areas()[:]

## Plot the ROI
gray_matter.add_element_field(roi, 'roi')
gray_matter.view(visible_fields='roi').show()

## Get field and calculate the mean
# get the field of interest
field_name = 'normE'
field = gray_matter.field[field_name][:]

# Calculate the mean
mean_normE = np.average(field[roi], weights=elm_vols[roi])
print('mean ', field_name, ' in M1 ROI: ', mean_normE)
```

<a name="CGjfv"></a>
## 基于表面Atlas的分析
```bash
'''
ROI analysis of the electric field from a simulation using an atlas.

We will calculate the mean electric field in a gray matter ROI defined using an atlas
'''
import os
import numpy as np
import simnibs

## Input ##

# Read the simulation result mapped to the gray matter surface
# ATTENTION: From the subjecct_overlays folder
gm_surf = simnibs.read_msh(
    os.path.join('tdcs', 'subject_overlays',
                 'ernie_TDCS_1_scalar_central.msh')
)

# Load the atlas and define the brain region of interest
atlas = simnibs.subject_atlas('HCP_MMP1', 'm2m_ernie')
region_name = 'lh.4'
roi = atlas[region_name]

# plot the roi
gm_surf.add_node_field(roi, 'ROI')
gm_surf.view(visible_fields='ROI').show()

# calculate the node areas, we will use those later for averaging
node_areas = gm_surf.nodes_areas()

# finally, calculate the mean of the field
field_name = 'E_normal'
mean_normE = np.average(gm_surf.field[field_name][roi], weights=node_areas[roi])
print('mean ', field_name, ' in ', region_name, ': ', mean_normE)
```