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

// ---- 读书笔记：导入的外部文档（书籍章节 / 长文 / 资料）----
const notes = defineCollection({
	loader: glob({ base: './src/content/notes', pattern: '**/*.md' }),
	schema: z.object({
		// 文档标题
		title: z.string(),
		// 作者 / 出处
		author: z.string().optional(),
		// 书籍或文档来源（如书名、网址）
		source: z.string().optional(),
		// 文档类型：book / article / paper ...
		kind: z.string().default('book'),
		// 是否在列表中展示
		draft: z.boolean().default(false),
		// 阅读状态：reading / done / paused
		status: z.string().optional(),
		// 阅读进度（0-100）
		progress: z.number().min(0).max(100).optional(),
		// 导入时间
		importedDate: z.coerce.date().optional(),
		// 封面图（可选）
		cover: z.optional(z.string()),
	}),
});

export const collections = { blog, notes };
