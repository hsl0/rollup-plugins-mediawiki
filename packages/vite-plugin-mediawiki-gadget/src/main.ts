import rollupMwGadget from 'rollup-plugin-mediawiki-gadget2';
import type { Plugin, UserConfig } from 'vite';
import type { GadgetConfig as RollupGadgetConfig } from 'rollup-plugin-mediawiki-gadget2';

type GadgetConfig = Omit<RollupGadgetConfig, 'inputCSS'>;

export default function mwGadget(pluginConfig: GadgetConfig = {}): Plugin[] {
	let input: Record<string, string> = {};
	let cssCodeSplit = true;
	const cssPages = () => Object.keys(input).filter((name) => name.endsWith('.css'));

	return [
		// Listed before the Rollup plugin so its post hooks see final names before `Gadget-` is added.
		{
			name: 'vite:mediawiki-gadget',
			config(config) {
				return {
					build: {
						cssCodeSplit: config.build?.cssCodeSplit ?? true,
						minify: config.build?.minify ?? false,
					},
				} as UserConfig;
			},
			configResolved(config) {
				cssCodeSplit = config.build.cssCodeSplit;
			},
			options: {
				order: 'post',
				handler(options) {
					input = options.input as Record<string, string>;
					return null;
				},
			},
			outputOptions: {
				order: 'post',
				handler(options) {
					// Keep the CSS asset off the name reserved by its (later removed) entry chunk; generateBundle strips the extra `.css`.
					return {
						...options,
						assetFileNames: (info) =>
							info.names.some((name) => name.endsWith('.css'))
								? '[name][extname].css'
								: '[name][extname]',
					};
				},
			},
			async buildEnd() {
				if (!cssCodeSplit && cssPages().length > 1)
					this.error('cssCodeSplit: false cannot emit multiple gadget CSS pages');

				const invalid: string[] = [];
				for (const name of cssPages()) {
					const resolved = await this.resolve(input[name]);
					const info = resolved && this.getModuleInfo(resolved.id);
					if (info?.importers.length || info?.dynamicImporters.length) invalid.push(name);
				}
				if (invalid.length)
					this.error(
						`Non-JavaScript gadget page ${JSON.stringify(invalid)} produced JavaScript or is referenced by another chunk`
					);
			},
			generateBundle: {
				order: 'post',
				handler(_, bundle) {
					const pages = cssPages();
					for (const file of Object.values(bundle)) {
						if (file.type === 'asset' && file.fileName.endsWith('.css')) {
							// Vite adds a numeric suffix when the removed CSS entry chunk reserved the name, and names the combined file after the package.
							if (cssCodeSplit)
								file.fileName = file.fileName.replace(/\.css\.css$/, '.css');
							else if (pages[0]) file.fileName = pages[0];
						}
					}
				},
			},
		},
		...rollupMwGadget({ ...pluginConfig, inputCSS: false }),
	];
}
