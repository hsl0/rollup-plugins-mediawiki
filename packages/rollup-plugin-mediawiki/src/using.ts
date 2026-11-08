import { originalDependencyKey, type LoaderDependenciesConfig } from './dependency.js';
import MagicString from 'magic-string';
import type { GetModuleInfo, OutputPlugin, RenderedChunk } from 'rollup';

export type { LoaderDependenciesConfig };

function dependenciesForChunk(
	chunk: RenderedChunk,
	config: LoaderDependenciesConfig | undefined,
	getModuleInfo: GetModuleInfo
): string[] {
	const required = new Set(
		chunk.moduleIds
			.map((id) => getModuleInfo(id)?.meta[originalDependencyKey as unknown as string])
			.filter((id): id is string => typeof id === 'string')
	);
	const defined = new Set([
		...(config?.gadgetDependencies?.map((id) => `ext.gadget.${id}`) ?? []),
		...(config?.dependencies ?? []),
	]);

	return [...defined.intersection(required)];
}

export default function mwUsing(config?: LoaderDependenciesConfig): OutputPlugin {
	return {
		name: 'mediawiki/using',
		outputOptions(options) {
			return {
				...options,
				exports: 'none',
			};
		},
		renderChunk(code, chunk, options) {
			const dependencies = dependenciesForChunk(chunk, config, this.getModuleInfo);
			if (dependencies.length <= 0) return null;

			const ms = new MagicString(code);
			ms.prepend(
				`mw.loader.using(${JSON.stringify(dependencies)}).then(${options.generatedCode.arrowFunctions ? '(require) => {' : 'function (require) {'}\n`
			);
			ms.append('\n});');

			return {
				code: ms.toString(),
				map: ms.generateMap({ hires: 'boundary' }),
			};
		},
	};
}
