import type { Plugin } from 'rollup';

export default function wrapDynamicImport(): Plugin {
    return {
        name: 'wrap-dynamic-import',
        renderDynamicImport() {
            return {
                left: "new Function('module', 'import(module)')(",
                right: ')',
            };
        },
    };
}
