/**
 * 静态站点上的文本批注引擎（无后端、无第三方依赖）。
 *
 * 设计要点：
 * 1. 锚定采用 W3C Web Annotation 的思路 —— 同时记录 quote(exact) / prefix / suffix
 *    以及 position 偏移量。恢复时优先精确匹配，多处命中则用上下文与偏移量打分，
 *    因此即使文档被编辑过、DOM 结构变了，批注也能大概率重新找到位置。
 * 2. 批注保存在 localStorage，并可通过「导入 / 导出 JSON」在设备间迁移，
 *    页面上线时也会尝试加载 /annotations/<docId>.json（仓库里提交好的批注）。
 * 3. 渲染采用「重建原文 + 重新套用标记」的方式，避免增量更新 DOM 带来的偏移错乱。
 */

export interface Annotation {
	id: string;
	/** 被划线的原文 */
	quote: string;
	/** 前文，用于消歧 */
	prefix: string;
	/** 后文，用于消歧 */
	suffix: string;
	/** 在文档纯文本中的大致偏移，仅作提示 */
	start: number;
	end: number;
	/** 批注内容 */
	note: string;
	color: string;
	createdAt: string;
	updatedAt: string;
}

export interface AnnotationFile {
	version: number;
	docId: string;
	title?: string;
	updatedAt: string;
	annotations: Annotation[];
}

interface TextNodeInfo {
	node: Text;
	start: number;
	end: number;
}

interface TextMap {
	nodes: TextNodeInfo[];
	byNode: Map<Text, TextNodeInfo>;
	text: string;
}

interface Resolved extends Annotation {
	resolvedStart: number;
	resolvedEnd: number;
}

export const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type Color = (typeof COLORS)[number];

const CONTEXT_LEN = 40;
const STORAGE_PREFIX = 'annotation:';
const FILE_VERSION = 1;

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div';

/* ------------------------------------------------------------------ */
/* 文本映射：把 DOM 展平成一段纯文本，并记录每个文本节点的区间            */
/* ------------------------------------------------------------------ */

function buildTextMap(root: HTMLElement): TextMap {
	const nodes: TextNodeInfo[] = [];
	const byNode = new Map<Text, TextNodeInfo>();
	let text = '';

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node) {
			const value = node.nodeValue ?? '';
			if (!value.trim()) return NodeFilter.FILTER_REJECT;
			const parent = (node as Text).parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			const tag = parent.tagName;
			if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
			if (parent.closest('[data-annotator-ui]')) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	let current = walker.nextNode();
	let lastBlock: Element | null = null;

	while (current) {
		const node = current as Text;
		const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;

		// 不同块级元素之间插入换行，避免跨段落匹配到拼接出的假文本
		if (lastBlock && block && block !== lastBlock && text && !text.endsWith('\n')) {
			text += '\n';
		}

		const start = text.length;
		text += node.nodeValue ?? '';
		const info: TextNodeInfo = { node, start, end: text.length };
		nodes.push(info);
		byNode.set(node, info);

		lastBlock = block;
		current = walker.nextNode();
	}

	return { nodes, byNode, text };
}

function firstIn(node: Node, map: TextMap): Text | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const t = node as Text;
		return map.byNode.has(t) ? t : null;
	}
	for (const child of Array.from(node.childNodes)) {
		const found = firstIn(child, map);
		if (found) return found;
	}
	return null;
}

function lastIn(node: Node, map: TextMap): Text | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const t = node as Text;
		return map.byNode.has(t) ? t : null;
	}
	const children = Array.from(node.childNodes);
	for (let i = children.length - 1; i >= 0; i--) {
		const found = lastIn(children[i], map);
		if (found) return found;
	}
	return null;
}

