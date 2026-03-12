import type { Plugin } from 'rollup';
import rel2abs from './rel2abs';

export default function mwArticleRelative(): Plugin {
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
