import type { Plugin } from 'rollup';
import type { LoaderDependenciesConfig } from './src/resolve.js';
import mwLoaderDynamicImport from './src/dynamic-import.js';
import mwLoaderResolve from './src/resolve.js';
import mwLoaderUsing from './src/using.js';
import mwLoaderLoad from './src/load.js';

export interface LoaderConfig extends LoaderDependenciesConfig {
	transformDynamicImport?: boolean;
	wrapLoaderUsing?: boolean;
	bundleDependencies?: boolean;
}

export default function mwLoader(config?: LoaderConfig): Plugin[] {
	const plugins = [
		mwLoaderResolve({
			...config,
			dependenciesExternal: !(config?.bundleDependencies ?? false),
		}),
	];
	if (config?.transformDynamicImport ?? true)
		plugins.push(mwLoaderDynamicImport());
	if (config?.wrapLoaderUsing ?? true) plugins.push(mwLoaderUsing(config));
	if (config?.bundleDependencies ?? false) plugins.push(mwLoaderLoad());
	return plugins;
}
