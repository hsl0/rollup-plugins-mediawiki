import type { Plugin } from 'rollup';

export interface MediaWikiResolveConfig {
	dependencies: string[];
	gadgetDependencies?: string[];
	loadURL: string;
	bundleStartup?: boolean;
}

const gadgetPrefix = 'ext.gadget.';

function moduleURL(loadURL: string, moduleID: string): string {
	return `${loadURL}?modules=${encodeURIComponent(moduleID)}&only=scripts`;
}

export default function mwResolve(config: MediaWikiResolveConfig): Plugin {
	const { loadURL } = config;

	return {
		name: 'mediawiki-resolve',
		transform(code, id) {
			if (!config.bundleStartup) return null;
			if (id.startsWith('\0') || id.startsWith(loadURL)) return null;

			return `import '\0startup';\n` + code;
		},
		resolveId(source, importer) {
			if (source === '\0startup') {
				return {
					id: moduleURL(loadURL, 'startup'),
					moduleSideEffects: true,
				};
			}

			const gadget = source.startsWith(gadgetPrefix)
				? source.slice(gadgetPrefix.length)
				: source;
			const moduleID = config.dependencies?.includes(source)
				? source
				: config.gadgetDependencies?.includes(gadget)
					? `${gadgetPrefix}${gadget}`
					: null;

			if (moduleID) {
				return {
					id: moduleURL(loadURL, moduleID),
					moduleSideEffects: true,
				};
			}

			return null;
		},
	};
}
