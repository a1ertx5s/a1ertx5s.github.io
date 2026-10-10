// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig, fontProviders } from 'astro/config';
import { rehypeAnnotate } from './src/lib/rehype-annotate.ts';

// https://astro.build/config
export default defineConfig({
	site: 'https://a1ertx5s.github.io',
	integrations: [mdx(), sitemap()],
	markdown: {
		// Astro 7 默认的 Sätteri 处理器用 Rust 访问器 API，写批注插件很别扭；
		// 这里换回经典 remark/rehype 管线，用 rehypeAnnotate 在构建期把批注套进正文。
		processor: unified({ rehypePlugins: [rehypeAnnotate] }),
	},
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
