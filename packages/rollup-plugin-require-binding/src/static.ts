import type { ExternalOption, IsExternal, Plugin } from 'rollup';
import type { NormalizedRequireBindingOptions } from '../main.js';

const virtualModulePrefix = '\0require-binding:';

function toVirtualModuleId(target: string): string {
	return `${virtualModulePrefix}${encodeURIComponent(target)}`;
}

function isVirtualModuleId(id: string): boolean {
	return id.startsWith(virtualModulePrefix);
}

function fromVirtualModuleId(id: string): string | null {
	if (!isVirtualModuleId(id))
		throw new TypeError(
			`Module ID ${JSON.stringify(id)} is not a require-binding virtual module ID.`
		);
	return decodeURIComponent(id.slice(virtualModulePrefix.length));
}

function getExternalMatcher(option: ExternalOption | undefined): IsExternal {
	if (typeof option === 'function')
		return (id, importer, isResolved) =>
			(!id.startsWith('\0') && option(id, importer, isResolved)) || false;
	const patterns = option ? (Array.isArray(option) ? option : [option]) : [];
	return (id) =>
		patterns.some((pattern) =>
			typeof pattern === 'string' ? pattern === id : pattern.test(id)
		);
}

function matches(filter: ((id: string) => boolean) | null, id: string): boolean {
	return !filter || filter(id);
}

export default function staticRequireBinding(
	normalized: NormalizedRequireBindingOptions
): Plugin {
	return {
		name: 'require-binding',

		options: {
			order: 'post',
			handler(options) {
				const external = getExternalMatcher(options.external);
				return {
					...options,
					external(id, importer, isResolved) {
						if (
							importer &&
							matches(normalized.importer, importer) &&
							matches(normalized.target, id)
						)
							return false;
						return external(id, importer, isResolved);
					},
				};
			},
		},

		resolveId(source, importer) {
			if (
				!importer ||
				!matches(normalized.importer, importer) ||
				!matches(normalized.target, source)
			)
				return null;
			return toVirtualModuleId(source);
		},

		load(id) {
			if (!isVirtualModuleId(id)) return null;
			const target = fromVirtualModuleId(id);
			return {
				code: `export default require(${JSON.stringify(target)});`,
				syntheticNamedExports: 'default',
			};
		},

		moduleParsed({ ast, id }) {
			// Throw an error if the module contains `export * from '...'` statements, because Rollup cannot know the names of the exports at runtime so that it couldn't export them from the require() call.
			if (!ast || !matches(normalized.importer, id)) return;
			for (const node of ast.body) {
				if (
					node.type === 'ExportAllDeclaration' && // export *
					!node.exported && // not have `as` clause
					typeof node.source.value === 'string' &&
					matches(normalized.target, node.source.value)
				)
					this.error(
						`Cannot bind "export * from ${JSON.stringify(node.source.value)}" to require(): runtime export names are not known to Rollup. So they cannot be mapped from require(). Use named exports instead.
Try:
export * as default from ${JSON.stringify(node.source.value)};`
					);
			}
		},
	};
}
