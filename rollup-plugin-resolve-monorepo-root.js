import path from 'node:path';

/** @returns {import('rollup').Plugin} */
export default function resolveMonorepoRoot() {
	return {
		name: 'resolve-monorepo-root',
		resolveId(source, importer, options) {
			if (source.startsWith('#monorepo-root')) {
				const [, ...dirs] = source.split('/');
				return path.join(import.meta.dirname, ...dirs);
			}
		},
	};
}
