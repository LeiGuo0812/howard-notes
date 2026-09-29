#影像 #数据处理 
# BIDS 官方网站 
[Brain Imaging Data Structure](https://bids-specification.readthedocs.io/en/stable/)

# BIDS 格式的基本概览
![0cdb01b705982aac2c421aa1dcfc60a.png|525](https://picture-of-howard.oss-cn-shanghai.aliyuncs.com/img/202303251605754.png)

# BIDS 的元素
必要：

## 文件结构 
- sub-\<label\>
	- (ses-\<label\>)
		- anat
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(T1w)\>.nii.gz
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(T1w)\>.json
		- func
			- sub-\<label\>(\_ses-\<label\>)\_task-\<label(rest)\>\_\<suffix(bold)\>.nii.gz
			- sub-\<label\>(\_ses-\<label\>)\_task-\<label(rest)\>\_\<suffix(bold)\>.json
		- dwi
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(dwi)\>.nii.gz
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(dwi)\>.json
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(dwi)\>.bvec
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(dwi)\>.bval
		- fmap
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(magnitude1)\>.nii.gz
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(magnitude1)\>.json
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(magnitude2)\>.nii.gz
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(magnitude2)\>.json
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(phasediff)\>.nii.gz
			- sub-\<label\>(\_ses-\<label\>)\_\<suffix(phasediff)\>.json

具体每个模态的文件结构可参考 [[Brain Imaging Data Structure (BIDS)#BIDS 格式的基本概览]] 或者 [Magnetic Resonance Imaging - Brain Imaging Data Structure v1.8.0](https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#anatomy-imaging-data)

- 被试名称必须以 `sub` 开头，其中 `<label>` 是字母和数字的组合，不可添加特殊符号如下划线等。如果原 id 和该规则冲突，则需要重新命名
- 如果只有一个 session，则 ses (session) 层级可以忽略，这样后续文件名中也无需添加 session 的信息
- 关于 fmap 的类型，可以查阅 [[关于场图 Field map fmap]]

## dataset_description.json

[Modality agnostic files - Brain Imaging Data Structure v1.8.0](https://bids-specification.readthedocs.io/en/stable/03-modality-agnostic-files.html#dataset-description)

非必须：

## participants.tsv

用于描述被试的一些基本信息，必须包括一列为 `participants_id`，其中的值为 `sub-<label>` ，同时，如果修改了 id，可以将原 id 添加上去。也可以添加被试的年龄、性别等基本信息


# 手动整理数据为 BIDS 格式

## 1.原始数据格式

[[影像数据整理+原点校正]]

将所有被试的文件夹整理到一个父文件夹中：

- RawData
	- sub-01
		- Raw
			- 0001.dcm
			- 0002.dcm
			- ...
	- sub-02
	- sub-03
	- ...

## 2.数据转换

- 在 `RawData` 下，运行 `ls ./ > list.txt` 将所有被试的名称储存下来，需要将 `list.txt` 中的 list.txt 删除，不要有多余行
- 运行 `dcm2niix` 即将所有原始数据转为 .nii.gz 和.json 文件
```bash
for i in `cat list.txt`;do dcm2niix -z y -i y $i;done

# or
cat list.txt | parallel dcm2niix -z y -i y {}
```


## 3.生成需拷贝的文件列表

- 查看被试文件夹下不同序列的命名规则
- 在 `RawData` 下，运行

```bash
# T1
for i in `cat list.txt`;do du $i/*{MPRAGE,mpr}*.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> t1_list.txt;done

# T2
for i in `cat list.txt`;do du $i/*t2*.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> t2_list.txt;done

# bold-rest
for i in `cat list.txt`;do du $i/*bold*{rest,RS}*.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> rest_list.txt;done

# dwi
for i in `cat list.txt`;do du $i/*{DTI,diff}*.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> dwi_list.txt;done

# fmap-e1
for i in `cat list.txt`;do du $i/*field_map*e1.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> e1_list.txt;done

# fmap-e2
for i in `cat list.txt`;do du $i/*field_map*e2.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> e2_list.txt;done

# fmap-ph
for i in `cat list.txt`;do du $i/*field_map*ph.nii.gz | sort -hr | sed -n '1p' | awk '{print $2}' >> ph_list.txt;done
```

- 生成 `t1_list.txt`, `t2_list.txt`, `rest_list.txt`, `dwi_list.txt`, `e1_list.txt`, `e2_list.txt`, `ph_list.txt`
- 每个文件中的每一行即需要整理的文件路径，路径的第一个成分是被试名文件夹，可以用来识别被试 id

## 4.拷贝文件

在 `RawData` 文件夹的同级文件夹下，创建 `BIDS` 文件夹

- BIDS
- RawData
	- list.txt
	- t1_list.txt
	- t2_list.txt
	- ...

回到 `RawData` 文件夹，创建 R 脚本，进行文件拷贝，即可在 BIDS 文件夹中生成相应的 BIDS 格式数据

```r
library(tidyverse)
library(fs)
library(jsonlite)

# read file list in
t1_list = read.table('t1_list.txt', header = F)
t2_list = read.table('t2_list.txt', header = F)
rest_list = read.table('rest_list.txt', header = F)
dwi_list = read.table('dwi_list.txt', header = F)
e1_list = read.table('e1_list.txt', header = F)
e2_list = read.table('e2_list.txt', header = F)
ph_list = read.table('ph_list.txt', header = F)

# read participants table to match old and new ids 
participants = read.table('../BIDS/participants.tsv', header = T)


# T1

for (i in seq_len(nrow(t1_list))) {
  # get original id
  sub = str_split(t1_list$V1[i],'/')[[1]][1]
  # match new id
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  # get filename with no extension
  file_clean = str_remove(t1_list$V1[i],'\\.nii\\.gz')
  # get img path
  img = paste0(file_clean, '.nii.gz')
  # get json path
  json = paste0(file_clean, '.json')
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'anat')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'anat')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/anat/', bids_sub, '_T1w.nii.gz'), 
            overwrite = T)
  file_copy(path = json, 
            new_path = paste0('../BIDS/', bids_sub, '/anat/', bids_sub, '_T1w.json'), 
            overwrite = T)
  
}


# t2

for (i in seq_len(nrow(t2_list))) {
  sub = str_split(t2_list$V1[i],'/')[[1]][1]
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  file_clean = str_remove(t2_list$V1[i],'\\.nii\\.gz')
  img = paste0(file_clean, '.nii.gz')
  json = paste0(file_clean, '.json')
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'anat')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'anat')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/anat/', bids_sub, '_T2w.nii.gz'), 
            overwrite = T)
  file_copy(path = json, 
            new_path = paste0('../BIDS/', bids_sub, '/anat/', bids_sub, '_T2w.json'), 
            overwrite = T)
  
}

# rest

for (i in seq_len(nrow(rest_list))) {
  sub = str_split(rest_list$V1[i],'/')[[1]][1]
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  file_clean = str_remove(rest_list$V1[i],'\\.nii\\.gz')
  img = paste0(file_clean, '.nii.gz')
  json = paste0(file_clean, '.json')
  
  # suggestion from BIDS validator, add an addition field TaskName
  json_data = read_json(json)
  json_data$TaskName = 'rest' 
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'func')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'func')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/func/', bids_sub, '_task-rest_bold.nii.gz'), 
            overwrite = T)
  # write the modified json
  write_json(json_data, 
             paste0('../BIDS/', bids_sub, '/func/', bids_sub, '_task-rest_bold.json'),
             auto_unbox = T, pretty = T)
}

# dwi

for (i in seq_len(nrow(dwi_list))) {
  sub = str_split(dwi_list$V1[i],'/')[[1]][1]
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  file_clean = str_remove(dwi_list$V1[i],'\\.nii\\.gz')
  img = paste0(file_clean, '.nii.gz')
  json = paste0(file_clean, '.json')
  # for dwi, there is also bvec and bval
  bvec = paste0(file_clean, '.bvec')
  bval = paste0(file_clean, '.bval')
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'dwi')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'dwi')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/dwi/', bids_sub, '_dwi.nii.gz'),
            overwrite = T)
  file_copy(path = json, 
            new_path = paste0('../BIDS/', bids_sub, '/dwi/', bids_sub, '_dwi.json'), 
            overwrite = T)
  file_copy(path = bvec, 
            new_path = paste0('../BIDS/', bids_sub, '/dwi/', bids_sub, '_dwi.bvec'), 
            overwrite = T)
  file_copy(path = bval, 
            new_path = paste0('../BIDS/', bids_sub, '/dwi/', bids_sub, '_dwi.bval'), 
            overwrite = T)
  
}


# e1

for (i in seq_len(nrow(e1_list))) {
  sub = str_split(e1_list$V1[i],'/')[[1]][1]
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  file_clean = str_remove(e1_list$V1[i],'\\.nii\\.gz')
  img = paste0(file_clean, '.nii.gz')
  json = paste0(file_clean, '.json')
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'fmap')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'fmap')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/fmap/', bids_sub, '_magnitude1.nii.gz'), 
            overwrite = T)
  file_copy(path = json, 
            new_path = paste0('../BIDS/', bids_sub, '/fmap/', bids_sub, '_magnitude1.json'), 
            overwrite = T)
  
}


# e2

for (i in seq_len(nrow(e2_list))) {
  sub = str_split(e2_list$V1[i],'/')[[1]][1]
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  file_clean = str_remove(e2_list$V1[i],'\\.nii\\.gz')
  img = paste0(file_clean, '.nii.gz')
  json = paste0(file_clean, '.json')
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'fmap')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'fmap')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/fmap/', bids_sub, '_magnitude2.nii.gz'), 
            overwrite = T)
  file_copy(path = json, 
            new_path = paste0('../BIDS/', bids_sub, '/fmap/', bids_sub, '_magnitude2.json'), 
            overwrite = T)
  
}


# ph

for (i in seq_len(nrow(ph_list))) {
  sub = str_split(ph_list$V1[i],'/')[[1]][1]
  bids_sub = participants[participants$origin_id == sub, 'participant_id']
  file_clean = str_remove(ph_list$V1[i],'\\.nii\\.gz')
  img = paste0(file_clean, '.nii.gz')
  json = paste0(file_clean, '.json')
  
  # suggested by BIDS validator, add two fields: EchoTime1, EchoTime2
  json_data = read_json(json)
  
  # find subject corresponding e1 json
  json_e1 = na.omit(str_match(e1_list$V1, paste0(sub,'/.*_e1.nii.gz')))[1,1] %>% 
    str_remove('\\.nii\\.gz') %>% 
    paste0('.json')
  json_e1_data = read_json(json_e1)
  
  # find subject corresponding e2 json
  json_e2 = na.omit(str_match(e2_list$V1, paste0(sub,'/.*_e2.nii.gz')))[1,1] %>% 
    str_remove('\\.nii\\.gz') %>% 
    paste0('.json')
  json_e2_data = read_json(json_e2)
  
  # extract corresponding info to new fields
  json_data$EchoTime1 = json_e1_data$EchoTime
  json_data$EchoTime2 = json_e2_data$EchoTime
  
  # create subject dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub)))) {
    dir_create(path_join(c('../BIDS/', bids_sub)))
  }
  
  # create modality dir
  if (! dir_exists(path_join(c('../BIDS/', bids_sub, 'fmap')))) {
    dir_create(path_join(c('../BIDS/', bids_sub, 'fmap')))
  }
  
  # copy files
  file_copy(path = img, 
            new_path = paste0('../BIDS/', bids_sub, '/fmap/', bids_sub, '_phasediff.nii.gz'), 
            overwrite = T)
  # write the modified json
  write_json(json_data, 
            paste0('../BIDS/', bids_sub, '/fmap/', bids_sub, '_phasediff.json'), 
            auto_unbox = T, pretty = T)
  
}

```

## 5.生成 dataset_description.json 文件

到顶层文件夹，运行 R 代码：

```r
library(jsonlite)

dataset_description = list(
  Name = 'SMHC_MA_HC_dataset',
  BIDSVersion = 'v1.8.0',
  DatasetType = 'raw',
  Authors = list('LeiGuo'),
  GeneratedBy = list(list(Name = 'Manual'),
                     list(Name = 'dcm2niix',
                          Version = 'v1.0.20181125')
                      )
)

write_json(dataset_description, './BIDS/dataset_description.json',
           auto_unbox = T, pretty = T)

```

## 6. 使用 BIDS-validator 进行数据验证

[https://bids-standard.github.io/bids-validator/](https://bids-standard.github.io/bids-validator/)

将 BIDS 文件夹选中上传，进行分析，会报告 BIDS 文件夹是否符合规范。

### 常见错误

- 命名错误：没有按照 sub-\<label\>规范进行命名
- 影像数据 metadata 中缺少字段：如功能影像的 json 文件中缺少 `TaskName` 字段（静息态也需要该字段 rest），phasediff 文件的 json 文件中缺少 `EchoTime1` 和 `EchoTime2` 文件
	- 在拷贝文件的时候对 json 文件进行操作即可
- 缺少 `dataset_description.json` 文件



# 使用软件将数据整理为 BIDS 格式

[HeuDiConv — heudiconv 0.12.2.post6+gb2e5d03 documentation](https://heudiconv.readthedocs.io/en/latest/index.html)


