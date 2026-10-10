/**
 * 引文锚定：在一段纯文本中定位一条批注的 quote。
 *
 * 与浏览器端那套不同，这里是构建期跑的纯字符串逻辑：
 * 先精确匹配 quote，多处命中时用 prefix / suffix 的吻合度打分，
 * 再拿记录下来的偏移量做兜底，避免文档改动后批注错位。
 */

export interface Annotation {
	/** 被划线的原文 */
	quote: string;
	/** 批注正文 */
	note?: string;
	/** 高亮颜色：yellow / green / blue / pink */
	color?: string;
	/** 可选，默认按出现顺序编号 */
	id?: string;
}

export interface AnchorRecord {
	quote: string;
	prefix?: string;
	suffix?: string;
	start?: number;
	end?: number;
}

const CONTEXT_LEN = 40;

export function findOccurrences(haystack: string, needle: string): number[] {
	const out: number[] = [];
	if (!needle) return out;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		out.push(index);
		index = haystack.indexOf(needle, index + 1);
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

/** 定位成功返回区间，失败返回 null（原文已被改动，视为孤儿） */
export function resolveAnchor(anchor: AnchorRecord, text: string): { start: number; end: number } | null {
	const { quote } = anchor;
	if (!quote) return null;

	const candidates = findOccurrences(text, quote);
	if (candidates.length === 0) return null;
	if (candidates.length === 1) {
		return { start: candidates[0], end: candidates[0] + quote.length };
	}

	const prefix = anchor.prefix ?? '';
	const suffix = anchor.suffix ?? '';
	const hint = anchor.start ?? candidates[0];

	let best = candidates[0];
	let bestScore = -Infinity;
	for (const candidate of candidates) {
		const before = text.slice(Math.max(0, candidate - prefix.length), candidate);
		const after = text.slice(candidate + quote.length, candidate + quote.length + suffix.length);
		let score = commonSuffixLen(before, prefix) * 2 + commonPrefixLen(after, suffix) * 2;
		score -= Math.abs(candidate - hint) / 500;
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return { start: best, end: best + quote.length };
}

/** 从全文里补出 prefix / suffix，便于写进 JSON 时留档 */
export function deriveContext(text: string, start: number, end: number): { prefix: string; suffix: string } {
	return {
		prefix: text.slice(Math.max(0, start - CONTEXT_LEN), start),
		suffix: text.slice(end, Math.min(text.length, end + CONTEXT_LEN)),
	};
}
