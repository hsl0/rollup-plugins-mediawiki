import { createFilter, type FilterPattern } from '@rollup/pluginutils';
import type { Plugin } from 'rollup';
import dynamicRequireBinding from './dynamic.js';
import staticRequireBinding from './static.js';

export interface RequireBindingFilter {
	include?: FilterPattern;
	exclude?: FilterPattern;
}

export interface RequireBindingOptions {
	importer?: RequireBindingFilter;
	target?: RequireBindingFilter;
}

export interface NormalizedRequireBindingOptions {
	importer: ((id: string) => boolean) | null;
	target: ((id: string) => boolean) | null;
}

export default function requireBinding(options: RequireBindingOptions = {}): Plugin {
	const normalized: NormalizedRequireBindingOptions = {
		importer: null,
		target: null,
	};

	return {
		...dynamicRequireBinding(normalized),
		...staticRequireBinding(normalized),
		name: 'require-binding',
		buildStart() {
			if (options.importer)
				normalized.importer = createFilter(
					options.importer.include,
					options.importer.exclude
				);
			if (options.target)
				normalized.target = createFilter(options.target.include, options.target.exclude, {
					resolve: false,
				});
		},
	};
}
