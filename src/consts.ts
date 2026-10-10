// 站点全局配置：改这里就能改掉全站名称、描述和域名。
// base 填你的仓库名（用户主页仓库 a1ertx5s.github.io 则为空字符串），
// 这样本地开发和 GitHub Pages（部署在子路径）都能正常工作。

export const SITE_BASE = '';

export const SITE_TITLE = 'a1ertx5s 的博客';
export const SITE_DESCRIPTION = '一个关于技术、阅读与思考的个人博客 —— 写代码，也写读书笔记。';

/** 把站内绝对路径按 SITE_BASE 拼成最终 URL，构建与线上两种环境都可用。 */
export function url(path: string): string {
	const normalized = path.startsWith('/') ? path : `/${path}`;
	return `${SITE_BASE}${normalized}`;
}
