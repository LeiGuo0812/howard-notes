---
date created: Friday, March 28th 2025, 9:32:57 pm
date modified: Sunday, April 6th 2025, 10:20:08 pm
---
#影像 #统计学 #空间相关

空间自相关图像的生成有两种类型：

- 未分割的脑图
- 经过模板分割的脑图

# 未分割的脑图

neuromap 中的所有 Null 模型函数都有（或多或少）相同的接口。它们接受 （1） 数据数组或图像元组，（2） 坐标系 + 所提供数据的密度，（3） 所需自相关图的数量（即排列），以及 （4） 可重复性的随机种子。这些函数将生成一个二维形状数组（顶点、模拟数量）：

```python
from neuromaps import datasets, images, nulls, resampling

neurosynth = datasets.fetch_annotation(source='neurosynth')
abagen = datasets.fetch_annotation(source='abagen')

neurosynth, abagen = resampling.resample_images(neurosynth, abagen, 'MNI152', 'fsaverage')

rotated = nulls.alexander_bloch(neurosynth, atlas='fsaverage', density='10k',n_perm=100, seed=1234)
print(rotated.shape)
```

该方法对电脑资源消耗较大，需要高性能电脑

# 图谱分割后的脑图

使用图谱分割后的数据生成自相关脑图，需要顶点的标注文件，对应的 label 值。

例如：
```python
from nilearn.datasets import fetch_atlas_surf_destrieux
destrieux = fetch_atlas_surf_destrieux()

print(sorted(destrieux))

['description', 'labels', 'map_left', 'map_right']

print(len(destrieux['map_left']), len(destrieux['map_right']))

10242 10242

print(len(destrieux['labels']))
76
```

label 为每个分区的名称字符串，`map_left/right` 为数组，提供每个 vertex 上所属的 label 索引。

---

注意：使用 neuromaps 中的 pacellate 功能对 surface 数据进行分割，需要满足两个条件：
- 从左脑到右脑，脑区索引应**从小到大且连续**；
- **非脑区部分的值必须为 0**
如果不满足，可以使用 images 中的 relabel_gifti 函数转换

---

官方教程里， destrieux 获取的索引在两个半球上是一致的，且 Medial_Wall 的索引是 42，在分割的时候用不到，因此要处理这两个问题。使用 `images.construct_shape_gii` 函数将分区数组转换成 `gii` 文件，同时提供 label 信息。

使用 `images.relabel_gifti` 函数，设置 `background` 参数，将 'Medial_wall' label 对应的索引设置为 0, 并将索引从左脑到右脑升序排列

```python
labels = [label.decode() for label in destrieux['labels']]

parc_left = images.construct_shape_gii(destrieux['map_left'], labels=labels, intent='NIFTI_INTENT_LABEL')

parc_right = images.construct_shape_gii(destrieux['map_right'], labels=labels, intent='NIFTI_INTENT_LABEL')

parcellation = images.relabel_gifti((parc_left, parc_right), background=['Medial_wall'])

print(parcellation)
```

这一步做了几件事情：
- 将 Medial Wall label 对应的 vertex 设置为 0，并将其从 label 中移除。
- 将两个半球 vertex 上的值变为连续

---
接下来可以用变换后的 parcellation 用于分割数据：

```python
from neuromaps import parcellate

destrieux = parcellate.Parcellater(parcellation, 'fsaverage').fit()

neurosynth_parc = destrieux.transform(neurosynth, 'fsaverage')
abagen_parc = destrieux.transform(abagen, 'fsaverage')

print(neurosynth_parc.shape, abagen_parc.shape)
```

---

获取分割后的数据，即可用来生成自相关图, 此处需要额外提供一个 `parcellation` 参数

```python
rotated = nulls.alexander_bloch(neurosynth_parc, atlas='fsaverage', density='10k', n_perm=100, seed=1234, parcellation=parcellation)

print(rotated.shape)
```


 ## 分割后的脑图谱使用注意事项
1. **如果使用 Moran 方法**，使用分割后的数据生成自相关图像只能使用 `fsaverage` 表面的数据，因为需要用到软脑膜表面文件，而 `neuromaps` 没有为其他表面提供该文件，如果需要用其他表面生成，可以使用 `brainspace` 包（`neuromaps` 就是调用的它的函数）

---
1. 关于 parcellation 的问题：

