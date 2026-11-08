import type { Plugin } from 'rollup';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

type Transformer = (code: string) => string | Promise<string>;

export interface InputAnythingConfig {
	pattern?: RegExp;
	extensions?: string | string[];
	transformer?: Transformer | Transformer[];
}

interface Asset {
	input: string;
	output: string;
	transformer: Transformer[];
}

function toRecord(
	input: string | string[] | Record<string, string>
): Record<string, string> {
	if (typeof input === 'string') return { [path.basename(input, '.js')]: input };
	if (Array.isArray(input))
		return Object.fromEntries(input.map((input) => [path.basename(input, '.js'), input]));
	return input;
}

export default function inputAnything(...configs: InputAnythingConfig[]): Plugin {
	const assets: Asset[] = [];
	return {
		name: 'input-anything',
		options(options) {
			if (!options.input) return;

			const inputs: Record<string, string> = {};

			for (const [output, input] of Object.entries(toRecord(options.input))) {
				const matched = configs.filter(
					(config) =>
						config.pattern?.test(input) ||
						[config.extensions ?? []].flat().some((ext) => input.endsWith(ext))
				);
				if (!matched.length) {
					inputs[output] = input;
					continue;
				}
				if (matched.length > 1)
					this.warn(
						`${input} matches ${matched.length} input configs; only the first one is used`
					);
				assets.push({
					input,
					output,
					transformer: [matched[0].transformer ?? []].flat() as Transformer[],
				});
			}

			return { ...options, input: inputs };
		},
		async buildStart(options) {
			await Promise.all(
				assets.map(async ({ output, input, transformer: transformers }) => {
					const resolved = (await this.resolve(input))?.id;
					let source = (await readFile(resolved || input)).toString();

					for (const transformer of transformers) source = await transformer(source);

					this.emitFile({
						type: 'asset',
						originalFileName: input,
						name: output,
						source,
						needsCodeReference: false,
					});
				})
			);
		},
	};
}
