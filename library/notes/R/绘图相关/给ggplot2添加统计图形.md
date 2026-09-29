---
date created: Tuesday, November 19th 2024, 9:45:54 pm
date modified: Sunday, November 24th 2024, 11:44:23 pm
---
目前可以灵活添加的工具有 `ggpubr` 中的 `stat_pvalue_manual` 函数，以及 `ggprism` 中的 `add_pvalue` 函数，后者是对前者的重写。

仔细阅读：[How to Add P-Values onto a Grouped GGPLOT using the GGPUBR R Package - Datanovia](https://www.datanovia.com/en/blog/how-to-add-p-values-onto-a-grouped-ggplot-using-the-ggpubr-r-package/)

一个完整的例子：

```r
library(ggpubr)
library(rstatix)
library(tidyplots)

# Transform `dose` into factor variable
df <- ToothGrowth
df$dose <- as.factor(df$dose)
head(df, 3)

stat.test <- stat.test <- df %>%
  group_by(dose) %>%
  t_test(len ~ supp) %>%
  add_xy_position(x = "dose", dodge = 0.8)
  
stat.test2 <- df %>%
  t_test(len ~ dose) %>% 
  add_xy_position(x = "dose")

stat.test3 <- df %>%
  group_by(supp) |> 
  t_test(len ~ dose) %>% 
  add_xy_position(x = "dose", group = 'supp')

ggplot(df, aes(x = dose, y = len, color = supp)) +
  geom_boxplot() +
  stat_pvalue_manual(
    stat.test,  label = "p", tip.length = 0
  ) +
  stat_pvalue_manual(
    stat.test2,  label = "p", tip.length = 0.02,
    step.increase = 0.05
  ) +
  stat_pvalue_manual(
    stat.test3,  label = "p", tip.length = 0.02,
    step.increase = 0.05, step.group.by = 'supp',color = 'supp'
  )
```

有的时候，会报告错误，**无法找到某个变量**，这时需要将除了 x 和 y 以外的映射，移动到各个组间图层中去，即可解决。
见讨论：

[r - Error with adding p-values using stat\_pvalue\_manual into a ggplot - Stack Overflow](https://stackoverflow.com/questions/77146429/error-with-adding-p-values-using-stat-pvalue-manual-into-a-ggplot)

[Possible to use stat\_pvalue\_manual() with dodged bar chart? · Issue #104 · kassambara/ggpubr · GitHub](https://github.com/kassambara/ggpubr/issues/104)

对于分组 ggplot 2 图，准备 `stat_pvalue_manual` 的统计结果时有三种情况：

- 使用 x 轴变量分组，对各个组内的亚组（color 或 fill 映射）统计
	- `add_xy_position`: 添加 ` doge ` 参数： ` add_xy_position(x = "dose", dodge = 0.8) `
- 使用亚组分组（color 或 fill 映射），并对 x 轴分组变量进行统计（跨 x 轴）：
	- `add_xy_position`: 添加 `group` 参数，其中 `group` 使用亚组变量（color 或 fill 映射），以调整不同亚组的比较时，横线的位置（也可以不调整）
	- `stat_pvalue_manual`：如果需要对不同亚组的比较进行颜色区分，可以添加 `color` 参数和 `step.group.by` 参数，传入值为亚组分组因子；添加 `step.increase` 参数，以避免交错
- 仅在 x 轴分组变量上统计：
	- `add_xy_position`: 只需要`x` 参数即可

