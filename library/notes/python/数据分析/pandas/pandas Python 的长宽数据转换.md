---
date created: Monday, December 11th 2023, 10:58:35 pm
date modified: Tuesday, December 12th 2023, 12:01:31 am
---
#Python #Pandas
# 长转宽
使用 `pivot_table` 进行长到宽的转换
注意：
1. `index` 参数应包含所有不希望改变的列。
2. `columns`参数设置为需要转换为宽格式的列（例如`Test`）
3. `values`参数设置为您希望展开的数据列。

```python
import pandas as pd

# 示例数据
data = {
    'ID': [1, 1, 2, 2],
    'Test': ['Pre', 'Post', 'Pre', 'Post'],
    'Data1': [10, 20, 30, 40],
    'Data2': [5, 15, 25, 35],
    'Other1': ['A', 'B', 'C', 'D'],
    'Other2': ['X', 'Y', 'Z', 'W']
}

df = pd.DataFrame(data)

# 转换为宽格式，同时保持其他列不变
df_wide = df.pivot_table(index=['ID', 'Other1', 'Other2'], columns='Test', values=['Data1', 'Data2'])

# 重置列名
df_wide.columns = ['_'.join(col).strip() for col in df_wide.columns.values]

# index列传入列表会创建多层索引
# 使用reset_index可以将索引重置为普通列
df_wide = df_wide.reset_index()

print(df_wide)

```

使用 `pivot` 函数也可以达到相同的结果，但该函数没有聚合功能


在使用`pivot_table`函数时，如果发现转换后的数据框行数没有变少，并且在展开的列中出现了很多缺失值，通常是因为原始数据中的组合键（即用作`index`的那些列）不是唯一的。这种情况下，`pivot_table`会为每个唯一的组合键创建一行，而如果某些组合键在`columns`参数指定的列中没有对应值，就会在相应位置产生缺失值。

# 宽变长

使用 `melt` 函数实现

1. `id_vars` 对应 `index`
2. `var_name`: 变长数据后的标识列名
3. `value_name`：变长数据后值的列名

```python
import pandas as pd

# 假设df_wide是之前转换得到的宽格式DataFrame
# 示例数据（宽格式）
data_wide = {
    'ID': [1, 2],
    'Other1': ['A', 'C'],
    'Other2': ['X', 'Z'],
    'Pre_Data1': [10, 30],
    'Post_Data1': [20, 40],
    'Pre_Data2': [5, 25],
    'Post_Data2': [15, 35]
}

df_wide = pd.DataFrame(data_wide)

# 转换回长格式
df_long = df_wide.melt(id_vars=['ID', 'Other1', 'Other2'], 
                       var_name='Test_Data', 
                       value_name='Value')

# 分割Test_Data列为Test和Data列
df_long[['Test', 'Data']] = df_long['Test_Data'].str.split('_', expand=True)

# 丢弃原来的Test_Data列
df_long = df_long.drop('Test_Data', axis=1)

# 重新排列列的顺序
df_long = df_long[['ID', 'Other1', 'Other2', 'Test', 'Data', 'Value']]

print(df_long)
```