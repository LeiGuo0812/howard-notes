---
date created: Monday, January 1st 2024, 10:26:31 pm
date modified: Wednesday, January 3rd 2024, 3:30:41 pm
---
#Python #Polars
# 累加多个列的值

使用 fold 方法：

[polars.fold — Polars documentation](https://docs.pola.rs/py-polars/html/reference/expressions/api/polars.fold.html#polars.fold)

[Polars: add the sum of some columns inside select/with\_column call - Stack Overflow](https://stackoverflow.com/questions/72126913/polars-add-the-sum-of-some-columns-inside-select-with-column-call)

> You can use a `fold` expression, which takes an accumulator: `acc`, a binary function `Fn(acc, Series) -> Series` and one or more expression to apply the fold on.

```python
df.with_columns(
    pl.fold(0, lambda acc, s: acc + s, pl.all().exclude("id")).alias("horizontal_sum")
)
```

- 以 0 作为 accumulator，后续的列值都加到 0 上
- 第二个参数是一个函数，有两个参数，分别接收 accumulator 和其他列值
- 后面可以跟 polars 的表达式，用于选择需要相加的列


# 对多个列进行同时数值操作

假如要对 alcohol，ash 两个列的数值用 6 减（模拟反向计分），可以传入一个表达式列表并传给 `with_columns` 函数
- 注意 `pl.col` 应该放在表达式前面，这样可以不用再使用 `alias` 改名，如果使用 `6-pl.col(column)` 则需要使用 `alias` 方法改名
- 因为 `pl.col` 表达式放在后面的话，生成的列均为 `literal`, 重复生成则会造成列名冲突

```python
df.with_columns(
    [-pl.col(column) + 6 for column in ['alcohol', 'ash']]
)
```

# 将字符串列按分隔符分成多列

[polars.Expr.str.split\_exact — Polars documentation](https://docs.pola.rs/py-polars/html/reference/expressions/api/polars.Expr.str.split_exact.html#polars.Expr.str.split_exact)

```python
df = pl.DataFrame({"x": ["a_1", None, "c", "d_4"]})

df.with_columns(
     [
         pl.col("x")
         .str.split_exact("_", 1)
         .struct.rename_fields(["first_part", "second_part"])
         .alias("fields"),
    ]
 ).unnest("fields")
```

对于 struct （多列）数据的操作：

[The Struct datatype - Polars](https://docs.pola.rs/user-guide/expressions/structs/#encountering-the-struct-type)

# 将多个字符串列拼接

[Folds - Polars](https://docs.pola.rs/user-guide/expressions/folds/#folds-and-string-data)

虽然 `fold` 可以用来拼接字符串，但是复杂度是平方级的，使用 `pl.concat_str` 效率更高

```python
df = pl.DataFrame( { "a": ["a", "b", "c"], "b": [1, 2, 3], } ) 

out = df.select(pl.concat_str(["a", "b"]))
```