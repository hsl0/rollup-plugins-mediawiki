import type { Plugin, ResolveIdHook } from 'rollup';
import {
	protocols as defaultProtocols,
	namespaces as defaultNamespaces,
} from './defaultMappings.js';

type ModuleResolver = Extract<
	NonNullable<Plugin['resolveId']>,
	(...args: Parameters<ResolveIdHook>) => unknown
>;

interface ModuleMappings {
	wiki: ModuleResolver;
	loader: ModuleResolver;
}

interface PrefixMappings {
	wikiNamespaces: string[];
	urlProtocols: string[];
	forbiddenPrefix: string[];
	fallbackResolution: 'wiki' | 'url' | 'loader' | 'never';
}

interface RelativeMappings {
	relative: false | 'wiki';
}

export type MWPageResolveConfig = ModuleMappings & PrefixMappings & RelativeMappings;

function createPrefixMap({
	urlProtocols: protocols,
	wikiNamespaces: namespaces,
	forbiddenPrefix,
}: PrefixMappings) {
	const mappings: Record<string, 'protocol' | 'namespace' | 'forbidden'> =
		Object.create(null);
	protocols = protocols.map((prefix) => prefix.toLowerCase());
	namespaces = namespaces.map((prefix) => prefix.toLowerCase().replaceAll('_', ' '));
	forbiddenPrefix = forbiddenPrefix.map((prefix) =>
		prefix.toLowerCase().replaceAll('_', ' ')
	);
	const overwraps = new Set(namespaces).intersection(new Set(protocols));

	if (overwraps.size > 0) {
		throw new TypeError(
			`Prefix ${Array.from(overwraps).join(', ')} ${
				overwraps.size > 1 ? 'has' : 'have'
			} overwrapped definitions between URL protocol and Wiki namespace`
		);
	}

	for (const prefix of protocols) {
		mappings[prefix] = 'protocol';
	}
	for (const prefix of namespaces) {
		mappings[prefix] = 'namespace';
	}
	for (const prefix of forbiddenPrefix) {
		mappings[prefix] = 'forbidden';
	}

	return mappings;
}

function createModuleTransformer(mappings: MWPageResolveConfig): ModuleResolver {
	const prefixMappings = createPrefixMap(mappings);
	return function (name, importer, options) {
		if (
			name.includes('\0') ||
			/^[a-z]:[\\/]|^\\\\/i.test(name) ||
			options.custom?.['node-resolve']?.resolved
		)
			return null;
		if (/^\//.test(name)) return name; // / => url
		if (mappings.relative === 'wiki' && /^\.\.?(\/|$)/.test(name))
			return mappings.wiki.call(this, name, importer, options);
		if (/^[^\/#:]*:/.test(name))
			switch (prefixMappings[name.split(':')[0].replaceAll('_', ' ').toLowerCase()]) {
				case 'namespace':
					return mappings.wiki.call(this, name, importer, options); // wiki
				case 'protocol':
					return name; // url
				case 'forbidden':
					throw new TypeError(`Prefix "${name.split(':')[0]}" is forbidden`);
				default:
					switch (mappings.fallbackResolution) {
						case 'wiki':
							return mappings.wiki.call(this, name, importer, options);
						case 'url':
							return name;
						case 'loader':
							return mappings.loader.call(this, name, importer, options);
						case 'never':
							throw new TypeError(`Unknown prefix detected: ${name.split(':')[0]}`);
					}
			}
		return mappings.loader.call(this, name, importer, options);
	};
}

export default function mwPageResolve(mappings: Partial<MWPageResolveConfig>): Plugin {
	if (!mappings.urlProtocols) mappings.urlProtocols = defaultProtocols;
	if (!mappings.wikiNamespaces) mappings.wikiNamespaces = defaultNamespaces;
	if (!mappings.forbiddenPrefix) mappings.forbiddenPrefix = [];
	if (!mappings.fallbackResolution) mappings.fallbackResolution = 'wiki';
	if (!mappings.loader) mappings.loader = (name: string) => null;
	if (!mappings.wiki) mappings.wiki = (name: string) => null;

	const transform = createModuleTransformer(mappings as MWPageResolveConfig);

	return {
		name: 'mediawiki-page-resolve',
		async resolveId(source, importer, options) {
			return transform.call(this, source, importer, options);
		},
	};
}
