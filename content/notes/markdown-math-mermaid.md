---
title: 用 Markdown 记录公式、流程与笔记关联
description: 一份可直接在 Obsidian 中使用的公式、Mermaid 流程图和双链示例。
date: 2026-09-30
modified: 2026-09-30
tags:
  - Markdown
  - LaTeX
  - Obsidian
category: 写作与效率工具
type: article
featured: false
publish: true
draft: false
---
技术笔记通常同时包含文字、公式和步骤。把它们留在同一份 Markdown 中，后续修改和检索会更方便。

## 行内公式与独立公式

行内公式使用一对美元符号，例如 `$a^2+b^2=c^2$`，显示为 $a^2+b^2=c^2$。

独立公式用两对美元符号包裹：

```latex
$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n}x_i
$$
```

$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n}x_i
$$

这里的 $n$ 是观测数量，$x_i$ 是第 $i$ 个观测值。Markdown 中的数学渲染器只实现部分 LaTeX 功能，复杂宏包写法需要另外核实。

## 用 Mermaid 表达步骤

把以下内容放入标记为 `mermaid` 的代码块：

```text
flowchart LR
    A[记录问题] --> B[整理步骤]
    B --> C[运行示例]
    C --> D[补充参考]
    D --> E[发布笔记]
```

渲染后得到下面的流程图：

```mermaid
flowchart LR
    A[记录问题] --> B[整理步骤]
    B --> C[运行示例]
    C --> D[补充参考]
    D --> E[发布笔记]
```

流程图适合表达步骤与分支；展示数组和数值时，使用表格或实际绘图更直接，例如 [[notes/numpy-reshape|理解 NumPy reshape：形状改变，元素如何排列]] 中的示例。

## 双链与提示块

在 Obsidian 中，`[[NumPy 数组重塑]]` 可引用另一篇笔记。链接是否能在网站打开，取决于目标笔记是否一同发布。

> [!tip] 让读者知道下一步
> 为每篇笔记补一两个相关链接，说明它与当前内容的关系，比堆放大量“相关阅读”更有用。

更多语法可查阅 [Obsidian 官方帮助](https://help.obsidian.md/syntax) 和 [Mermaid 流程图文档](https://mermaid.js.org/syntax/flowchart.html)。本篇根据原有 LaTeX 与 Mermaid 学习笔记重新整理。
