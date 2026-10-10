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

## 部署

仓库 `a1ertx5s.github.io` 的 `main` 分支推送到 GitHub Actions 自动构建，
站点地址：<https://a1ertx5s.github.io/>。

> 如果改用普通仓库名（例如 `blog`），需要同时修改两处：
> `astro.config.mjs` 里的 `site` 保持不变，另加 `base: '/blog'`，
> 并把 `src/consts.ts` 里的 `SITE_BASE` 改为 `'/blog'`。

## Credit

主题基于 [Bear Blog](https://github.com/HermanMartinus/bearblog/) 的默认样式，使用 Astro 官方 blog 模板改造。
