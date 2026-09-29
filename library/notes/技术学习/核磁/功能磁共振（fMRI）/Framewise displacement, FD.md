#影像 #预处理 #数据处理

Power, J. D., Barnes, K. A., Snyder, A. Z., Schlaggar, B. L., & Petersen, S. E. (2012). Spurious but systematic correlations in functional connectivity MRI networks arise from subject motion. _NeuroImage_, _59_(3), 2142–2154. [https://doi.org/10.1016/j.neuroimage.2011.10.018](https://doi.org/10.1016/j.neuroimage.2011.10.018)

## step 1: 计算 FD 需要 6 个指标：
1. trans_x
2. trans_y
3. trans_z
4. rot_x
5. rot_y
6. rot_z

## step 2: 计算 time differenec
$$
\Delta x_i = x_i - x_{i-1}
$$
此处无需计算绝对值，因为符号有方向信息

## step 3: 将角度转换为弧度（在一个半径为 50mm 的圆上）

fmrprep 输出的 rotx/y/z 为弧度 [弧度\_百度百科](https://baike.baidu.com/item/%E5%BC%A7%E5%BA%A6/1533188)，根据弧长公式：

$$
\Delta l\__{x/y/z} = \Delta rot\__{x/y/z} \times 50
$$

## step 4: 将每个时间点上的 x y z 轴 trans 差异和弧度差异的绝对值相加

$$
FD = |\Delta x| + |\Delta y| + |\Delta z| + |\Delta l_x| + |\Delta l_y| + |\Delta l_z|
$$


相关代码：

```r
confounders %>% 
  mutate(diff_trans_x = trans_x - lag(trans_x),
         diff_trans_y = trans_y - lag(trans_y),
         diff_trans_z = trans_z - lag(trans_z),
         
         diff_rot_x = rot_x - lag(rot_x),
         diff_rot_y = rot_y - lag(rot_y),
         diff_rot_z = rot_z - lag(rot_z),
         
         diff_rot_x_arc = diff_rot_x * 50,
         diff_rot_y_arc = diff_rot_y * 50,
         diff_rot_z_arc = diff_rot_z * 50,
         
         FD = abs(diff_trans_x) + abs(diff_trans_y) + abs(diff_trans_z) +
           abs(diff_rot_x_arc) + abs(diff_rot_y_arc) + abs(diff_rot_z_arc)
  )
```


```matlab
function [FD] = CAP_ComputeFD(motfile_name)

    Mot = textread(motfile_name);
    Mot = Mot(:,1:6);

    % Converts the rotational components into [mm]
    Mot(:,4:6) = 50*Mot(:,4:6);

    % Computes FD
    FD = sum(abs([0 0 0 0 0 0; diff(Mot)]),2);

end
```