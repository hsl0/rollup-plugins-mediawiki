import mwLoader from 'rollup-plugin-mediawiki-loader';

import { toArray } from '#monorepo-root/util.js';
import type { LoaderDependenciesConfig } from 'rollup-plugin-mediawiki-loader/resolve';
import type { InputOptions, Plugin } from 'rollup';
import type { InputAnythingConfig } from 'rollup-plugin-input-anything';
import inputAnything from 'rollup-plugin-input-anything';

export interface GadgetConfig extends LoaderDependenciesConfig {
	name: string;
	transformDynamicImport?: boolean;
	inputAnythingOptions?: InputAnythingConfig | InputAnythingConfig[];
	inputCSS?: boolean | InputAnythingConfig;
	inputJSON?: boolean | InputAnythingConfig;
}

export default function mwGadget(config: GadgetConfig): Plugin[] {
	const inputAnythingOptions: InputAnythingConfig[] = [
		...toArray(config.inputAnythingOptions ?? []),
	];

	if ((config.inputCSS ??= true))
		inputAnythingOptions.push(
			typeof config.inputCSS === 'boolean'
				? { extensions: '.css' }
				: config.inputCSS
		);
	if ((config.inputJSON ??= true))
		inputAnythingOptions.push(
			typeof config.inputJSON === 'boolean'
				? { extensions: '.json' }
				: config.inputJSON
		);

	return [
		...mwLoader({
			wrapLoaderUsing: false,
			transformDynamicImport: config.transformDynamicImport,
		}),
		{
			name: 'mediawiki-gadget',
			options(options) {
				const inputs: Record<string, string> = {}; // JS, CSS entries

				if (typeof options.input !== 'object')
					return this.error('Input files must be mapped');

				for (const [output, input] of Object.entries(options.input)) {
					if (/^(js|css|json)$/.test(output))
						inputs[`${config.name}.${output}`] = input; // main
					else if (/\.(js|css|json)$/.test(output))
						inputs[`${config.name}-${output}`] = input; // sub
				}

				return {
					...options,
					input: inputs,
				} as InputOptions;
			},
			outputOptions(options) {
				return {
					...options,
					format: 'cjs',
					entryFileNames: '[name]',
					assetFileNames: '[name][extname]',
					chunkFileNames: ({ moduleIds }) => {
						throw new Error(`Unspecified module detected: ${moduleIds}`);
					},
				};
			},
		},
		inputAnything(...inputAnythingOptions),
	];
}
