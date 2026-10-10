# a1ertx5s 的博客

基于 [Astro](https://astro.build) 的个人博客，托管在 [GitHub Pages](https://pages.github.com)。

- 博客文章：`src/content/blog/*.md`
- 读书笔记（导入的文档）：`src/content/notes/*.md`
- 站点配置（标题 / 描述 / 域名）：`src/consts.ts` 与 `astro.config.mjs`

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 输出到 dist/
npm run preview  # 预览构建结果
```

## 写一篇文章

1. 在 `src/content/blog/` 新建 `my-post.md`：

```markdown
---
title: '标题'
description: '一句话摘要，会显示在列表和 RSS 里'
pubDate: '2026-10-10'
tags: ['随笔']
---

正文……（`<!--more-->` 之前是摘要）
```

2. 提交并推送：

```bash
git add . && git commit -m "post: 标题" && git push
```

GitHub Actions 会自动构建并部署到 Pages。

## 读书笔记（划线批注）

`/notes` 是读书笔记模块：导入一份长文档，直接在正文上划线、写批注。

### 加一本书

在 `src/content/notes/` 新建 Markdown 文件：

```markdown
---
title: '论语 · 学而篇 选读'
author: '孔子及其弟子'
source: '《论语》'
kind: book          # book / article / paper / document
status: reading     # reading / done / paused
progress: 45        # 0–100，显示为进度条
importedDate: '2026-10-08'
---

正文用 Markdown 写，怎么方便怎么来。
```

推送后会自动出现在 <https://a1ertx5s.github.io/notes/>。

### 批注是怎么存的

批注默认存在**浏览器 localStorage**，键为 `annotation:<文档 id>`。每条批注记录：

| 字段 | 作用 |
| :-- | :-- |
| `quote` | 被划线的原文（W3C TextQuoteSelector 的 exact） |
| `prefix` / `suffix` | 前后各 40 字上下文，用于消歧 |
| `start` / `end` | 纯文本偏移量，仅作提示 |
| `note` | 你写的批注 |
| `color` | `yellow` / `green` / `blue` / `pink` |

页面加载时按 **quote 精确匹配 → 多命中则用 prefix/suffix + 偏移量打分** 的顺序重新定位，
所以文档小改之后批注通常还能自动归位；实在找不到的会标记为孤儿而不会错位。

### 让批注跨设备

localStorage 只在本机。三种迁移方式：

1. 侧栏「导出 JSON」→ 在新设备「导入 JSON」；
2. 把导出的 JSON 放到 `public/annotations/<文档 id>.json`，提交推送后，任何人打开这一页都会带上这些批注（见 `public/annotations/lunyu-xueer.json` 示例）；
3. 「导出 Markdown」把批注整理成一篇可读的笔记。

### 导入临时文档

<https://a1ertx5s.github.io/notes/import/> 支持粘贴 Markdown / 纯文本，或直接拖一个 `.md`/`.txt`
文件进去，立刻就能划线和批注（内置一个极简 Markdown 渲染器，无第三方依赖）。
这类文档只存在于浏览器里，确认值得留下来再用「导出 Markdown」存回仓库。

## 部署

仓库 `a1ertx5s.github.io` 的 `main` 分支推送到 GitHub Actions 自动构建，
站点地址：<https://a1ertx5s.github.io/>。

> 如果改用普通仓库名（例如 `blog`），需要同时修改两处：
> `astro.config.mjs` 里的 `site` 保持不变，另加 `base: '/blog'`，
> 并把 `src/consts.ts` 里的 `SITE_BASE` 改为 `'/blog'`。

## Credit

主题基于 [Bear Blog](https://github.com/HermanMartinus/bearblog/) 的默认样式，使用 Astro 官方 blog 模板改造。
