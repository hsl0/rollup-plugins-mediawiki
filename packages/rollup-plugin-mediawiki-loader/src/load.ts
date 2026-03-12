import type { Plugin } from 'rollup';

interface LoaderLoadConfig {
	loadURL?: string;
	bundleStartup: boolean;
}

export default function mwLoaderLoad(config?: LoaderLoadConfig): Plugin {
	const loadURL = config?.loadURL;

	return {
		name: 'mediawiki-loader/load',
		transform(code) {
			if (config?.bundleStartup) return `import '\0startup';\n` + code;
		},
		resolveId(id) {
			if (id === '\0startup') id = 'startup';
			return {
				id: `${loadURL}?modules=${encodeURIComponent(id)}&only=scripts`,
				external: false,
				moduleSideEffects: 'no-treeshake',
				resolvedBy: 'mediawiki-loader',
			};
		},
	};
}
