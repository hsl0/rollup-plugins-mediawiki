import { describe, expect, test } from 'vitest';
import { rollup } from 'rollup';
import virtual from '@rollup/plugin-virtual';
import mwResolve from '../src/main.js';

const testGlobal = globalThis as unknown as { result?: unknown };

describe('mediawiki-resolve', () => {
	test('loads configured ResourceLoader dependencies', async () => {
		const build = await rollup({
			input: 'input.js',
			plugins: [
				virtual({
					'input.js':
						"import { value } from 'mediawiki.test'; globalThis.result = value;",
				}),
				mwResolve({
					dependencies: ['mediawiki.test'],
					loadURL: 'virtual:load',
				}),
				{
					name: 'test-loader',
					load(id) {
						if (id === 'virtual:load?modules=mediawiki.test&only=scripts')
							return 'export const value = 42;';
					},
				},
			],
		});
		const { output } = await build.generate({ format: 'es', validate: true });
		await build.close();

		new Function(output[0].code)();
		expect(testGlobal.result).toBe(42);
		delete testGlobal.result;
	});

	test.each(['Example', 'ext.gadget.Example'])(
		'loads configured gadget dependency from %s',
		async (dependency) => {
			const build = await rollup({
				input: 'input.js',
				plugins: [
					virtual({
						'input.js': `import { value } from '${dependency}'; globalThis.result = value;`,
					}),
					mwResolve({
						dependencies: [],
						gadgetDependencies: ['Example'],
						loadURL: 'virtual:load',
					}),
					{
						name: 'test-loader',
						load(id) {
							if (id === 'virtual:load?modules=ext.gadget.Example&only=scripts')
								return 'export const value = 42;';
						},
					},
				],
			});
			const { output } = await build.generate({ format: 'es', validate: true });
			await build.close();

			new Function(output[0].code)();
			expect(testGlobal.result).toBe(42);
			delete testGlobal.result;
		}
	);
});
