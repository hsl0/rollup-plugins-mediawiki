import type { Plugin } from 'rollup';

export default function wrapDynamicImport(): Plugin {
	return {
		name: 'wrap-dynamic-import',
		renderDynamicImport() {
			return {
				left: "new Function('module', 'return import(module)')(",
				right: ')',
			};
		},
	};
}
