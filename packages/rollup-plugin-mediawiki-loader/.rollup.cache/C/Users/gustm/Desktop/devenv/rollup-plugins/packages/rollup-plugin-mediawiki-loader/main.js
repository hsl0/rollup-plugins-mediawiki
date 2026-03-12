import mwLoaderDynamicImport from './src/dynamic-import.js';
import mwLoaderResolve from './src/resolve.js';
import mwLoaderUsing from './src/using.js';
export default function mwLoader(config) {
    const plugins = [mwLoaderResolve(config)];
    if (config?.transformDynamicImport ?? true)
        plugins.push(mwLoaderDynamicImport());
    if (config?.wrapLoaderUsing ?? true)
        plugins.push(mwLoaderUsing(config));
    return plugins;
}
//# sourceMappingURL=main.js.map