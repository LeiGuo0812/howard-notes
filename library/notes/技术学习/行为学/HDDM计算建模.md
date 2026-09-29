---
date created: Wednesday, September 11th 2024, 11:02:25 pm
date modified: Wednesday, September 11th 2024, 11:16:34 pm
---
# 问题解决

- 使用 dockerHDDM 时，按照教程构建模型，`m = hddm.HDDM(data)`: `TypeError: reduce() of empty sequence with no initial value`

解决方案：
修改模型定义方式：
```python
m = hddm.HDDM(data, include = ['v', 'a', 't', 'z'],
                        informative = True,
                        is_group_model = True)
```

[hddm098 doesn't reproduce Basic HDDM Tutorial · Issue #4 · hcp4715/dockerHDDM · GitHub](https://github.com/hcp4715/dockerHDDM/issues/4)

`informative` 和 `is_group_model` 默认值都是 `True`，可以省略