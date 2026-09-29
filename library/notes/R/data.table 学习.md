---
date created: Wednesday, May 3rd 2023, 10:15:15 pm
date modified: Thursday, April 4th 2024, 10:31:27 am
---
#R语言 #编程

# data.table 中的运算顺序

在 R 的 data.table 包中，`i`、`j` 和 `by` 的运算顺序非常重要。理解这些运算的顺序可以帮助你更好地使用 data.table 进行数据操作。以下是运算顺序的详细说明：

1. **i 运算**：
   首先执行 `i`，它用于筛选行。`i` 类似于 SQL 中的 `WHERE` 子句。所有符合 `i` 条件的行会被选出进行下一步操作。

   ```R
   dt[i]
   ```

2. **by 运算**：
   在筛选出的行上，执行 `by`，它用于分组操作。`by` 类似于 SQL 中的 `GROUP BY` 子句。数据会按照 `by` 中指定的列进行分组。

   ```R
   dt[i, j, by]
   ```

   在这个步骤中，data.table 会基于 `by` 指定的列进行分组运算。

3. **j 运算**：
   最后执行 `j`，它用于计算或选择列。`j` 类似于 SQL 中的 `SELECT` 子句。可以在这里进行列的选择、计算和聚合操作。

   ```R
   dt[i, j, by]
   ```

   在分组的基础上，data.table 会对每个组应用 `j` 中的计算或选择操作。

总结起来就是：

- **首先**，执行 `i` 来筛选行。
- **然后**，对筛选后的结果进行 `by` 分组。
- **最后**，在分组后的结果上执行 `j` 来计算或选择列。

下面是一个具体的例子：

```R
library(data.table)
dt <- data.table(A = c(1, 2, 1, 2, 1, 2), B = 1:6, C = 7:12)

# 选出 A == 1 的行，然后按 B 进行分组，对每个组计算 C 的和
result <- dt[A == 1, sum(C), by = B]
print(result)
```

在这个例子中：
1. `i` 运算：首先选出 `A == 1` 的行。
2. `by` 运算：然后按 `B` 分组。
3. `j` 运算：最后对每个组计算 `C` 的和。

# 累加多个列的值
```r
dt[, Sum_ABC := rowSums(.SD), .SDcols = c("A", "B", "C")]
```

```r
dt[, Sum_ABC := Reduce("+", .SD), .SDcols = c("A", "B", "C")]

# make sure each column is numeric
dt[, Sum_ABC := Reduce(`+`, lapply(.SD, as.numeric)), .SDcols = c("A", "B", "C")]
```

# 对多个列进行同时数值操作
```r
dt[, (names(dt)) := lapply(.SD, function(x) x + 5), .SDcols = c("A", "B", "C")]
```
# 将字符串列按分隔符分成多列

使用 `tstrsplit` 函数：

```r
dt[, c("PX", "PY") := tstrsplit(PREFIX, "_", fixed=TRUE)]
```

# data.table 中的 case_when

使用 `fcase` 函数

```r
fcase(
  x < 5L, 1L,
  x >= 5L, 3L,
  x == 5L, stop("provided value is an unexpected one!"),
  default = NA
)
```

# 将多个字符串列拼接
```r
dt[, combined := do.call(paste, c(.SD, sep = ", ")), .SDcols = c("col1", "col2", "col3")]
```

对 `do.call` 的解释：
1. **`.SD` 的作用**:
    
    - 在`data.table`中，`.SD`是一个特殊的符号，它代表 "Subset of Data.table"。当你在`j`表达式中使用`.SD`时，它会返回一个`data.table`或`data.frame`，其中包含`.SDcols`指定的所有列。
2. **`paste`函数的行为**:
    
    - `paste`函数可以接受多个向量作为输入，并将这些向量的对应元素连接起来。例如，`paste(c("a", "b"), c("1", "2"))`会生成`c("a 1", "b 2")`。
3. **`do.call`的作用**:
    
    - `do.call`允许你调用一个函数，并将一个列表作为该函数的参数。在`do.call`的调用中，列表中的每个元素都被视为一个单独的参数。

当使用`do.call(paste, c(.SD, sep = ", "))`时，以下事情发生：

- `.SD`作为一个数据表，其每一列都被视为一个单独的向量。
- 这些列（向量）和`sep = ", "`一起被打包进一个列表（`c(.SD, sep = ", ")`），并传递给`do.call`。
- `do.call`接受这个列表，并将列表中的每个元素作为一个单独的参数传递给`paste`函数。
- `paste`函数接收到这些列（向量）作为参数，并逐个元素地将它们连接起来，`sep`参数指定了元素之间的分隔符。

所以，虽然通常 `paste` 不是直接用于整个数据框或数据表的，`do.call` 的使用使得这成为可能，因为它有效地将 `.SD` 中的每一列解包成单独的向量，并将它们作为独立的参数传递给 `paste`。

# :=能用于赋值的情况

`:=` 操作符在 `data.table` 中通常用于原地修改数据，不直接返回新的数据表。但是，在特定的上下文，如链式操作或作为 `[.()]` 调用的一部分时，整个表达式的结果是可以被赋值的

1. **链式操作中：** 当`:=`用于链式操作的一部分时，整个链式操作的结果可以赋值给一个新变量，即便`:=`部分本身是原地修改并返回`NULL`。这是因为在链式操作的上下文中，`data.table`会将修改后的数据表传递给链的下一个环节或返回给用户。
    `# 在链式操作中使用 := 赋值 new_dt <- dt[, new_column := "factor1"][, .(id, new_column)]`
    
2. **在`[.()]`内部使用时：** 当`:=`用在`[.()]`内部对数据表进行操作时，尽管`:=`本身的行为是原地修改数据表，但是如果这个操作是整个`[.()]`调用的一部分，那么`[.()]`操作可以返回修改后的数据表的引用，因此可以赋值给另一个变量。
    ``# 在 [.()] 内部使用 := 赋值，并将结果赋给新变量 new_dt <- dt[, `:=`(new_column = "factor1"), .SDcols = columns_of_interest]``