/** 把 Range 的一个边界（container + offset）换算成纯文本偏移 */
function offsetFromBoundary(map: TextMap, container: Node, offset: number): number | null {
	if (container.nodeType === Node.TEXT_NODE) {
		const info = map.byNode.get(container as Text);
		if (!info) return null;
		const len = (container as Text).nodeValue?.length ?? 0;
		return info.start + Math.min(offset, len);
	}

	const children = Array.from(container.childNodes);
	for (let i = offset; i < children.length; i++) {
		const t = firstIn(children[i], map);
		if (t) return map.byNode.get(t)!.start;
	}
	for (let i = Math.min(offset, children.length) - 1; i >= 0; i--) {
		const t = lastIn(children[i], map);
		if (t) return map.byNode.get(t)!.end;
	}
	return null;
}

/** 反向：把纯文本偏移换算成 Range 边界，用于滚动定位 */
function boundaryFromOffset(map: TextMap, offset: number): { node: Text; offset: number } | null {
	if (map.nodes.length === 0) return null;
	for (const info of map.nodes) {
		if (offset >= info.start && offset <= info.end) {
			return { node: info.node, offset: offset - info.start };
		}
	}
	const last = map.nodes[map.nodes.length - 1];
	return { node: last.node, offset: last.node.nodeValue?.length ?? 0 };
}

/* ------------------------------------------------------------------ */
/* 锚定：创建时提取 quote/prefix/suffix，恢复时模糊匹配                   */
/* ------------------------------------------------------------------ */

function findAll(haystack: string, needle: string): number[] {
	const out: number[] = [];
	if (!needle) return out;
	let i = haystack.indexOf(needle);
	while (i !== -1) {
		out.push(i);
		i = haystack.indexOf(needle, i + 1);
	}
	return out;
}

