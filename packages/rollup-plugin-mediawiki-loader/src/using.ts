import { toArray } from '#monorepo-root/util.js';
import type { LoaderDependenciesConfig } from './resolve';
import type { NormalizedOutputOptions, OutputPlugin } from 'rollup';

export type { LoaderDependenciesConfig };

export default function mwLoaderUsing(
	config?: LoaderDependenciesConfig
): OutputPlugin {
	let outputOptions: NormalizedOutputOptions;

	return {
		name: 'mediawiki-loader/using',
		outputOptions(options) {
			return {
				...options,
				format: 'cjs',
				exports: 'none',
			};
		},
		renderStart(options) {
			outputOptions = options;
		},
		intro: () =>
			`mw.loader.using(${JSON.stringify([
				...toArray(
					config?.gadgetDependencies?.map((pkg) => 'ext.gadget.' + pkg)
				),
				...toArray(config?.dependencies),
			])}).then(${outputOptions.generatedCode.arrowFunctions ? '(require) => {' : 'function (require) {'}`,
		outro: '});',
	};
}
