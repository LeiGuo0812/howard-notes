#影像 #DWI #数据处理
# 官方网站

[https://dsi-studio.labsolver.org/](https://dsi-studio.labsolver.org/)

# 使用WSL运行DSI studio

Dsi studio 虽然提供了windows版本和命令行，但还是可以借助WSL更方便地用bash命令行进行分析。

配置方法：

-   **将WSL内核升级到Ubuntu 20.04！升级方法如下：**

此处为语雀内容卡片，点击链接查看：[https://www.yuque.com/howardgl/or9k4g/he82qs](https://www.yuque.com/howardgl/or9k4g/he82qs)

-   去官方网站下载 dsi_studio_ubuntu_2004.zip
-   解压缩到储存位置
-   在WSL将dsi studio路径（可放在任意盘）添加到PATH环境变量，例如 `export PATH=$PATH:/mnt/g/MRItoolbox/dsi-studio`

安装后运行 `dsi_studio`测试，可能会出现 `error while loading shared libraries: libQt5Core.so.5: cannot open shared object file: No such file or directory`. 查阅资料后([https://stackoverflow.com/questions/70815369/ros-problem-libqt5core-so-5-cannot-open-shared-object-file-no-such-file-or-di](https://stackoverflow.com/questions/70815369/ros-problem-libqt5core-so-5-cannot-open-shared-object-file-no-such-file-or-di)) 可通过如下命令解决：

```bash
# try
whereis libQt5Core.so.5

# copy that address
sudo strip --remove-section=.note.ABI-tag /usr/lib/x86_64-linux-gnu/libQt5Core.so.5
```


再次运行`dsi_studio`，如果出现下面的输出，说明配置成功：

```bash
qt.qpa.xcb: could not connect to display
qt.qpa.plugin: Could not load the Qt platform plugin "xcb" in "" even though it was found.
This application failed to start because no Qt platform plugin could be initialized. Reinstalling the application may fix this problem.

Available platform plugins are: xcb.

Aborted (core dumped)
```

# 分析流程

DSI studio的分析流程大体分为几步：

![](https://cdn.nlark.com/yuque/0/2022/png/1210419/1658036690942-bcb9fb31-f425-4e1b-a332-fde7edbeccd7.png)

  

其中的**FIB文件决定了纤维追踪是在个体空间还是标准空间**（取决于重建的方法，**DTI，GQI = 个体空间，QSDR = MNI空间**）

# Generate SRC file

```bash
dsi_studo --action=src --source=dwi_proc.nii.gz --bvec=proc.bvec --bval=proc.bval --output=dsi_file
```

# Reconstruction
```bash
dsi_studo --action=rec --source=*.nii.gz --method=4 --param0=1.25 --output=rec
```

# Specific Track tractography

```bash
dsi_studio --action=trk --source=*.fib.gz --fa_threshold=0.06 --turning_angle=45 --step_size=1 --max_length=300 --min_length=30 --track_id=Corticospinal_Tract_L --output=CST_L --export=stat,report:dti_fa:3:1 --mask=b0_brain_mask.nii.gz

```

批处理：

```bash
for i in `ls ./`
do 
  dsi_studio --action=trk --source=$i/*fib.gz --output=$i/CST_L --mask=$i/eddy_b0_brain_mask.nii.gz --export=stat,report:dti_fa:3:1 --fa_threshold=0.06 --turning_angle=45 --step_size=1 --min_length=30 --max_length=300 --track_id=Corticospinal_Tract_L
done
```

# ROI-based tractogrphy

[https://groups.google.com/g/dsi-studio/c/EBrOt4xQqJ8/m/6x6qemz5AgAJ](https://groups.google.com/g/dsi-studio/c/EBrOt4xQqJ8/m/6x6qemz5AgAJ)


纤维追踪的 region 使用提示：

[ROI-based Fiber Tracking | DSI Studio Documentation](https://dsi-studio.labsolver.org/doc/gui_t3_roi_tracking.html)

-   Assign `Seed` **_only if_** you want to speed up fiber tracking by limiting the starting region of fiber tracking.
-   Always start with only one ROI and gradually add more restrictions, such as the second `ROI`, `ROA`, `End`…etc.
-   Assign `ROA` to eliminate unwanted pathways.
-   Assign `End` **_only if_** you have tried assigning it as `ROI` and want more restricted results in the endpoints.
-   Assign `Terminative` **_only if_** you specifically want tracks to stop at a certain location.