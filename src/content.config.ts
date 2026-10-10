import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// ---- 博客文章 ----
const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			// 可选标签，用于博客列表筛选
			tags: z.array(z.string()).optional(),
		}),
});

// ---- 读书笔记：随仓库提交的文档 ----
// 正文和批注都在代码里：批注写在 frontmatter 的 annotations 里（或同名的
// .annotations.json），由 astro.config.mjs 里的 rehypeAnnotate 在构建期渲染进正文。
const notes = defineCollection({
	loader: glob({ base: './src/content/notes', pattern: '**/*.md' }),
	schema: z.object({
		// 文档标题
		title: z.string(),
		// 作者 / 出处
		author: z.string().optional(),
		// 原文地址
		source: z.string().optional(),
		// 原文来源的显示名
		sourceLabel: z.string().optional(),
		// 文档类型：book / article / paper / document ...
		kind: z.string().default('book'),
		// 是否在列表中展示
		draft: z.boolean().default(false),
		// 阅读状态：reading / done / paused
		status: z.string().optional(),
		// 阅读进度（0-100）
		progress: z.number().min(0).max(100).optional(),
		// 归档分组：同一组的文档在列表里归到一起
		group: z.string().optional(),
		// 分组排序（小的在前）
		groupOrder: z.number().optional(),
		// 组内排序
		order: z.number().optional(),
		// 导入时间
		importedDate: z.coerce.date().optional(),
		// 封面图（可选）
		cover: z.optional(z.string()),
		// 构建期批注
		annotations: z
			.array(
				z.object({
					quote: z.string(),
					note: z.string().optional(),
					color: z.string().optional(),
				}),
			)
			.optional(),
	}),
});

export const collections = { blog, notes };
