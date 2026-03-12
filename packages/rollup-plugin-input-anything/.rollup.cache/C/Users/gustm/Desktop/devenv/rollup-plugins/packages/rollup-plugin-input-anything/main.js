import { toArray } from '#monorepo-root/util.js';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
function toRecord(input) {
    if (typeof input === 'string')
        return { [path.basename(input, '.js')]: input };
    if (Array.isArray(input))
        return Object.fromEntries(input.map((input) => [path.basename(input, '.js'), input]));
    return input;
}
export default function inputAnything(...configs) {
    const assets = [];
    return {
        name: 'input-anything',
        options(options) {
            if (!options.input)
                return;
            const inputs = toRecord(options.input);
            for (const [output, input] of Object.entries(inputs)) {
                for (const config of configs)
                    if (config.pattern?.test(input) ||
                        toArray(config.extensions).some((ext) => input.endsWith(ext))) {
                        delete inputs[output];
                        assets.push({
                            input,
                            output,
                            transformer: toArray(config.transformer),
                        });
                    }
            }
            return { ...options, input: inputs };
        },
        async buildStart(options) {
            await Promise.all(assets.map(async ({ output, input, transformer: transformers }) => {
                const resolved = (await this.resolve(input))?.id;
                let source = (await readFile(resolved || input)).toString();
                for (const transformer of transformers)
                    source = await transformer(source);
                this.emitFile({
                    type: 'asset',
                    originalFileName: input,
                    name: output,
                    source,
                    needsCodeReference: false,
                });
            }));
        },
    };
}
//# sourceMappingURL=main.js.map