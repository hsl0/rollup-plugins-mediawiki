import type { Plugin } from 'rollup';

function rel2abs(title: string, location?: string) {
	const parts = title.split('/');
	switch (parts[0]) {
		case '':
		case '.':
			parts.shift();
		case '..':
			if (location) {
				parts.unshift(...location.split('/'));
			} else {
				throw new TypeError(
					'Cannot resolve relative path: no location provided'
				);
			}
	}
	for (let i = 0; i < parts.length; ) {
		if (parts[i] === '..') parts.splice(--i, 2);
		else if (parts[i] === '.') parts.splice(i, 1);
		else i++;
	}
	return parts.join('/');
}

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
