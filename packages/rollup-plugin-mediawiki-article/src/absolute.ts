import type { Plugin } from 'rollup';

interface ArticleAbsoluteConfig {
	https?: boolean;
	domain?: string;
	port?: string;
	origin?: string;

	originRelative?: boolean;

	articlePath?: string;

	scriptPath?: string;
	loadPath?: string;

	articleURL?: string;

	urlSchemes?: string[];
	wikiNamespaces?: string[];
	fallback?: 'url' | 'wiki';
}

const defaultURLSchemes = ['http', 'https', 'data', 'file', 'blob'];

export default function mwArticleAbsolute(config?: ArticleAbsoluteConfig): Plugin {
	const protocol = `${(config?.https ?? true) ? 'https' : 'http'}://`;
	const port = config?.port ? `:${config.port}` : '';
	const origin =
		config?.origin ??
		(config?.domain && `${protocol}${config.domain}${port}`) ??
		'';

	const articlePath = config?.articlePath ?? '/wiki/';

	const scriptPath = config?.scriptPath ?? '/w';
	const indexPath = config?.loadPath ?? `${scriptPath}/index.php`;

	const articleURL =
		(config?.articleURL ?? (config?.originRelative ? origin : '')) + articlePath;

	const fallback =
		config?.fallback ??
		((config?.wikiNamespaces && 'url') ||
			(config?.urlSchemes && 'wiki') ||
			'wiki');

	return {
		name: 'mediawiki-article/relative',
		resolveId(source, importer, options) {
			if (/^\.\.?(\/|$)/.test(source)) {
				// '../' or './'
				return rel2abs(source, importer);
			}
		},
	};
}
