# ggplot中stat的种类与用法

### 🧑‍💻 User

ggplot2中，stat一共有多少种？分别代表了什么？如何使用？

---

### 🤖 Assistant

在 **ggplot2** 中，**stat**（统计变换）用于在绘图前对数据进行某种计算或转换（如汇总、拟合、分箱等）。**ggplot2 提供了约 30 种 stat**，每种对应不同的数据计算方式。以下是常见 stat 的分类、功能及用法示例：

---

### 一、核心 stat 分类及功能

以下是常用的 stat 及其作用：

|**Stat 名称**|**功能**|**对应的 geom**|
|---|---|---|
|`stat_identity`|直接使用原始数据，不进行任何计算|`geom_point()`, `geom_line`|
|`stat_count`|计算分类变量的频数（用于条形图）|`geom_bar()`|
|`stat_bin`|将连续变量分箱（用于直方图）|`geom_histogram()`|
|`stat_density`|计算核密度估计|`geom_density()`|
|`stat_smooth`|添加平滑曲线或回归模型（如线性/LOESS）|`geom_smooth()`|
|`stat_summary`|对数据进行汇总（如均值、中位数）|`geom_pointrange()`|
|`stat_boxplot`|计算箱线图的五数概括（最小值、Q1、中位数等）|`geom_boxplot()`|
|`stat_contour`|生成等高线|`geom_contour()`|
|`stat_ecdf`|计算经验累积分布函数|`geom_step()`|
|`stat_qq` / `stat_qq_line`|计算 Q-Q 图的数据点或参考线|`geom_qq()` / `geom_qq_line()`|
|`stat_function`|根据数学函数生成曲线|`geom_function()`|
|`stat_sum`|计算分组总和|需手动指定 `geom`|

---

### 二、常见 stat 使用示例

### 1. `stat_smooth`（添加平滑曲线）

```r
ggplot(mpg, aes(displ, hwy)) +  geom_point() +  stat_smooth(method = "lm", formula = y ~ x, se = FALSE, color = "red")
```

- **功能**：添加线性回归线。
- **参数**：`method` 指定模型（如 `"lm"`, `"loess"`），`formula` 定义公式。

### 2. `stat_summary`（数据汇总）

```r
ggplot(mpg, aes(class, hwy)) +  stat_summary(fun = mean, geom = "bar", fill = "skyblue") +  stat_summary(fun.data = mean_se, geom = "errorbar", width = 0.2)
```

- **功能**：计算每类车的 `hwy` 均值并绘制条形图，添加误差线。

### 3. `stat_bin`（直方图分箱）

```r
ggplot(diamonds, aes(price)) +  geom_histogram(binwidth = 500, stat = "bin", fill = "blue")
```

- **等价简写**：直接使用 `geom_histogram(binwidth = 500)`。

### 4. `stat_count`（频数条形图）

```r
ggplot(mpg, aes(class)) +  stat_count(fill = "orange")  # 等价于 geom_bar()
```

### 5. `stat_contour`（等高线）

```r
ggplot(faithfuld, aes(eruptions, waiting, z = density)) +  stat_contour(geom = "contour", bins = 10)
```

---

### 三、如何查看所有 stat？

