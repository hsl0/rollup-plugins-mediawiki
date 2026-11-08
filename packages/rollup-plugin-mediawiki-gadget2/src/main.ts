import mwLoader from 'rollup-plugin-mediawiki';

import * as path from 'node:path';
import type { InputOptions, Plugin } from 'rollup';
import type { InputAnythingConfig } from 'rollup-plugin-input-anything';
import inputAnything from 'rollup-plugin-input-anything';
import {
	formatGadgetsDefinition,
	readGadgetDefinition,
	type GadgetBuildOptions,
} from './definition.js';

export {
	parseGadgetDefinition,
	readGadgetDefinition,
	type GadgetBuildOptions as NormalizedGadgetDefinition,
} from './definition.js';

export interface GadgetConfig {
	definitionFormat?: 'json' | 'wikitext';
	transformDynamicImport?: boolean;
	inputAnythingOptions?: InputAnythingConfig | InputAnythingConfig[];
	inputCSS?: boolean | InputAnythingConfig;
	inputJSON?: boolean | InputAnythingConfig;
}

export default function mwGadget(config: GadgetConfig = {}): Plugin[] {
	const definitionFormat = config.definitionFormat ?? 'json';
	if (definitionFormat !== 'json' && definitionFormat !== 'wikitext')
		throw new TypeError(`Unknown gadget definition format: ${definitionFormat}`);
	const inputAnythingOptions: InputAnythingConfig[] = [
		...[config.inputAnythingOptions ?? []].flat(),
	];

	const inputCSS = config.inputCSS ?? true;
	const inputJSON = config.inputJSON ?? true;
	if (inputCSS)
		inputAnythingOptions.push(
			typeof inputCSS === 'boolean' ? { extensions: '.css' } : inputCSS
		);
	if (inputJSON)
		inputAnythingOptions.push(
			typeof inputJSON === 'boolean' ? { extensions: '.json' } : inputJSON
		);
	const loaderConfig = {
		wrapLoaderUsing: false,
		dependencies: [] as string[],
		gadgetDependencies: [] as string[],
		transformAllDynamicImports: config.transformDynamicImport,
	};
	let definition: GadgetBuildOptions | undefined;
	let definitionFile: string | undefined;

	return [
		...mwLoader(loaderConfig),
		{
			name: 'mediawiki-gadget',
			async options(options) {
				if (typeof options.input !== 'string')
					return this.error(
						'Gadget input must be one JSON definition file, for example input: "src/gadget.json"'
					);

				definitionFile = path.resolve(options.input);
				try {
					definition = await readGadgetDefinition(definitionFile);
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					return this.error(
						`Could not read gadget definition ${JSON.stringify(options.input)}: ${reason}`
					);
				}

				loaderConfig.dependencies = definition.dependencies;
				loaderConfig.gadgetDependencies = definition.gadgetDependencies;
				return {
					...options,
					input: definition.input,
				} as InputOptions;
			},
			buildStart() {
				if (!definition || !definitionFile)
					return this.error('Gadget definition was not initialized');
				this.addWatchFile(definitionFile);
				switch (definitionFormat) {
					case 'json':
						this.emitFile({
							type: 'asset',
							fileName: `Gadgets/${definition.name}.json`,
							source: JSON.stringify(definition.definition, null, '\t') + '\n',
						});
						break;
					case 'wikitext':
						if (definition.definition.module?.messages?.length)
							this.warn(
								'module.messages is not supported by MediaWiki:Gadgets-definition and was omitted'
							);
						this.emitFile({
							type: 'asset',
							fileName: 'Gadgets-definition',
							source: formatGadgetsDefinition(definition),
						});
						break;
					default:
						return this.error(`Unknown gadget definition format: ${definitionFormat}`);
				}
			},
			outputOptions(options) {
				return {
					...options,
					format: 'cjs',
					exports:
						(definition?.definition?.settings?.package ?? false)
							? (options.exports ?? 'auto')
							: 'none',
					entryFileNames: '[name]',
					assetFileNames: '[name][extname]',
					chunkFileNames: ({ moduleIds }) => {
						throw new Error(`Undefined chunk detected: ${moduleIds}`);
					},
				};
			},
			generateBundle: {
				order: 'post',
				handler(_, bundle) {
					const definitionFileName =
						definitionFormat === 'json'
							? `Gadgets/${definition?.name}.json`
							: 'Gadgets-definition';
					for (const output of Object.values(bundle))
						if (output.fileName !== definitionFileName)
							output.fileName = `Gadget-${output.fileName}`;
				},
			},
		},
		inputAnything(...inputAnythingOptions),
	];
}
