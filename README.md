# a1ertx5s 的博客

基于 [Astro](https://astro.build) 的个人博客 + 文库，托管在 [GitHub Pages](https://pages.github.com)。

- 博客文章：`src/content/blog/*.md`
- 文库（原文 + 批注）：`src/content/notes/*.md`
- 站点配置（标题 / 描述 / 域名）：`src/consts.ts` 与 `astro.config.mjs`

**全部内容都在代码里**：正文是 Markdown，批注写在文件 frontmatter 里，构建时就渲染进 HTML。
线上页面是纯静态、只读的，没有任何客户端 JS。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 输出到 dist/
npm run preview  # 预览构建结果
```

## 写一篇文章

在 `src/content/blog/` 新建 `my-post.md`：

```markdown
---
title: '标题'
description: '一句话摘要，会显示在列表和 RSS 里'
pubDate: '2026-10-10'
tags: ['随笔']
---

正文……
```

## 文库：原文 + 批注

`/notes` 是文库。正文和批注都随仓库提交，页面只读。

### 加一篇原文

在 `src/content/notes/` 新建 Markdown 文件：

```markdown
---
title: '论语 · 学而篇 选读'
author: '孔子及其弟子'
source: '《论语》'          # 可选，原文地址
sourceLabel: '原文'          # 可选，链接显示名
kind: book                   # book / article / paper / document
status: reading              # reading / done / paused
progress: 45                 # 0–100，显示为进度条
group: '古籍'                # 可选，列表归组
groupOrder: 1                # 可选，组的排序
order: 1                     # 可选，组内排序
importedDate: '2026-10-08'
---

正文用 Markdown 写。
```

### 加一条批注

批注写在同一个文件的 frontmatter 里，`quote` 是你要划线的原文（必须和正文逐字一致）：

```markdown
annotations:
  - quote: '学而时习之，不亦说乎？'
    color: yellow            # yellow / green / blue / pink
    note: '「习」不是复习，是练习、践行。'
  - quote: '吾日三省吾身'
    color: green
    note: '三省的三件事……'
```

构建时会：

- 把 `quote` 在正文里定位并包成 `<mark class="hl">`；
- 在该条批注的**最后一段**后面插入一个上标链接，指向页面右侧的批注列表；
- 定位不到的批注会打印 `[annotate] 找不到引文：…` 警告并跳过，**不会**错位到别处。

批注也支持放在同名的 `xxx.annotations.json` 里（结构 `{ "annotations": [...] }`），
适合批注很多、不想让 frontmatter 太长的场景。

### 锚定是怎么做的

`src/lib/quote-anchor.ts` 只做一件事：在一段纯文本里定位引文。先精确匹配 `quote`，
如果同一句话在文中出现多次，就用前后文（`prefix` / `suffix`）的吻合度打分，
再用记录下来的偏移量做兜底。所以正文有增删时，批注通常还能自动找回原位。

**跨行内格式也能匹配**：`quote` 写成 `profile 是存放在 Harness home 中的具名组装`，
即使原文里 `profile` 被 `**` 加粗成了独立的 `<strong>` 节点，也会被正确切成
多个 `<mark>` 片段（只在第一段挂 `id`，上标只出现在最后一段）。

### 实现位置

| 文件 | 作用 |
| :-- | :-- |
| `src/lib/quote-anchor.ts` | 引文定位（纯字符串，无依赖） |
| `src/lib/rehype-annotate.ts` | rehype 插件：遍历 hast，把引文套成 `<mark>` |
| `src/pages/notes/[...slug].astro` | 阅读页：正文 + 右侧批注列表 |
| `src/pages/notes/index.astro` | 文库列表，按 `group` 归组 |

> Astro 7 默认的 Sätteri 处理器用 Rust/napi 的访问器 API，写这类插件很别扭；
> `astro.config.mjs` 里换回了经典的 remark/rehype 管线（`@astrojs/markdown-remark`），
> 批注插件挂在 `markdown.processor: unified({ rehypePlugins: [rehypeAnnotate] })`。

### 已归档的文档

`src/content/notes/dsh-ref-*.md` 是从
<https://deepseek-harness.github.io/deepseek-harness/reference> 抓下来的 68 篇中文文档
（用站点自带的「URL + `.md`」原始 Markdown 接口，站内互链已改写到本站对应页面）。

## 部署

仓库 `a1ertx5s.github.io` 的 `main` 分支推送到 GitHub Actions 自动构建，
站点地址：<https://a1ertx5s.github.io/>。

> 如果改用普通仓库名（例如 `blog`），需要同时修改两处：
> `astro.config.mjs` 里的 `site` 保持不变，另加 `base: '/blog'`，
> 并把 `src/consts.ts` 里的 `SITE_BASE` 改为 `'/blog'`。

## Credit

主题基于 [Bear Blog](https://github.com/HermanMartinus/bearblog/) 的默认样式，使用 Astro 官方 blog 模板改造。