1. **查看文档**：运行 `?stat` 或浏览 [ggplot2官方文档](https://ggplot2.tidyverse.org/reference/#section-stats)。
    
2. **列出所有 stat**：
    
    ```r
    ls(pattern = "^stat_", env = asNamespace("ggplot2"))
    ```
    
    这会列出所有以 `stat_` 开头的函数。
    

---

### 四、注意事项

1. **stat 与 geom 的对应关系**：大多数 `geom_*` 函数有默认的 stat（如 `geom_histogram()` 默认使用 `stat_bin`）。
    
2. **手动覆盖 stat**：可通过 `stat` 参数指定不同的 stat：
    
    ```r
    geom_bar(stat = "identity")  # 直接使用原始值而非计数
    ```
    
3. **计算变量**：使用 `after_stat()` 访问 stat 生成的变量（如 `after_stat(count)`、`after_stat(density)`）。
    

---

通过灵活组合 stat 和 geom，可以高效实现复杂的数据可视化需求！

---

### 🧑‍💻 User

ggplot(mpg, aes(class, hwy)) + stat_summary(fun = mean, geom = “bar”, fill = “skyblue”) + stat_summary(fun.data = mean_se, geom = “errorbar”, width = 0.2)

为什么bar用fun而errorbar用fun.data?

---

### 🤖 Assistant

在 **ggplot2** 中，`stat_summary()` 的参数 `fun` 和 `fun.data` 的区别在于它们返回的统计量类型不同，而不同几何对象（`geom`）需要的数据结构也不同。以下是具体解释：

---

### **1. `fun` 与 `fun.data` 的区别**

- **`fun`**：
    
    用于生成 **单个值**（如均值、中位数）。例如，`fun = mean` 会为每组数据计算一个均值，作为几何对象的 **主要位置值**（如条形图的高度）。
    
- **`fun.data`**：
    
    用于生成 **多个值**（如均值 ± 标准误、置信区间）。例如，`fun.data = mean_se` 会返回一个包含 `y`（均值）、`ymin`（均值-标准误）、`ymax`（均值+标准误） 的数据框，适合需要 **范围信息** 的几何对象（如误差线）。
    

---

### **2. 为什么 `geom = "bar"` 用 `fun`，而 `geom = "errorbar"` 用 `fun.data`？**

- **对于条形图（`geom = "bar"`）**：
    
    只需要一个值（如均值）来确定条形的高度，因此使用 `fun = mean` 直接计算该值。
    
- **对于误差线（`geom = "errorbar"`）**：
    
    需要三个值：`y`（中心位置）、`ymin`（下限）、`ymax`（上限），因此必须使用 `fun.data = mean_se` 来提供这三个值。
    
    `mean_se()` 是一个内置函数，返回形如 `data.frame(y = mean, ymin = mean - se, ymax = mean + se)` 的结果。
    

---

### **3. 代码逐句解析**

```r
ggplot(mpg, aes(class, hwy)) +  # 绘制条形图：每组计算 hwy 的均值作为条形高度  stat_summary(
    fun = mean,            # 计算每组均值（单个值）    geom = "bar",          # 使用条形图    fill = "skyblue"  ) +  # 绘制误差线：每组计算均值和标准误范围  stat_summary(
    fun.data = mean_se,    # 计算均值、均值-标准误、均值+标准误（多个值）    geom = "errorbar",     # 使用误差线    width = 0.2            # 误差线宽度  )
```

---

### **4. 进一步验证**

- 如果强行用 `fun` 绘制误差线：
    
    ```r
    stat_summary(fun = mean, geom = "errorbar")
    ```
    
    **会报错**，因为 `geom_errorbar` 需要 `ymin` 和 `ymax`，但 `fun` 只返回一个值。
    
- 如果强行用 `fun.data` 绘制条形图：
    
    ```r
    stat_summary(fun.data = mean_se, geom = "bar")
    ```
    
    **会显示警告**，但会默认使用 `fun.data` 返回的 `y` 作为高度，而忽略 `ymin` 和 `ymax`。
    

---

### **5. 自定义函数示例**

- 用 `fun` 计算中位数：
    
    ```r
    stat_summary(fun = median, geom = "bar")
    ```
    
- 用 `fun.data` 自定义范围（如均值 ± 标准差）：
    
    ```r
    stat_summary(
      fun.data = function(x) {
        data.frame(
          y = mean(x),
          ymin = mean(x) - sd(x),
          ymax = mean(x) + sd(x)
        )
      },
      geom = "errorbar")
    ```
    

---

### **总结**

- **`fun`**：适合需要单个值的几何对象（如条形图、点图）。
- **`fun.data`**：适合需要多个值的几何对象（如误差线、带状图）。 通过这种设计，**ggplot2** 可以灵活适配不同几何对象的需求。

---

### 🧑‍💻 User

ggplot2中还有没有类似的用法？请你帮我总结

---

### 🤖 Assistant

在 **ggplot2** 中，类似 `stat_summary()` 中 `fun` 和 `fun.data` 的用法（根据输出值的结构选择参数）并不常见，但部分函数会通过不同参数实现类似逻辑。以下是总结：

---

### **1. 核心逻辑：`fun` vs `fun.data`**

- **`fun`**：返回 **单个值**（如均值、总和）。
- **fun.data**：返回 **多列数据**（如均值 ± 标准误）。
- **设计目的**：适配不同几何对象的需求（如条形图需要单值高度，误差线需要范围值）。

---

### **2. 类似用法的函数**

### **(1) `stat_summary_bin()`**

- **功能**：在分箱后对每组数据进行汇总。
    
- **参数**：与 `stat_summary()` 一致，使用 `fun` 和 `fun.data`。
    
    ```r
    ggplot(data, aes(x, y)) +  stat_summary_bin(
        fun = mean,          # 单值汇总    geom = "bar"  ) +  stat_summary_bin(
        fun.data = mean_se,  # 多值范围    geom = "errorbar"  )
    ```
    

### **(2) `stat_interval()`（需加载扩展包，如 `ggdist`）**

- **功能**：计算区间范围（如置信区间）。
    
- **参数**：通过 `point_interval` 指定单值（如中位数）和区间（如分位数）。
    
    ```r
    # 需安装 ggdistggdist::stat_interval(
      aes(y = value),
      point_interval = ggdist::median_qi  # 返回中位数 + 分位区间)
    ```
    

### **(3) `stat_density()` 中的 `density` 计算**

- **参数**：`stat(density)` 生成密度值，可通过 `after_stat()` 访问多列结果（如 `density` 和 `count`）。
    
    ```r
    ggplot(data, aes(x)) +  geom_density(aes(y = after_stat(density)))  # 单值  # 或  geom_density(aes(ymin = 0, ymax = after_stat(density)))  # 范围值（需特定几何对象）
    ```
    

---

### **3. 其他参数设计中的类似逻辑**

### **(1) `geom_smooth()` 的 `method` 和 `formula`**

- **逻辑**：不同模型（如线性回归 `lm`、LOESS）需要不同的参数组合。
    
    ```r
    ggplot(data, aes(x, y)) +  geom_smooth(
        method = "lm",          # 单模型    formula = y ~ poly(x, 2)  # 多参数公式  )
    ```
    

### **(2) `stat_bin()` 的 `binwidth` vs `bins`**

- **逻辑**：分箱时，用户可选择直接指定箱宽（`binwidth`，单值）或箱数（`bins`，单值），但底层计算会生成多值（如区间范围、频数）。
    
    ```r
    ggplot(data, aes(x)) +  geom_histogram(binwidth = 10)  # 单值参数  # 或  geom_histogram(bins = 30)      # 单值参数
    ```
    

### **(3) `stat_contour()` 的 `breaks`**

- **逻辑**：通过单值（`bins`）或多值（`breaks`）指定等高线层级。
    
    ```r
    ggplot(faithfuld, aes(eruptions, waiting, z = density)) +  stat_contour(breaks = seq(0, 0.04, by = 0.01))  # 多值参数
    ```
    

---

### **4. 通用规则**

- **单值输出**：参数名通常直接关联值类型（如 `fun`, `binwidth`, `bins`）。
- **多值输出**：参数名可能包含 `.data` 或关联数据结构（如 `fun.data`, `point_interval`）。
- **访问计算结果**：使用 `after_stat()` 引用 stat 生成的变量（如 `after_stat(density)`）。

---

### **5. 总结**

- **主要场景**：`stat_summary()` 及其变体（如 `stat_summary_bin`）是典型示例。
- **扩展场景**：部分函数通过不同参数适配单值或多值需求（如分箱、密度计算）。
- **灵活技巧**：通过 `after_stat()` 和自定义函数实现复杂需求。

如果需要更高级的灵活计算，可以结合 **dplyr** 预处理数据或编写自定义统计函数。

---

### 🧑‍💻 User

对于ggplot2中 after_stat 的用法，请你帮我解释一下

---

### 🤖 Assistant

在 **ggplot2** 中，`after_stat()` 是一个用于访问 **统计变换（stat）生成的新变量** 的关键函数。它允许你在美学映射（`aes()`）中直接引用 stat 计算后的结果（如密度、分箱计数、回归模型的拟合值等），而不是原始数据中的变量。

以下是详细解释和用法示例：

---

### **1. 核心作用**

- **统计变换（stat）** 会对原始数据进行计算（如分箱、汇总、拟合等），并生成新的变量（例如 `count`、`density`、`prop` 等）。
- **`after_stat()`** 的作用是在美学映射阶段（`aes()` 内部）引用这些 stat 生成的新变量，而不是原始数据中的列。

---

### **2. 基本语法**

```r
aes(y = after_stat(<新变量名>))
```

---

### **3. 常见场景及示例**

### **(1) 直方图：从计数（count）切换到密度（density）**

默认情况下，`geom_histogram()` 的 y 轴是分箱计数（`count`），但你可以用 `after_stat()` 切换为密度（`density`）：

```r
ggplot(diamonds, aes(price)) +  geom_histogram(aes(y = after_stat(density)), binwidth = 500)
```

- **关键点**：`density` 是 `stat_bin()` 生成的变量。

### **(2) 密度曲线：同时显示密度和原始值**

```r
ggplot(diamonds, aes(price)) +  geom_density(aes(y = after_stat(scaled)))  # scaled 是归一化的密度值
```

### **(3) 分面直方图：显示比例（比例 = 组内计数 / 总计数）**

```r
ggplot(diamonds, aes(price)) +  geom_histogram(aes(y = after_stat(count / sum(count))), binwidth = 500)
```

### **(4) 箱线图：引用分位数变量**

```r
ggplot(mpg, aes(class, hwy)) +  geom_boxplot(aes(
    lower = after_stat(ymin),    # 下须    upper = after_stat(ymax),    # 上须    middle = after_stat(middle), # 中位数    ymin = after_stat(ymin_lwr), # 箱体下限（Q1）    ymax = after_stat(ymax_upr)  # 箱体上限（Q3）  ))
```

---

### **4. 支持的变量**

不同的 stat 会生成不同的变量。以下是一些常见 stat 生成的关键变量：

|**Stat 类型**|**生成变量**|**示例**|
|---|---|---|
|`stat_bin`|`count`, `density`, `ncount`, `ndensity`|直方图分箱后的计数/密度|
|`stat_density`|`density`, `count`, `scaled`|密度曲线的密度值|
|`stat_sum`|`n` (观测数), `prop` (组内比例)|分组汇总后的比例|
|`stat_ecdf`|`ecdf` (经验累积分布值)|累积分布曲线的值|
|`stat_contour`|`level` (等高线层级)|等高线的高度值|
|`stat_qq`|`sample` (样本分位数), `theoretical` (理论分位数)|Q-Q 图的坐标点|

---

### **5. 动态组合变量**

可以在 `after_stat()` 中对变量进行数学运算：

```r
# 直方图中同时显示计数和密度ggplot(diamonds, aes(price)) +  geom_histogram(
    aes(
      y = after_stat(count),          # 原始计数      y2 = after_stat(density) * 1e4  # 密度缩放后叠加    ),
    binwidth = 500  )
```

---

### **6. 与 `after_scale()` 和 `after_position()` 的区别**

- **`after_stat()`**：引用 **stat 计算后的变量**（如 `count`, `density`）。
- **`after_scale()`**：引用 **图形渲染后的美学属性**（如颜色、线宽的最终值）。
- **`after_position()`**：引用 **坐标变换后的位置**（如极坐标转换后的位置）。

---

### **7. 注意事项**

1. **作用域限制**：`after_stat()` 只能在 `aes()` 内部使用，且只能引用当前 stat 生成的变量。
2. **变量存在性**：如果引用了不存在的变量（例如拼写错误），ggplot2 会抛出警告。
3. **优先级**：如果变量名同时存在于原始数据和 stat 计算结果中，`after_stat()` 会优先使用 stat 的结果。

---

### **8. 调试技巧**

若不确定 stat 生成了哪些变量，可以用 `stat()` 的 `geom = "debug"` 查看：

```r
ggplot(diamonds, aes(price)) +  geom_histogram(stat = "bin", geom = "debug")
# 输出所有 stat 生成的变量名和示例值
```

---

通过 `after_stat()`，你可以更灵活地控制如何将统计变换的结果映射到图形属性中，从而创建更复杂和定制化的可视化效果！

---

### 🧑‍💻 User

请你帮我详细总结 after_stat、after_scale、after_position 之后出现的新变量，我希望深入学习

---

### 🤖 Assistant

在 **ggplot2** 中，`after_stat()`、`after_scale()` 和 `after_position()` 是用于动态访问 **不同阶段计算后的变量** 的关键函数。它们允许你在美学映射（`aes()`）中引用统计变换、图形渲染或坐标变换后的结果。以下是它们的详细对比和用法示例：

---

### **一、`after_stat()`：统计变换后的变量**

### **作用阶段**

在 **统计变换（stat）** 之后，访问由 stat 计算生成的新变量（如分箱计数、密度、回归拟合值等）。

### **常用变量**

不同 stat 会生成不同变量，以下是一些常见变量：

|**Stat 类型**|**生成变量**|**示例**|
|---|---|---|
|`stat_bin`|`count`（计数）, `density`（密度）|直方图的分箱结果|
|`stat_density`|`density`（密度）, `scaled`（归一化密度）|核密度曲线|
|`stat_summary`|`y`（汇总值）, `ymin/ymax`（范围）|均值 ± 标准误|
|`stat_ecdf`|`ecdf`（经验累积分布值）|累积分布曲线|
|`stat_contour`|`level`（等高线层级）|等高线的高度|
|`stat_qq`|`sample`（样本分位数）, `theoretical`（理论分位数）|Q-Q 图的坐标点|

### **示例**

```r
# 直方图显示密度而非计数ggplot(diamonds, aes(price)) +  geom_histogram(aes(y = after_stat(density)), binwidth = 500)
# 箱线图引用分位数变量ggplot(mpg, aes(class, hwy)) +  geom_boxplot(aes(
    lower = after_stat(ymin),    # 下须    upper = after_stat(ymax),    # 上须    middle = after_stat(middle)  # 中位数  ))
```

---

### **二、`after_scale()`：图形渲染后的变量**

### **作用阶段**

在 **图形渲染（scale）** 之后，访问经过标度（颜色、大小、坐标轴）转换后的最终属性值。

### **常用变量**

- 所有 **美学属性**（如 `colour`、`fill`、`size`、`alpha`）的最终值。
- 基于渲染后的属性计算的衍生值（如颜色亮度、半透明度）。

### **示例**

```r
# 根据颜色明度动态调整文本颜色（深色用白字，浅色用黑字）ggplot(mpg, aes(displ, hwy, color = class)) +  geom_point(size = 3) +  geom_text(
    aes(label = class, color = after_scale(ifelse(luminance > 0.5, "black", "white"))),
    show.legend = FALSE  )
# 根据线宽动态调整透明度ggplot(economics, aes(date, unemploy)) +  geom_line(aes(alpha = after_scale(1 / size)), size = 2)
```

---

### **三、`after_position()`：坐标变换后的变量**

### **作用阶段**

在 **坐标变换（如极坐标、对数坐标）** 之后，访问变换后的位置坐标（如极坐标中的角度和半径）。

### **常用变量**

- `x` 和 `y`：坐标变换后的最终位置。
- 其他坐标系相关的变量（如极坐标的 `theta` 和 `r`）。

### **示例**

```r
# 极坐标中调整标签位置（避免重叠）ggplot(mpg, aes(factor(cyl), fill = class)) +  geom_bar(width = 1) +  coord_polar() +  geom_text(
    aes(label = class, x = after_position(x), y = after_position(y)),
    stat = "count",
    position = position_stack(vjust = 0.5)
  )
# 对数坐标中动态调整标签位置ggplot(msleep, aes(bodywt, brainwt)) +  geom_point() +  scale_x_log10() +  geom_text(
    aes(label = name, x = after_position(x), y = after_position(y)),
    data = ~ subset(., bodywt > 100)
  )
```

---

### **四、三者的核心区别**

|**函数**|**作用阶段**|**典型用途**|
|---|---|---|
|`after_stat()`|统计变换后|访问分箱计数、密度、汇总值等|
|`after_scale()`|图形渲染后|动态调整颜色、大小、透明度等渲染属性|
|`after_position()`|坐标变换后|极坐标、对数坐标等变换后的位置调整|

---

### **五、高级用法：组合使用**

```r
# 组合 after_stat 和 after_scale：在直方图中动态调整颜色亮度ggplot(diamonds, aes(price)) +  geom_histogram(
    aes(fill = after_stat(count), alpha = after_scale(fill)),
    binwidth = 500  ) +  scale_fill_viridis_c()
# 组合 after_stat 和 after_position：极坐标中动态调整标签角度ggplot(mpg, aes(factor(cyl))) +  geom_bar() +  coord_polar() +  geom_text(
    aes(
      label = after_stat(count),
      angle = after_position(atan2(y, x) * 180 / pi)  # 计算极坐标角度    ),
    stat = "count",
    position = position_stack(vjust = 0.5)
  )
```

---

### **六、调试技巧**

1. **查看 stat 生成的变量**：
    
    用 `geom = "debug"` 输出 stat 生成的所有变量：
    
    ```r
    ggplot(diamonds, aes(price)) +  geom_histogram(stat = "bin", geom = "debug")
    ```
    
2. **查看渲染后的属性**：
    
    在控制台打印 `after_scale` 的值：
    
    ```r
    ggplot(mpg, aes(displ, hwy)) +  geom_point(aes(color = after_scale({
        print(colour)
        colour
      })))
    ```
    

---

### **七、注意事项**

1. **变量作用域**：
    
    - `after_stat()` 只能访问当前图层 stat 生成的变量。
    - `after_scale()` 和 `after_position()` 可以跨图层访问全局属性。
2. **性能影响**：
    
    复杂计算（如动态调整大量元素的颜色）可能影响渲染速度。
    
3. **兼容性**：
    
    `after_*` 函数在 ggplot2 v3.3.0+ 中全面支持，旧版本需升级。
    

---

通过灵活使用 `after_stat()`、`after_scale()` 和 `after_position()`，可以实现高度动态化和复杂的数据可视化效果！

---

### 🧑‍💻 User

在进行统计变换时，它的作用对象是谁？某个特定的映射吗？

---

### 🤖 Assistant

在 **ggplot2** 中，统计变换（stat）的作用对象是 **数据**，但其处理逻辑会根据 **映射（aes）中的变量** 和 **分组结构（group/facet）** 动态调整。以下是详细解释：

---

### **一、统计变换的作用对象**

统计变换的核心是对 **数据** 进行某种计算（如分箱、汇总、拟合等），但具体处理哪些变量、如何分组，取决于以下因素：

|**因素**|**说明**|
|---|---|
|**映射变量**|通过 `aes()` 指定的变量（如 `x`、`y`、`color` 等）会直接影响统计变换的逻辑。|
|**分组结构**|通过 `group` 或分面（`facet_*`）定义的子数据集，统计变换会在每组内独立计算。|
|**统计变换类型**|不同 stat 有默认处理的目标变量（如 `stat_bin` 默认处理 `x` 或 `y`）。|

---

### **二、统计变换与映射变量的关系**

### **1. 核心映射变量**

统计变换通常针对 `aes()` 中的 **位置映射变量**（`x` 或 `y`）进行计算：

- **示例1**：`stat_bin`（直方图）默认处理 `x` 变量，生成 `count` 或 `density`。 `r ggplot(diamonds, aes(price)) + geom_histogram() # stat_bin 处理` price`（即 x 映射）`
    
- **示例2**：`stat_boxplot`（箱线图）需要 `y` 变量来计算分位数。
    
    ```r
    ggplot(mpg, aes(class, hwy)) +  geom_boxplot()  # stat_boxplot 处理 `hwy`（即 y 映射）
    ```
    

### **2. 分组变量**

通过 `color`、`fill`、`group` 等映射定义的变量会将数据分组，统计变换会在 **每组内独立计算**：

```r
ggplot(mpg, aes(displ, hwy, color = class)) +  geom_smooth(method = "lm")  # 对每个 `class` 分组拟合线性模型
```

### **3. 分面变量**

分面（`facet_wrap`/`facet_grid`）会将数据分割为多个子集，统计变换在每个子集内独立运行：

```r
ggplot(mpg, aes(displ, hwy)) +  geom_point() +  geom_smooth(method = "lm") +  # 每个分面子集独立拟合模型  facet_wrap(~ class)
```

---

### **三、不同统计变换的核心处理逻辑**

以下是常见统计变换的作用对象和规则：

|**Stat 类型**|**默认处理变量**|**分组规则**|**输出变量**|
|---|---|---|---|
|`stat_bin`|`x` 或 `y`|按 `group`/`color` 分组分箱|`count`, `density`|
|`stat_summary`|`y`|按 `x` 分组计算汇总统计量|`y`, `ymin`, `ymax`|
|`stat_smooth`|`x` 和 `y`|按 `group`/`color` 分组拟合模型|`y`, `ymin`, `ymax`（置信区间）|
|`stat_boxplot`|`y`|按 `x` 分组计算五数概括|`lower`, `upper`, `middle`|
|`stat_density`|`x`|按 `group`/`color` 分组计算密度|`density`, `count`|
|`stat_contour`|`z`（通过 `aes(z)` 指定）|无分组，全局计算等高线|`level`|

---

### **四、如何手动控制统计变换的作用对象？**

### **1. 显式指定映射变量**

在 `aes()` 中明确变量，或通过 `stat()` 参数覆盖：

```r
# 直方图处理 y 变量（而非默认的 x）ggplot(diamonds, aes(y = price)) +  geom_histogram()
# 手动指定 stat_smooth 的公式变量ggplot(mpg, aes(displ, hwy)) +  stat_smooth(aes(x = displ, y = hwy), method = "lm")
```

### **2. 强制忽略分组**

使用 `group = 1` 或 `inherit.aes = FALSE` 全局计算：

```r
# 全局密度曲线（忽略分组）ggplot(mpg, aes(displ, color = class)) +  geom_density(aes(group = 1))  # 所有数据合并计算# 独立于映射的 statggplot(mpg, aes(displ, hwy)) +  stat_summary(
    aes(x = 1, y = hwy),  # 覆盖 x 映射，全局汇总    fun = mean,
    geom = "point"  )
```

---

### **五、总结**

- **作用对象**：统计变换处理的是 **数据**，但具体操作由映射变量（`x`、`y`、`group` 等）和分组结构决定。
- **核心规则**：
    - 每个 stat 有默认处理的变量（如 `x` 或 `y`）。
    - 分组变量（`color`、`fill`、`facet` 等）会将数据拆分为子集，统计变换在各子集内独立计算。
- **灵活控制**：通过 `aes()` 和 `stat()` 参数，可以手动指定处理的目标变量和分组方式。

通过理解这些规则，可以更精准地定制统计变换的逻辑，满足复杂可视化需求！