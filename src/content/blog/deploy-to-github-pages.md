---
title: '用 Astro + GitHub Pages 搭一个零成本的个人博客'
description: '从零开始：本地建站、推到 GitHub、用 Actions 自动部署到 Pages。'
pubDate: '2026-10-09'
tags: ['教程', 'Astro', 'GitHub Pages']
---

GitHub Pages 是目前最省心的静态托管方案之一：免费、带 HTTPS、直接从仓库发布。这篇文章记录我把它和 **Astro** 组合起来的完整流程。

<!--more-->

## 1. 初始化项目

```bash
npm create astro@latest my-blog -- --template blog
cd my-blog && npm install
```

Astro 默认输出纯静态 HTML，没有运行时框架开销，特别适合博客。

## 2. 配置站点域名

在 `astro.config.mjs` 里填上你最终的访问地址，这会影响 RSS、sitemap 和 OG 标签：

```js
export default defineConfig({
  site: 'https://a1ertx5s.github.io',
});
```

> 如果仓库名不是 `用户名.github.io`，还要加上 `base: '/仓库名'`，否则线上样式会全部 404。

## 3. 用 GitHub Actions 自动部署

仓库里放一个 workflow，每次 push 到 `main` 自动构建：

```yaml
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

## 4. 写作流程

写完一篇，剩下的是：

```bash
git add .
git commit -m "post: 标题"
git push
```

一分钟之内，文章就会出现在线上。**这就是「拥有一个博客」的全部成本。**
