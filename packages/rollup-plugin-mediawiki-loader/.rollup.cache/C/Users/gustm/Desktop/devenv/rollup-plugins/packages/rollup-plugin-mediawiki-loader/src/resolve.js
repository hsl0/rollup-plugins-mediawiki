export default function mwLoaderResolveGadgets(config) {
    return {
        name: 'mediawiki-loader/resolve',
        outputOptions(options) {
            return {
                ...options,
                format: 'cjs',
            };
        },
        resolveId(source) {
            if (config?.gadgetDependencies?.includes(source))
                return {
                    id: `ext.gadget.${source}`,
                    external: true,
                    resolvedBy: 'mediawiki-loader',
                };
            if (config?.dependencies?.includes(source))
                return {
                    id: source,
                    external: true,
                    resolvedBy: 'mediawiki-loader',
                };
        },
    };
}
//# sourceMappingURL=resolve.js.map