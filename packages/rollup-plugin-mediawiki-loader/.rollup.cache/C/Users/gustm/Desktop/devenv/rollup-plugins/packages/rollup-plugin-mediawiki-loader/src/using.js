import { toArray } from '#monorepo-root/util.js';
export default function mwLoaderUsing(config) {
    let outputOptions;
    return {
        name: 'mediawiki-loader/using',
        outputOptions(options) {
            return {
                ...options,
                exports: 'none',
            };
        },
        renderStart(options) {
            outputOptions = options;
        },
        intro: () => `mw.loader.using(${JSON.stringify([
            ...toArray(config?.gadgetDependencies?.map((pkg) => 'ext.gadget.' + pkg)),
            ...toArray(config?.dependencies),
        ])}).then(${outputOptions.generatedCode.arrowFunctions ? '(require) => {' : 'function (require) {'}`,
        outro: '});',
    };
}
//# sourceMappingURL=using.js.map