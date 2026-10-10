/**
 * 构建期批注渲染（rehype 插件）。
 *
 * 批注来源（按优先级）：
 *   1. 笔记 frontmatter 里的 `annotations`
 *   2. `src/content/annotations/<docId>.annotations.json`
 *
 * 渲染结果：正文里出现 `<mark class="hl">`，并在该批注的**最后一段**后面跟一个
 * `<sup>` 锚点链接，指向页面下方渲染好的批注列表。全程在构建时完成 ——
 * 页面是只读的，访客改不了，也不需要任何客户端 JS。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolveAnchor, type Annotation } from './quote-anchor';

interface HastText {
	type: 'text';
	value: string;
}
interface HastElement {
	type: 'element';
	tagName: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}
interface HastRoot {
	type: 'root';
	children: HastNode[];
}
type HastNode = HastText | HastElement | { type: string; [key: string]: unknown };

/** 这些容器内的文字不参与批注（代码块里的引文没有意义，也容易被误替换） */
const SKIP_TAGS = new Set(['pre', 'code', 'script', 'style', 'svg']);
const BLOCK_TAGS = new Set([
	'p',
	'li',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'blockquote',
	'td',
	'th',
	'div',
	'tr',
	'dt',
	'dd',
]);

interface TextSlot {
	node: HastText;
	parent: HastElement | HastRoot;
	start: number;
	end: number;
}

interface TextMap {
	slots: TextSlot[];
	text: string;
}

function buildTextMap(root: HastRoot): TextMap {
	const slots: TextSlot[] = [];
	let text = '';

	const walk = (node: HastNode, parent: HastElement | HastRoot) => {
		if (node.type === 'text') {
			const value = (node as HastText).value ?? '';
			if (!value.trim()) return;
			const start = text.length;
			text += value;
			slots.push({ node: node as HastText, parent, start, end: text.length });
			return;
		}
		if (node.type !== 'element' && node.type !== 'root') return;

		const element = node as HastElement | HastRoot;
		const tag = node.type === 'element' ? (node as HastElement).tagName.toLowerCase() : '';
		if (SKIP_TAGS.has(tag)) return;

		// 块级元素之间垫一个换行，避免跨段落拼出并不存在的连续文本
		if (BLOCK_TAGS.has(tag) && text && !text.endsWith('\n')) text += '\n';

		for (const child of (element.children ?? []) as HastNode[]) {
			walk(child, element);
		}
	};

	walk(root as HastNode, root);
	return { slots, text };
}

export interface AnnotateResult {
	/** 成功渲染的批注编号（1 开始），顺序与传入数组一致 */
	rendered: number[];
	/** 找不到引文的批注 */
	orphans: Annotation[];
}

interface LocalInterval {
	/** 在所属文本节点内的区间 */
	start: number;
	end: number;
	/** 该片段在全文中的首尾，用来判断自己是不是这条批注的第一/最后一段 */
	globalStart: number;
	globalEnd: number;
	noteStart: number;
	noteEnd: number;
	noteNumber: number;
	color: string;
}