分割源码：
[neuromaps/neuromaps/parcellate.py at abf5a5c3d3d011d644b56ea5c6a3953cedd80b37 · netneurolab/neuromaps · GitHub](https://github.com/netneurolab/neuromaps/blob/abf5a5c3d3d011d644b56ea5c6a3953cedd80b37/neuromaps/parcellate.py#L93)

```python
def transform(self, data, space, ignore_background_data=False,
                  background_value=None, hemi=None):
	self._check_fitted()

	space = ALIAS.get(space, space)
	if (self.resampling_target == 'data' and space == 'MNI152'
			and not self._volumetric):
		raise ValueError('Cannot use resampling_target="data" when '
						 'provided parcellation is in surface space and '
						 'provided data are in MNI152 space.')
	elif (self.resampling_target == 'parcellation' and self._volumetric
			and space != 'MNI152'):
		raise ValueError('Cannot use resampling_target="parcellation" '
						 'when provided parcellation is in MNI152 space '
						 'and provided data are in surface space.')

	if hemi is not None and hemi not in self.hemi:
		raise ValueError('Cannot parcellate data from {hemi} hemisphere '
						 'when parcellation was provided for incompatible '
						 'hemisphere: {self.hemi}')

	if isinstance(data, np.ndarray):
		data = _array_to_gifti(data)
	if self.resampling_target in ('data', None):
		resampling_method = 'nearest'
	else:
		resampling_method = 'linear'
	data, parc = resample_images(data, self.parcellation,
								 space, self.space, hemi=hemi,
								 resampling=self._resampling,
								 method=resampling_method)

	if ((self.resampling_target == 'data'
		 and space.lower() == 'mni152')
			or (self.resampling_target == 'parcellation'
				and self._volumetric)):
		data = nib.concat_images([nib.squeeze_image(data)])
		if ignore_background_data:
			if background_value is None:
				mask_img = compute_background_mask(data)
			else:
				mask_img = new_img_like(
					data, data.get_fdata() != background_value)
		else:
			mask_img = None
		parcellated = NiftiLabelsMasker(
			parc, mask_img=mask_img, resampling_target=None
		).fit_transform(data)
	else:
		if not self._volumetric:
			for n, _ in enumerate(parc):
				parc[n].labeltable.labels = \
					self.parcellation[n].labeltable.labels
		darr = _gifti_to_array(data)
		if ignore_background_data and background_value is None:
			density, = _estimate_density((data,), hemi=hemi)
			if self.resampling_target in ('data', None):
				mask_space = space
			elif self.resampling_target == 'parcellation':
				mask_space = self.space
			nomedialwall = load_data(
				fetch_atlas(mask_space, density)['medial'])
			background_value = np.median(darr[nomedialwall == 0])
		parcellated = vertices_to_parcels(
			darr, parc, background=background_value)

	return parcellated
```

生成自相关图源码：

[neuromaps/spins.py at abf5a5c3d3d011d644b56ea5c6a3953cedd80b37 · netneurolab/neuromaps · GitHub](https://github.com/netneurolab/neuromaps/blob/abf5a5c3d3d011d644b56ea5c6a3953cedd80b37/neuromaps/nulls/spins.py#L53)

```python
def alexander_bloch(data, atlas='fsaverage', density='10k', parcellation=None, n_perm=1000, seed=None, spins=None, surfaces=None):

    if spins is None:
        if surfaces is None:
        
            surfaces = fetch_atlas(atlas, density)['sphere']
	        coords, hemi = get_parcel_centroids(surfaces, parcellation=parcellation, method='surface')
	        
        spins = gen_spinsamples(coords, hemi, n_rotate=n_perm, seed=seed)
        
    spins = load_spins(spins)
    
    if data is None:
        data = np.arange(len(spins))
    return load_data(data)[spins]
```

此处分割调用了几个函数，主要是 `get_parcel_centroids` 函数：


在分割时和生成随机图时，两个函数对 gifti 文件中的 label 处理方式是不一样的：

分割时，label 提供补充信息，但分割时是根据 gifti 文件中 darray 取值是否为 0 来决定是否纳入分割，默认 0 为 background，在分割时不考虑。如果没有提供 background 值，则在对应分辨率的模板上取出 medial 部分的值，将其从其中剔除。gifti 中 label 的值对分割影响不大。

但在生成随机图时（`get_parcel_centroids` 函数），则通过遍历 label 中的值，从中找出对应的顶点索引，然后将 data 中对应索引值平均。由于是左右半球分别进行，则 darray 中左右半球都有的的值（如 0）会被计算 2 次（例如 schaefer400， lh：0-200，rh：0，201-400），而 0 值可以通过在 `get_parcel_centroids` 函数中指定 `drop` 对 label 中的子集来跳过某区域，如 media wall。但是在自相关图生成函数中，没有该参数，函数会去匹配 `neuromaps.images.PARCIGNORE` 中的元素来跳过该区域，因此想要跳过特定 label，只能通过向 ` neuromaps.images.PARCIGNORE ` 环境变量列表中 ` append ` 对应的 label 值。

对于没有对 darray 中 0 值进行 label 编码的，则需要在 label 的第 0 个索引处 ` insert ` 一个 label，再通过 `images.construct_shape_gii` 函数构造 gifti 文件来跳过该区域。

 ` neuromaps.images.PARCIGNORE ` 中默认的值包括，`insert` 时可从中选择一个：

```python
['unknown',
 'corpuscallosum',
 'Background+FreeSurfer_Defined_Medial_Wall',
 '???',
 'Unknown',
 'Medial_wall',
 'Medial wall',
 'medial_wall']
```

### 总结
如果左右半球 darry 数值一样，则通过 `images.relabel_gifti` 来重新编码 darry 值，同时指定 background label，结束后，检查 label 第 0 个是否在 ` neuromaps.images.PARCIGNORE `

如果左右半球 darray 数值不同，则检查 label 是否包含了 darray 为 0 时的 label，如果没有，则 `insert` 一个 `neuromaps.images.PARCIGNORE` 中的值，跳过背景区域，以保证生成自相关图时不会出现超出索引问题。