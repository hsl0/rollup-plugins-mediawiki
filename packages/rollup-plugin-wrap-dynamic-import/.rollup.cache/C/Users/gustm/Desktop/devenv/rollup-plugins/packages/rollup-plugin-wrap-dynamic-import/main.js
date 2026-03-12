export default function wrapDynamicImport() {
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
//# sourceMappingURL=main.js.map