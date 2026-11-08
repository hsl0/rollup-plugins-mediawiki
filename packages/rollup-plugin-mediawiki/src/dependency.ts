import type { NormalizedOutputOptions, Plugin } from 'rollup';
import type { RequireBindingFilter } from 'rollup-plugin-require-binding';

const gadgetPrefix = 'ext.gadget.';
const excludeAll = /.*/;

export const originalDependencyKey = Symbol('mediawiki-loader/original-dependency');

export interface LoaderDependenciesConfig {
	dependencies?: string[];
	gadgetDependencies?: string[];
	transformAllDynamicImports?: boolean;
}

function resolveResourceLoaderId(
	source: string,
	config?: LoaderDependenciesConfig
): string | null {
	if (config?.dependencies?.includes(source)) return source;
	if (config?.gadgetDependencies?.includes(source)) return `${gadgetPrefix}${source}`;
	if (
		source.startsWith(gadgetPrefix) &&
		config?.gadgetDependencies?.includes(source.slice(gadgetPrefix.length))
	)
		return source;
	return null;
}

// Relative paths, absolute paths (including Windows drives) and URLs are not ResourceLoader modules.
function isLocalOrURL(specifier: string): boolean {
	return /^\.{1,2}(\/|$)|^\/|^[a-z][a-z0-9+.-]*:/i.test(specifier);
}

function makeRequireBindingTargets(config?: LoaderDependenciesConfig): string[] {
	const gadgets = config?.gadgetDependencies ?? [];
	return [
		...new Set([
			...(config?.dependencies ?? []),
			...gadgets,
			...gadgets.map((id) => `${gadgetPrefix}${id}`),
		]),
	];
}

function stringifyPolicy(targets: string[], transformAllDynamicImports: boolean): string {
	return JSON.stringify([targets, transformAllDynamicImports]);
}

function comparePolicy(previous: string | undefined, current: string): boolean {
	return previous !== undefined && previous !== current;
}

export default function mwDependency(
	config: LoaderDependenciesConfig | undefined,
	target: RequireBindingFilter
): Plugin {
	let outputOptions: NormalizedOutputOptions;
	let previousPolicy: string | undefined;
	let policyChanged = false;

	return {
		name: 'mediawiki',

		options: {
			order: 'post',
			handler() {
				const nextBindingTargets = makeRequireBindingTargets(config);
				const policy = stringifyPolicy(
					nextBindingTargets,
					Boolean(config?.transformAllDynamicImports)
				);
				policyChanged = comparePolicy(previousPolicy, policy);
				previousPolicy = policy;
				target.include = nextBindingTargets;
				target.exclude = nextBindingTargets.length > 0 ? undefined : excludeAll;
			},
		},

		shouldTransformCachedModule() {
			return policyChanged;
		},

		renderStart(options) {
			outputOptions = options;
		},

		resolveDynamicImport(specifier) {
			if (typeof specifier !== 'string') return null; // skip

			if (config?.transformAllDynamicImports)
				return isLocalOrURL(specifier) ? null : false; // external

			const id = resolveResourceLoaderId(specifier, config);

			if (!id) return null; // skip

			return { id, external: true };
		},
		async resolveId(source, importer, options) {
			const actualId = resolveResourceLoaderId(source, config);
			if (!actualId) return null; // skip
			const resolved = await this.resolve(actualId, importer, {
				...options,
				skipSelf: true,
			});
			if (!resolved) return null; // skip
			return {
				...resolved,
				meta: {
					...resolved.meta,
					[originalDependencyKey]: actualId,
				},
			};
		},

		renderDynamicImport({ targetModuleId }) {
			if (config?.transformAllDynamicImports) {
				if (targetModuleId && isLocalOrURL(targetModuleId)) return null;
			} else if (
				!targetModuleId ||
				resolveResourceLoaderId(targetModuleId, config) !== targetModuleId
			)
				return null;
			return {
				left:
					(outputOptions.generatedCode.arrowFunctions
						? `((module) => mw.loader.using(module).then((require) => require(module)))`
						: `(function (module) { return mw.loader.using(module).then(function (require) { return require(module); }) })`) +
					'(',
				right: ')',
			};
		},
	};
}
