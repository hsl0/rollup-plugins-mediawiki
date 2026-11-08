import type { Plugin } from 'rollup';
import requireBinding, { type RequireBindingFilter } from 'rollup-plugin-require-binding';
import mwDependency, { type LoaderDependenciesConfig } from './dependency.js';
import mwUsing from './using.js';

export interface LoaderConfig extends LoaderDependenciesConfig {
	wrapLoaderUsing?: boolean;
}

export default function mediawiki(config?: LoaderConfig): Plugin[] {
	const target: RequireBindingFilter = {};
	const plugins: Plugin[] = [mwDependency(config, target), requireBinding({ target })];
	if (config?.wrapLoaderUsing ?? true) plugins.push(mwUsing(config));
	return plugins;
}
