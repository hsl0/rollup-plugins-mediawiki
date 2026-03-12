export default function mwLoaderDynamicImport() {
    let outputOptions;
    return {
        name: 'mediawiki-loader/dynamic-import',
        // Prevent URL imports to be resolved as local modules
        resolveDynamicImport(specifier, importer, options) {
            if (typeof specifier === 'string' && /^[^\/]\:|^\//.test(specifier))
                return false;
        },
        renderStart(options) {
            outputOptions = options;
        },
        renderDynamicImport({ targetModuleId }) {
            if (targetModuleId && !/^\.{1,2}\/?|^[^\/]\:|^\//.test(targetModuleId))
                return {
                    left: (outputOptions.generatedCode.arrowFunctions
                        ? `((module) => mw.loader.using(module).then((require) => require(module)))`
                        : `(function (module) { return mw.loader.using(module).then(function (require) { return require(module); }) })`) +
                        '(',
                    right: ')',
                };
        },
    };
}
//# sourceMappingURL=dynamic-import.js.map