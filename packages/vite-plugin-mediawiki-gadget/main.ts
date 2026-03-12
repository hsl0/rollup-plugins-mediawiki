import rollupMwGadget from 'rollup-plugin-mediawiki-gadget';
import type { Plugin, UserConfig } from 'vite';
import type { GadgetConfig as RollupGadgetConfig } from 'rollup-plugin-mediawiki-gadget';

type GadgetConfig = Omit<RollupGadgetConfig, 'inputCSS'>;

export default function mwGadget(pluginConfig: GadgetConfig): Plugin[] {
	return [
		...rollupMwGadget({ ...pluginConfig, inputCSS: false }),
		{
			name: 'vite:mediawiki-gadget',
			config(config, env) {
				return {
					build: {
						lib: {
							cssFileName: pluginConfig.name,
						},
						cssCodeSplit: config.build?.cssCodeSplit ?? true,
						minify: config.build?.minify ?? false,
					},
				} as UserConfig;
			},
			options(options) {
				const inputs: Record<string, string> = {}; // JS, CSS entries

				for (const [output, input] of Object.entries(
					options.input as Record<string, string>
				)) {
					if (/\.(css)$/.test(output)) {
						inputs[output.slice(0, -3)] = input; // sub
					} else inputs[output] = input;
				}

				return { ...options, input: inputs };
			},
		},
	];
}
