# 官方网站

[SimNIBS 4 — SimNIBS 4.1.0 documentation](https://simnibs.github.io/simnibs/build/html/index.html)

# 输出皮层以外组织的电场（白质、脑脊液等）

[Not getting estimates for non-brain tissue · simnibs/simnibs · Discussion #308 · GitHub](https://github.com/simnibs/simnibs/discussions/308)

```python
S.map_to_vol = True     #  Save as nifti volume
S.map_to_MNI = True     #  Save in MNI space
S.tissues_in_niftis = [1,2,3]
```

```matlab
S.map_to_vol = true;    %  Save as nifti volume
S.map_to_MNI = true;    %  Save in MNI space
S.tissues_in_niftis = [1,2,3];
```