function commonSuffixLen(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

function commonPrefixLen(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/** 在文档纯文本里定位一条批注；返回 null 表示已成孤儿（原文被改动） */
function resolveAnnotation(annotation: Annotation, text: string): { start: number; end: number } | null {
	const { quote, prefix, suffix, start: hint } = annotation;
	if (!quote) return null;

	const candidates = findAll(text, quote);
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + quote.length };

	let best = candidates[0];
	let bestScore = -Infinity;

	for (const candidate of candidates) {
		const before = text.slice(Math.max(0, candidate - prefix.length), candidate);
		const after = text.slice(candidate + quote.length, candidate + quote.length + suffix.length);
		// 上下文吻合度为主，与记录偏移量的接近程度为辅
		let score = commonSuffixLen(before, prefix) * 2 + commonPrefixLen(after, suffix) * 2;
		score -= Math.abs(candidate - hint) / 500;
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	return { start: best, end: best + quote.length };
}

/* ------------------------------------------------------------------ */
/* 渲染：把批注区间套成 <mark>                                          */
/* ------------------------------------------------------------------ */

interface LocalRange {
	start: number;
	end: number;
	id: string;
	color: string;
}

function applyHighlights(root: HTMLElement, map: TextMap, resolved: Resolved[]): void {
	const byNode = new Map<Text, LocalRange[]>();

	for (const annotation of resolved) {
		for (const info of map.nodes) {
			const start = Math.max(annotation.resolvedStart, info.start);
			const end = Math.min(annotation.resolvedEnd, info.end);
			if (start >= end) continue;
			const list = byNode.get(info.node) ?? [];
			list.push({
				start: start - info.start,
				end: end - info.start,
				id: annotation.id,
				color: annotation.color,
			});
			byNode.set(info.node, list);
		}
	}

	for (const [node, ranges] of byNode) {
		const text = node.nodeValue ?? '';
		ranges.sort((a, b) => a.start - b.start);

		const fragment = document.createDocumentFragment();
		let cursor = 0;
		let painted = false;

		for (const range of ranges) {
			if (range.start < cursor) continue; // 跳过重叠部分，保证不重复输出文本
			if (range.start > cursor) {
				fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
			}
			const mark = document.createElement('mark');
			mark.className = 'annotator-mark';
			mark.dataset.annotationId = range.id;
			mark.dataset.color = range.color;
			mark.textContent = text.slice(range.start, range.end);
			fragment.appendChild(mark);
			cursor = range.end;
			painted = true;
		}

		if (!painted) continue;
		if (cursor < text.length) {
			fragment.appendChild(document.createTextNode(text.slice(cursor)));
		}
		node.parentNode?.replaceChild(fragment, node);
	}
}

/* ------------------------------------------------------------------ */
/* 存储                                                                */
/* ------------------------------------------------------------------ */

function storageKey(docId: string): string {
	return `${STORAGE_PREFIX}${docId}`;
}

function loadLocal(docId: string): Annotation[] {
	try {
		const raw = localStorage.getItem(storageKey(docId));
		if (!raw) return [];
		const parsed = JSON.parse(raw) as AnnotationFile | Annotation[];
		const list = Array.isArray(parsed) ? parsed : parsed.annotations;
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

function saveLocal(docId: string, title: string, annotations: Annotation[]): void {
	const payload: AnnotationFile = {
		version: FILE_VERSION,
		docId,
		title,
		updatedAt: new Date().toISOString(),
		annotations,
	};
	try {
		localStorage.setItem(storageKey(docId), JSON.stringify(payload));
	} catch {
		/* 隐私模式下可能写入失败，忽略即可，导出功能仍然可用 */
	}
}

/* ------------------------------------------------------------------ */
/* 控制器                                                              */
/* ------------------------------------------------------------------ */

export interface AnnotatorOptions {
	container: HTMLElement;
	docId: string;
	title?: string;
	/** 是否尝试从仓库加载预置批注 */
	loadRemote?: boolean;
}

export interface AnnotatorController {
	setContent(html: string, docId?: string, title?: string): void;
	getAnnotations(): Annotation[];
	exportJson(): void;
	exportMarkdown(): void;
	importJson(file: File): Promise<void>;
	refresh(): void;
}

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (char) => {
		const map: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;',
		};
		return map[char] ?? char;
	});

export function initAnnotator(options: AnnotatorOptions): AnnotatorController {
	const container = options.container;
	const root = container.querySelector<HTMLElement>('[data-annotator-root]');
	const sidebar = container.querySelector<HTMLElement>('[data-annotator-side]');
	const listEl = container.querySelector<HTMLElement>('[data-annotator-list]') ?? sidebar;
	const toolbar = container.querySelector<HTMLElement>('[data-annotator-toolbar]');
	const popover = container.querySelector<HTMLElement>('[data-annotator-popover]');
	const statusEl = container.querySelector<HTMLElement>('[data-annotator-status]');
	const noteInput = container.querySelector<HTMLTextAreaElement>('[data-annotator-note]');
	const emptyEl = container.querySelector<HTMLElement>('[data-annotator-empty]');

	if (!root || !sidebar || !listEl || !toolbar || !popover) {
		throw new Error('Annotator: 缺少必需的容器元素');
	}

	let docId = options.docId;
	let title = options.title ?? '';
	let originalHtml = root.innerHTML;
	let annotations: Annotation[] = [];
	let resolved: Resolved[] = [];
	let postMap: TextMap | null = null;
	let activeId: string | null = null;
	let pendingRange: { start: number; end: number; quote: string; prefix: string; suffix: string } | null =
		null;

	/* ---------- 渲染 ---------- */

	function render(): void {
		root!.innerHTML = originalHtml;
		const map = buildTextMap(root!);

		resolved = [];
		for (const annotation of annotations) {
			const found = resolveAnnotation(annotation, map.text);
			if (!found) continue;
			resolved.push({ ...annotation, resolvedStart: found.start, resolvedEnd: found.end });
		}

		applyHighlights(root!, map, resolved);
		postMap = buildTextMap(root!); // 打完标记后文本节点被切分，重建映射用于滚动定位
		renderSidebar();
	}

	function renderSidebar(): void {
		const sorted = [...annotations].sort((a, b) => a.start - b.start);
		if (statusEl) {
			statusEl.textContent = sorted.length === 0 ? '还没有批注' : `共 ${sorted.length} 条批注`;
		}
		if (emptyEl) emptyEl.hidden = sorted.length > 0;

		sidebar!.querySelectorAll('[data-annotator-item]').forEach((el) => el.remove());

		for (const annotation of sorted) {
			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'note-item';
			item.dataset.annotatorItem = annotation.id;
			item.dataset.color = annotation.color;
			item.innerHTML = `
				<span class="note-item__quote">${escapeHtml(truncate(annotation.quote, 90))}</span>
				<span class="note-item__text">${annotation.note ? escapeHtml(truncate(annotation.note, 120)) : '<em>（暂无批注）</em>'}</span>
			`;
			item.addEventListener('click', () => {
				scrollTo(annotation.id);
				openPopover(annotation.id);
			});
			listEl!.appendChild(item);
		}
	}

	function truncate(value: string, max: number): string {
		const clean = value.replace(/\s+/g, ' ').trim();
		return clean.length > max ? `${clean.slice(0, max)}…` : clean;
	}

	function scrollTo(id: string): void {
		const mark = root!.querySelector<HTMLElement>(`mark[data-annotation-id="${id}"]`);
		if (!mark) return;
		mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
		mark.classList.add('is-flashing');
		window.setTimeout(() => mark.classList.remove('is-flashing'), 1200);
	}

	/* ---------- 浮层 ---------- */

	function showToolbar(rect: DOMRect): void {
		toolbar!.hidden = false;
		toolbar!.style.top = `${Math.max(8, rect.top - toolbar!.offsetHeight - 10)}px`;
		toolbar!.style.left = `${Math.max(8, rect.left + rect.width / 2 - toolbar!.offsetWidth / 2)}px`;
	}

	function hideToolbar(): void {
		toolbar!.hidden = true;
	}

	function openPopover(id: string): void {
		const annotation = annotations.find((a) => a.id === id);
		if (!annotation || !noteInput) return;
		activeId = id;
		noteInput.value = annotation.note;
		popover!.hidden = false;
		popover!.querySelectorAll<HTMLElement>('[data-annotator-color]').forEach((swatch) => {
			swatch.classList.toggle('is-active', swatch.dataset.annotatorColor === annotation.color);
		});
		const quoteEl = popover!.querySelector<HTMLElement>('[data-annotator-quote]');
		if (quoteEl) quoteEl.textContent = truncate(annotation.quote, 160);

		const mark = root!.querySelector<HTMLElement>(`mark[data-annotation-id="${id}"]`);
		if (mark) {
			const rect = mark.getBoundingClientRect();
			const top = Math.min(window.innerHeight - popover!.offsetHeight - 12, rect.bottom + 10);
			popover!.style.top = `${Math.max(12, top)}px`;
			popover!.style.left = `${Math.min(
				window.innerWidth - popover!.offsetWidth - 12,
				Math.max(12, rect.left),
			)}px`;
		}
		noteInput.focus();
	}

	function closePopover(): void {
		popover!.hidden = true;
		activeId = null;
	}

	/* ---------- 增删改 ---------- */

	function createFromSelection(): void {
		if (!pendingRange) return;
		const now = new Date().toISOString();

		// 与已有批注重叠的，直接替换掉，避免区间互相切割
		annotations = annotations.filter((annotation) => {
			const found = resolved.find((r) => r.id === annotation.id);
			if (!found) return true;
			return !(found.resolvedStart < pendingRange!.end && pendingRange!.start < found.resolvedEnd);
		});

		const annotation: Annotation = {
			id: crypto.randomUUID(),
			quote: pendingRange.quote,
			prefix: pendingRange.prefix,
			suffix: pendingRange.suffix,
			start: pendingRange.start,
			end: pendingRange.end,
			note: '',
			color: 'yellow',
			createdAt: now,
			updatedAt: now,
		};

		annotations.push(annotation);
		persist();
		render();
		hideToolbar();
		window.getSelection()?.removeAllRanges();
		pendingRange = null;
		openPopover(annotation.id);
	}

	function updateNote(): void {
		if (!activeId || !noteInput) return;
		const annotation = annotations.find((a) => a.id === activeId);
		if (!annotation) return;
		annotation.note = noteInput.value;
		annotation.updatedAt = new Date().toISOString();
		persist();
		renderSidebar();
	}

	function setColor(color: string): void {
		if (!activeId) return;
		const annotation = annotations.find((a) => a.id === activeId);
		if (!annotation) return;
		annotation.color = color;
		annotation.updatedAt = new Date().toISOString();
		persist();
		render();
		popover!.querySelectorAll<HTMLElement>('[data-annotator-color]').forEach((swatch) => {
			swatch.classList.toggle('is-active', swatch.dataset.annotatorColor === color);
		});
	}

	function removeAnnotation(): void {
		if (!activeId) return;
		annotations = annotations.filter((a) => a.id !== activeId);
		persist();
		closePopover();
		render();
	}

	function persist(): void {
		saveLocal(docId, title, annotations);
	}

	/* ---------- 事件 ---------- */

	function onSelectionChange(): void {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			hideToolbar();
			pendingRange = null;
			return;
		}

		const range = selection.getRangeAt(0);
		if (!root!.contains(range.commonAncestorContainer)) {
			hideToolbar();
			pendingRange = null;
			return;
		}
		if (container.querySelector('[data-annotator-ui]')?.contains(selection.anchorNode ?? null)) return;

		const map = postMap;
		if (!map) return;

		let start = offsetFromBoundary(map, range.startContainer, range.startOffset);
		let end = offsetFromBoundary(map, range.endContainer, range.endOffset);
		if (start === null || end === null) return;
		if (start > end) [start, end] = [end, start];
		if (start === end) return;

		// 去掉首尾空白，避免锚定串到相邻节点的空白上
		const flat = map.text;
		while (start < end && /\s/.test(flat[start])) start++;
		while (end > start && /\s/.test(flat[end - 1])) end--;
		if (start >= end) return;

		pendingRange = {
			start,
			end,
			quote: flat.slice(start, end),
			prefix: flat.slice(Math.max(0, start - CONTEXT_LEN), start),
			suffix: flat.slice(end, Math.min(flat.length, end + CONTEXT_LEN)),
		};

		showToolbar(range.getBoundingClientRect());
	}

	function onClick(event: MouseEvent): void {
		const target = event.target as HTMLElement | null;
		if (!target) return;

		if (target.closest('[data-annotator-ui]')) return;

		const mark = target.closest<HTMLElement>('mark[data-annotation-id]');
		if (mark) {
			event.preventDefault();
			openPopover(mark.dataset.annotationId!);
			return;
		}

		if (!popover!.hidden && !popover!.contains(target)) closePopover();
	}

	root.addEventListener('mouseup', () => window.setTimeout(onSelectionChange, 0));
	root.addEventListener('keyup', () => window.setTimeout(onSelectionChange, 0));
	document.addEventListener('mousedown', onClick, true);

	container.querySelector('[data-annotator-create]')?.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
		createFromSelection();
	});

	container.querySelector('[data-annotator-save]')?.addEventListener('click', () => {
		updateNote();
		closePopover();
	});
	container.querySelector('[data-annotator-delete]')?.addEventListener('click', removeAnnotation);
	container.querySelector('[data-annotator-close]')?.addEventListener('click', () => {
		updateNote();
		closePopover();
	});
	container.querySelectorAll<HTMLElement>('[data-annotator-color]').forEach((swatch) => {
		swatch.addEventListener('click', () => setColor(swatch.dataset.annotatorColor ?? 'yellow'));
	});
	container.querySelector('[data-annotator-export-json]')?.addEventListener('click', () =>
		controller.exportJson(),
	);
	container.querySelector('[data-annotator-export-md]')?.addEventListener('click', () =>
		controller.exportMarkdown(),
	);
	container.querySelector<HTMLInputElement>('[data-annotator-import]')?.addEventListener('change', (event) => {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void controller.importJson(file);
		input.value = '';
	});
	container.querySelector('[data-annotator-clear]')?.addEventListener('click', () => {
		if (!annotations.length) return;
		if (!window.confirm(`确定要清空本文档的 ${annotations.length} 条批注吗？此操作不可撤销。`)) return;
		annotations = [];
		persist();
		closePopover();
		render();
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			closePopover();
			hideToolbar();
		}
	});

	/* ---------- 导入导出 ---------- */

	function download(filename: string, content: string, type: string): void {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	function safeName(): string {
		return docId.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || 'annotations';
	}

	/* ---------- 初始化 ---------- */

	async function loadRemote(): Promise<void> {
		if (options.loadRemote === false) return;
		try {
			const base = import.meta.env.BASE_URL || '/';
			const url = `${base.replace(/\/$/, '')}/annotations/${docId}.json`;
			const response = await fetch(url, { cache: 'no-cache' });
			if (!response.ok) return;
			const data = (await response.json()) as AnnotationFile;
			if (Array.isArray(data.annotations) && data.annotations.length) {
				// 本地已有时以本地为准，否则用仓库里的批注作初始值
				annotations = data.annotations;
				persist();
				render();
			}
		} catch {
			/* 没有预置批注或网络不可用时静默跳过 */
		}
	}

	const controller: AnnotatorController = {
		setContent(html, nextDocId, nextTitle) {
			originalHtml = html;
			if (nextDocId) docId = nextDocId;
			if (nextTitle) title = nextTitle;
			annotations = loadLocal(docId);
			closePopover();
			render();
			void loadRemote();
		},
		getAnnotations() {
			return [...annotations];
		},
		exportJson() {
			const payload: AnnotationFile = {
				version: FILE_VERSION,
				docId,
				title,
				updatedAt: new Date().toISOString(),
				annotations: [...annotations].sort((a, b) => a.start - b.start),
			};
			download(`${safeName()}.annotations.json`, JSON.stringify(payload, null, 2), 'application/json');
		},
		exportMarkdown() {
			const sorted = [...annotations].sort((a, b) => a.start - b.start);
			const lines = [`# ${title || docId} · 批注`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
			sorted.forEach((annotation, index) => {
				lines.push(`## ${index + 1}. ${truncate(annotation.quote, 60)}`, '', `> ${annotation.quote}`, '');
				lines.push(annotation.note ? annotation.note : '*（暂无批注）*', '');
			});
			download(`${safeName()}.notes.md`, lines.join('\n'), 'text/markdown');
		},
		async importJson(file) {
			try {
				const data = JSON.parse(await file.text()) as AnnotationFile | Annotation[];
				const incoming = Array.isArray(data) ? data : data.annotations;
				if (!Array.isArray(incoming)) throw new Error('格式不正确');
				const existing = new Map(annotations.map((a) => [a.id, a]));
				for (const annotation of incoming) {
					if (annotation && typeof annotation.quote === 'string') {
						existing.set(annotation.id ?? crypto.randomUUID(), {
							note: '',
							color: 'yellow',
							prefix: '',
							suffix: '',
							start: 0,
							end: 0,
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							...annotation,
						});
					}
				}
				annotations = [...existing.values()];
				persist();
				render();
			} catch (error) {
				window.alert(`导入失败：${(error as Error).message}`);
			}
		},
		refresh() {
			render();
		},
	};

	annotations = loadLocal(docId);
	render();
	void loadRemote();

	return controller;
}
