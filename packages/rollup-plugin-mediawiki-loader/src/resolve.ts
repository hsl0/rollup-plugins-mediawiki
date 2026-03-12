import type { Plugin } from 'rollup';

export interface LoaderDependenciesConfig {
	dependencies?: string[];
	gadgetDependencies?: string[];
}

export default function mwLoaderResolve(
	config?: LoaderDependenciesConfig & { dependenciesExternal?: boolean }
): Plugin {
	return {
		name: 'mediawiki-loader/resolve',
		outputOptions(options) {
			return {
				...options,
				format: 'cjs',
			};
		},
		resolveId(source) {
			if (config?.gadgetDependencies?.includes(source))
				return {
					id: `ext.gadget.${source}`,
					external: config.dependenciesExternal ?? true,
					resolvedBy: 'mediawiki-loader',
				};
			if (config?.dependencies?.includes(source))
				return {
					id: source,
					external: config.dependenciesExternal ?? true,
					resolvedBy: 'mediawiki-loader',
				};
		},
	};
}
