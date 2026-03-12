import rollupMwGadget from 'rollup-plugin-mediawiki-gadget';
export default function mwGadget(pluginConfig) {
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
                };
            },
            options(options) {
                const inputs = {}; // JS, CSS entries
                for (const [output, input] of Object.entries(options.input)) {
                    if (/\.(css)$/.test(output)) {
                        inputs[output.slice(0, -3)] = input; // sub
                    }
                    else
                        inputs[output] = input;
                }
                return { ...options, input: inputs };
            },
        },
    ];
}
//# sourceMappingURL=main.js.map