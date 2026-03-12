export function toArray(arr) {
    return Array.isArray(arr) ? arr : arr ? [arr] : [];
}
export function extendIntroOutro(...args) {
    return async (chunk) => (await Promise.all(args.map((x) => (typeof x === 'function' ? x(chunk) : x))))
        .filter((x) => x)
        .join('\n');
}