export function annotateTree(tree: HastRoot, annotations: Annotation[], strict = false): AnnotateResult {
	const result: AnnotateResult = { rendered: [], orphans: [] };
	if (!annotations.length) return result;

	const map = buildTextMap(tree);

	const resolved: Array<{ number: number; start: number; end: number; color: string }> = [];
	annotations.forEach((annotation, index) => {
		const found = resolveAnchor({ quote: annotation.quote }, map.text);
		if (!found) {
			result.orphans.push(annotation);
			const message = `[annotate] 找不到引文：${annotation.quote.slice(0, 40)}…`;
			if (strict) throw new Error(message);
			console.warn(message);
			return;
		}
		resolved.push({ number: index + 1, start: found.start, end: found.end, color: annotation.color ?? 'yellow' });
		result.rendered.push(index + 1);
	});

	if (!resolved.length) return result;

	// 每条批注落在哪些文本节点上
	const byParent = new Map<HastElement | HastRoot, Map<HastText, LocalInterval[]>>();
	for (const item of resolved) {
		for (const slot of map.slots) {
			const start = Math.max(item.start, slot.start);
			const end = Math.min(item.end, slot.end);
			if (start >= end) continue;

			let perNode = byParent.get(slot.parent);
			if (!perNode) {
				perNode = new Map();
				byParent.set(slot.parent, perNode);
			}
			const list = perNode.get(slot.node) ?? [];
			list.push({
				start: start - slot.start,
				end: end - slot.start,
				globalStart: start,
				globalEnd: end,
				noteStart: item.start,
				noteEnd: item.end,
				noteNumber: item.number,
				color: item.color,
			});
			perNode.set(slot.node, list);
		}
	}

	// 重建每个父节点的 children
	for (const [parent, perNode] of byParent) {
		const next: HastNode[] = [];

		for (const child of (parent.children ?? []) as HastNode[]) {
			const intervals = child.type === 'text' ? perNode.get(child as HastText) : undefined;
			if (!intervals || !intervals.length) {
				next.push(child);
				continue;
			}

			const value = (child as HastText).value;
			intervals.sort((a, b) => a.start - b.start);

			let cursor = 0;
			for (const interval of intervals) {
				if (interval.start < cursor) continue; // 与上一条批注重叠，跳过
				if (interval.start > cursor) {
					next.push({ type: 'text', value: value.slice(cursor, interval.start) });
				}

				const properties: Record<string, unknown> = {
					className: ['hl'],
					dataNote: String(interval.noteNumber),
					dataColor: interval.color,
				};
				// 跨节点的批注会生成多个 <mark>，只给第一段挂 id，避免重复
				if (interval.globalStart === interval.noteStart) properties.id = `hl-${interval.noteNumber}`;

				next.push({
					type: 'element',
					tagName: 'mark',
					properties,
					children: [{ type: 'text', value: value.slice(interval.start, interval.end) }],
				});

				// 脚标只在该批注的最后一段之后出现
				if (interval.globalEnd === interval.noteEnd) {
					next.push({
						type: 'element',
						tagName: 'sup',
						properties: { className: ['hl-ref'] },
						children: [
							{
								type: 'element',
								tagName: 'a',
								properties: { href: `#note-${interval.noteNumber}` },
								children: [{ type: 'text', value: String(interval.noteNumber) }],
							},
						],
					});
				}

				cursor = interval.end;
			}

			if (cursor < value.length) {
				next.push({ type: 'text', value: value.slice(cursor) });
			}
		}

		parent.children = next;
	}

	return result;
}

/** 从同名 JSON 文件里读批注（供不方便写 frontmatter 的场景使用） */
export function readAnnotationsFile(path: string): Annotation[] {
	if (!existsSync(path)) return [];
	try {
		const data = JSON.parse(readFileSync(path, 'utf8'));
		const list = Array.isArray(data) ? data : data.annotations;
		return Array.isArray(list) ? (list as Annotation[]) : [];
	} catch (error) {
		console.warn(`[annotate] 读取 ${path} 失败：${(error as Error).message}`);
		return [];
	}
}

export interface RehypeAnnotateOptions {
	/** 找不到引文时是否让构建失败 */
	strict?: boolean;
}

/**
 * Astro markdown 管道用的插件包装。
 * 批注优先取 frontmatter 的 `annotations`，其次取与 .md 同名的 `.annotations.json`。
 */
export function rehypeAnnotate(options: RehypeAnnotateOptions = {}) {
	return (tree: HastRoot, file: { data?: { astro?: { frontmatter?: { annotations?: Annotation[] } } }; path?: string }) => {
		const fromFrontmatter = file?.data?.astro?.frontmatter?.annotations;
		let annotations: Annotation[] = Array.isArray(fromFrontmatter) ? fromFrontmatter : [];

		if (!annotations.length && file?.path) {
			annotations = readAnnotationsFile(file.path.replace(/\.mdx?$/, '.annotations.json'));
		}
		if (!annotations.length) return;

		annotateTree(tree, annotations, options.strict ?? false);
	};
}
