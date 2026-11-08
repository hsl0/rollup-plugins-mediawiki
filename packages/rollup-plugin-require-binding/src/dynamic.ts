import type { NormalizedOutputOptions, Plugin } from 'rollup';
import type { NormalizedRequireBindingOptions } from '../main.js';

export default function dynamicRequireBinding(
	options: NormalizedRequireBindingOptions
): Plugin {
	let outputOptions: NormalizedOutputOptions;

	return {
		name: 'require-binding/dynamic',

		resolveDynamicImport(specifier, importer) {
			if (options.importer && !options.importer(importer)) return null; // skip
			if (!options.target || (typeof specifier === 'string' && options.target(specifier)))
				return false; // Mark target as external
			return null; // skip
		},

		renderStart(options) {
			outputOptions = options;
		},

		renderDynamicImport: {
			order: 'post',
			handler({ moduleId, targetModuleId }) {
				if (options.importer && !options.importer(moduleId)) return null;
				if (options.target && (!targetModuleId || !options.target(targetModuleId)))
					return null;

				if (outputOptions.dynamicImportInCjs) return null; // fallback

				// Manually transform dynamic import to require
				return outputOptions.generatedCode.arrowFunctions
					? {
							left: 'Promise.resolve().then(() => require(',
							right: '))',
						}
					: {
							left: 'Promise.resolve().then(function () { return require(',
							right: '); })',
						};
			},
		},
	};
}
