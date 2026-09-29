# Howard 的技术笔记

中文技术博客，使用 Quartz 5，部署到 GitHub Pages。

- 网站：[Howard 的技术笔记](https://leiguo0812.github.io/howard-notes/)
- 正文来源：个人 Obsidian 库中专门整理的“博客发布”目录。
- 本仓库只保存公开文章、被引用的附件及网站源码。完整笔记库和它的历史不会上传。
- 框架来源：Quartz commit `97a2d05f80c4c50534959b1d0d41cc4b3895625e`，依赖版本由 `package-lock.json` 固定。

## 安装与预览

使用 Node.js 24 或更新版本，npm 至少 10.9.2。

```bash
npm ci
npm run build
npm run dev
```

预览地址为 `http://localhost:8080/howard-notes/`。正式构建生成在 `public/`。

Windows / WSL 用户应在同一套运行环境中使用 Node、npm 和项目目录；避免 Windows npm 在 WSL UNC 路径中执行安装脚本。

## 发布一篇文章

在 Obsidian 的“博客发布”目录编辑公开版本，使用以下属性：

```yaml
---
title: 文章标题
description: 一句话概括解决的问题。
date: 2026-09-30
publish: true
draft: false
permalink: notes/example-title
category: Python 与数据分析
type: article
featured: false
tags: [Python]
---
```

`date` 是首次公开日期，更新文章时保持不变；可用 `modified` 记录修改日期。`permalink` 固定，文件改名不改变文章网址。只有布尔值 `publish: true` 且 `draft: false` 同时成立才导出。

先查看导出清单，再生成公开副本：

```bash
npm run export -- --source "/path/to/vault/博客发布" --dry-run
npm run export -- --source "/path/to/vault/博客发布"
npm run test:publish
npm run build
npm run verify:site
```

也可在本地设置 `OBSIDIAN_PUBLISH_DIR`，之后直接执行 `npm run export`。不要把本地路径或任何凭据写入提交。

检查改动后提交并推送 `main`。GitHub Actions 会先测试导出边界、检查 TypeScript、构建及检查内部链接，再部署 Pages；失败时保留上一版部署。

```bash
git status --short
git add content
git commit -m "Update published notes"
git push origin HEAD:main
```

如果也修改了首页配置或专题页面，请一同提交对应文件。首页精选与最近发布自动读取文章属性；专题阅读顺序目前在 `site/topics.md` 维护。

## 附件、双链与撤下

- 标准 Markdown 图片使用相对地址，如 `![说明](assets/figure.png)`。导出时只复制实际引用的附件，并使用内容哈希命名。
- Wikilinks 转换为稳定网址；同名歧义、缺失笔记、未发布目标会让导出停止。代码示例中的双链不处理。
- 原库中的私人字段、HTML 注释与 Obsidian 注释不写入公开副本。仍需在首次公开前检查正文内容。
- 取消公开时设 `publish: false`，处理其他文章和 `site/topics.md` 对它的链接，再运行导出、构建、验证与推送。
- 导出清单记录工具管理的文件，撤下时只清理这些文件。公开过的 Git 提交历史不会因此删除。
- 当前导出器处理标准 Markdown 附件与笔记双链。Canvas、Dataview、插件代码块和附件 Wikilinks 需要先转换为标准 Markdown；遇到不支持的引用会停止而不是扩大导出范围。

## 目录

| 目录                         | 用途                               |
| ---------------------------- | ---------------------------------- |
| `content/`                   | 生成的公开内容，不直接编辑文章正文 |
| `site/`                      | 首页、关于与专题等网站页面的源文件 |
| `scripts/`                   | 导出、图片复现、边界测试和站点验证 |
| `quartz/components/Blog.tsx` | 博客首页、导航与阅读布局           |
| `quartz/styles/custom.scss`  | 中文排版、移动端与亮暗主题         |
| `quartz.config.yaml`         | 插件、站点地址与主题配置           |

两张文章示例图片可用 `scripts/generate-figures.py` 复现，需要 NumPy、Matplotlib 和一种中文字体。首次生成环境：Python 3.10、NumPy 2.2.6、Matplotlib 3.10.9、WenQuanYi Zen Hei。

站点首次测试包含 5 篇文章。Docker 命令按官方文档整理，未在本机实际启动 Docker；NumPy 与绘图示例已本地运行。上游框架沿用 MIT 许可，见 `LICENSE.txt`；文章与图片未额外授予开放许可。
