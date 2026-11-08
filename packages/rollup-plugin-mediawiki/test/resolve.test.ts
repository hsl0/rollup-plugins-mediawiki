import { describe, expect, test, vi } from 'vitest';
import { rollup, type InputOptions, type OutputOptions, type Plugin } from 'rollup';
import mediawiki from '../src/main.js';
import type { LoaderDependenciesConfig } from '../src/dependency.js';

const testGlobal = globalThis as unknown as { result?: unknown; load?: unknown };

function fixture(modules: Record<string, string>): Plugin {
	return {
		name: 'mediawiki-loader/test-fixture',
		resolveId(source) {
			return source in modules ? source : null;
		},
		load(id) {
			return modules[id] ?? null;
		},
	};
}

async function bundle(
	code: string,
	config: LoaderDependenciesConfig,
	plugins: Plugin[] = mediawiki({ ...config, wrapLoaderUsing: false }),
	inputOptions: Partial<InputOptions> = {},
	outputOptions: OutputOptions = { format: 'es', validate: true }
) {
	const build = await rollup({
		...inputOptions,
		input: 'input.js',
		plugins: [fixture({ 'input.js': code }), ...plugins],
	});
	const { output } = await build.generate(outputOptions);
	await build.close();
	return output[0].code;
}

describe('mediawiki-loader/dependency', () => {
	test('adapts default and named imports to one require call', async () => {
		const code = await bundle(
			`
				import resource, { value } from 'mediawiki.test';
				globalThis.result = [resource, value];
			`,
			{ dependencies: ['mediawiki.test'] }
		);
		const resource = { value: 42 };
		const require = vi.fn(() => resource);

		new Function('require', code)(require);

		expect(require).toHaveBeenCalledOnce();
		expect(require).toHaveBeenCalledWith('mediawiki.test');
		expect(testGlobal.result).toEqual([resource, 42]);
		delete testGlobal.result;
	});

	test('supports namespace imports and explicit re-exports', async () => {
		const namespaceCode = await bundle(
			`import * as resource from 'mediawiki.test'; globalThis.result = resource;`,
			{ dependencies: ['mediawiki.test'] }
		);
		const resource = { value: 42 };
		const require = vi.fn(() => resource);

		new Function('require', namespaceCode)(require);

		expect(require).toHaveBeenCalledOnce();
		expect(testGlobal.result).toEqual(resource);
		delete testGlobal.result;

		const reexportCode = await bundle(`export { value } from 'mediawiki.test';`, {
			dependencies: ['mediawiki.test'],
		});
		expect(reexportCode).toMatch(/require\(["']mediawiki\.test["']\)/);
		expect(reexportCode).toMatch(/= .*\.value;/);
		expect(reexportCode).toMatch(/export \{ value \}/);
	});

	test('preserves side-effect imports and merges repeated imports', async () => {
		const code = await bundle(
			`
				import 'mediawiki.test';
				import first from 'mediawiki.test';
				import second from 'mediawiki.test';
				globalThis.result = first === second;
			`,
			{ dependencies: ['mediawiki.test'] }
		);
		const require = vi.fn(() => ({}));

		new Function('require', code)(require);

		expect(require).toHaveBeenCalledOnce();
		expect(testGlobal.result).toBe(true);
		delete testGlobal.result;
	});

	test('maps gadget dependencies to ext.gadget ids', async () => {
		const code = await bundle(
			`import gadget from 'Example'; globalThis.result = gadget;`,
			{ gadgetDependencies: ['Example'] }
		);
		const require = vi.fn(() => ({ loaded: true }));

		new Function('require', code)(require);

		expect(require).toHaveBeenCalledWith('ext.gadget.Example');
		delete testGlobal.result;
	});

	test('resolves and renders only configured dynamic dependencies', async () => {
		const code = await bundle(
			`
				globalThis.loadConfigured = () => import('mediawiki.test');
				globalThis.loadOther = () => import('other-module');
				globalThis.loadURL = () => import('https://example.test/module.js');
			`,
			{ dependencies: ['mediawiki.test'] },
			mediawiki({ dependencies: ['mediawiki.test'], wrapLoaderUsing: false })
		);

		expect(code).toContain(`mw.loader.using(module)`);
		expect(code).toContain(`('mediawiki.test')`);
		expect(code).toContain(`import('other-module')`);
		expect(code).toContain(`import('https://example.test/module.js')`);
	});

	test('transforms every dynamic import when enabled', async () => {
		const code = await bundle(
			`
				globalThis.loadBare = () => import('mediawiki.unconfigured');
				globalThis.loadVariable = (module) => import(module);
			`,
			{ transformAllDynamicImports: true }
		);

		expect(code).not.toContain('import(');
		expect(code.match(/mw\.loader\.using\(module\)/g)).toHaveLength(2);
		expect(code).toContain(`('mediawiki.unconfigured')`);
		expect(code).toMatch(/\)\(module\)/);
	});

	test('leaves relative paths and URLs alone even when transforming every dynamic import', async () => {
		const build = await rollup({
			input: 'input.js',
			plugins: [
				fixture({
					'input.js': `
						globalThis.loadLocal = () => import('./lazy.js');
						globalThis.loadURL = () => import('https://example.test/module.js');
						globalThis.loadBare = () => import('mediawiki.unconfigured');
					`,
					'./lazy.js': 'export default 1;',
				}),
				...mediawiki({ transformAllDynamicImports: true, wrapLoaderUsing: false }),
			],
		});
		const { output } = await build.generate({ format: 'es', validate: true });
		await build.close();
		const entry = output[0].code;

		expect(entry).toContain(`import('https://example.test/module.js')`);
		expect(entry).not.toMatch(/mw\.loader\.using\(module\)\)\('(\.|https)/);
		expect(entry).toContain(`('mediawiki.unconfigured')`); // bare ids are still transformed
		expect(output.some((chunk) => chunk.type === 'chunk' && chunk !== output[0])).toBe(
			true
		); // lazy.js stays a real chunk
	});

	test.each(['es', 'cjs'] as const)(
		'adapts static imports and dynamically loads the same module in %s output',
		async (format) => {
			const code = await bundle(
				`
					import resource from 'mediawiki.test';
					globalThis.result = resource;
					globalThis.load = () => import('mediawiki.test');
				`,
				{ dependencies: ['mediawiki.test'] },
				mediawiki({ dependencies: ['mediawiki.test'], wrapLoaderUsing: false }),
				{},
				{ format, validate: true }
			);

			expect(code).toMatch(/require\(["']mediawiki\.test["']\)/);
			expect(code).toContain(`mw.loader.using(module)`);
			expect(code).toContain(`('mediawiki.test')`);
		}
	);

	test.each([
		['string', ['mediawiki.test']],
		['regexp', /^mediawiki\./],
		['function', (id: string) => id === 'mediawiki.test'],
	] as Array<[string, InputOptions['external']]>)(
		'honors %s external configuration and still transforms dynamic imports',
		async (_name, external) => {
			const code = await bundle(
				`
					import resource from 'mediawiki.test';
					globalThis.result = resource;
					globalThis.load = () => import('mediawiki.test');
				`,
				{ dependencies: ['mediawiki.test'] },
				mediawiki({ dependencies: ['mediawiki.test'], wrapLoaderUsing: false }),
				{ external }
			);

			expect(code).toMatch(/require\(["']mediawiki\.test["']\)/);
			expect(code).toContain(`mw.loader.using(module)`);
		}
	);

	test('normalizes gadget aliases for adapters and external dynamic imports', async () => {
		const code = await bundle(
			`
				import first from 'Example';
				import second from 'ext.gadget.Example';
				globalThis.result = first === second;
				globalThis.load = () => import('Example');
			`,
			{ gadgetDependencies: ['Example'] },
			mediawiki({ gadgetDependencies: ['Example'], wrapLoaderUsing: false })
		);

		expect(code.match(/require\(["']ext\.gadget\.Example["']\)/g)).toHaveLength(1);
		expect(code).toContain(`mw.loader.using(module)`);
		expect(code).toContain(`('ext.gadget.Example')`);
	});

	test('normalizes a gadget alias that is external before resolution', async () => {
		const code = await bundle(
			`globalThis.load = () => import('Example');`,
			{ gadgetDependencies: ['Example'] },
			mediawiki({ gadgetDependencies: ['Example'], wrapLoaderUsing: false }),
			{ external: ['Example'] }
		);

		expect(code).toContain(`mw.loader.using(module)`);
		expect(code).toContain(`('ext.gadget.Example')`);
	});

	test('preserves dynamic ResourceLoader handling across cached builds', async () => {
		const plugins = [
			fixture({
				'input.js': `globalThis.load = () => import('mediawiki.test');`,
			}),
			...mediawiki({
				dependencies: ['mediawiki.test'],
				wrapLoaderUsing: false,
			}),
		];
		const firstBuild = await rollup({ input: 'input.js', plugins });
		const firstOutput = await firstBuild.generate({ format: 'es', validate: true });
		const cache = firstBuild.cache;
		await firstBuild.close();

		const secondBuild = await rollup({ input: 'input.js', plugins, cache });
		const secondOutput = await secondBuild.generate({
			format: 'es',
			validate: true,
		});
		await secondBuild.close();

		expect(firstOutput.output[0].code).toContain(`mw.loader.using(module)`);
		expect(secondOutput.output[0].code).toBe(firstOutput.output[0].code);
	});

	test('re-resolves cached modules after dependencies change', async () => {
		const config = {
			dependencies: ['mediawiki.first'],
			wrapLoaderUsing: false,
		};
		const plugins = [
			fixture({
				'input.js': `import value from 'mediawiki.first'; console.log(value);`,
			}),
			...mediawiki(config),
		];
		const inputOptions = {
			input: 'input.js',
			external: ['mediawiki.first'],
			plugins,
		};
		const firstBuild = await rollup(inputOptions);
		const firstOutput = await firstBuild.generate({ format: 'es', validate: true });
		const cache = firstBuild.cache;
		await firstBuild.close();

		config.dependencies.splice(0, config.dependencies.length, 'mediawiki.second');
		const secondBuild = await rollup({ ...inputOptions, cache });
		const secondOutput = await secondBuild.generate({
			format: 'es',
			validate: true,
		});
		await secondBuild.close();

		expect(firstOutput.output[0].code).toMatch(/require\(["']mediawiki\.first["']\)/);
		expect(secondOutput.output[0].code).toContain(`from 'mediawiki.first'`);
	});

	test('does not bind imports when no dependencies are configured', async () => {
		const code = await bundle(
			`import react from 'react'; console.log(react);`,
			{},
			mediawiki({ wrapLoaderUsing: false }),
			{ external: ['react'] }
		);

		expect(code).toContain(`from 'react'`);
		expect(code).not.toMatch(/require\(["']react["']\)/);
	});

	test('still composes with the using wrapper', async () => {
		const build = await rollup({
			input: 'input.js',
			plugins: [
				fixture({
					'input.js': `import value from 'mediawiki.test'; console.log(value);`,
				}),
				...mediawiki({
					dependencies: ['mediawiki.test'],
				}),
			],
		});
		const { output } = await build.generate({
			generatedCode: { arrowFunctions: true },
			validate: true,
		});
		await build.close();
		const code = output[0].code;

		expect(code).toContain(`mw.loader.using(["mediawiki.test"])`);
		expect(code).toContain('(require) => {');
		expect(code).toMatch(/require\(["']mediawiki\.test["']\)/);
	});

	test.each([false, true])(
		'wraps the complete IIFE and waits for dependencies (arrowFunctions: %s)',
		async (arrowFunctions) => {
			const onwarn = vi.fn();
			const build = await rollup({
				input: 'input.js',
				onwarn,
				plugins: [
					fixture({ 'input.js': `import value from 'mediawiki.test'; record(value);` }),
					...mediawiki({ dependencies: ['mediawiki.test'] }),
				],
			});
			const { output } = await build.generate({
				format: 'iife',
				generatedCode: { arrowFunctions },
				sourcemap: true,
				validate: true,
			});
			await build.close();
			const chunk = output[0];
			expect(chunk.code).toMatch(/^mw\.loader\.using\(/);
			expect(chunk.code).toContain(
				arrowFunctions ? '(require) => {' : 'function (require) {'
			);
			expect(chunk.map?.sourcesContent).toContain(
				`import value from 'mediawiki.test'; record(value);`
			);
			expect(onwarn).not.toHaveBeenCalled();

			const record = vi.fn();
			const require = vi.fn(() => 42);
			let callback!: (loaderRequire: typeof require) => void;
			const using = vi.fn(() => ({
				then: (handler: typeof callback) => {
					callback = handler;
				},
			}));
			new Function('mw', 'record', chunk.code)({ loader: { using } }, record);
			expect(using).toHaveBeenCalledWith(['mediawiki.test']);
			expect(record).not.toHaveBeenCalled();
			callback(require);
			expect(require).toHaveBeenCalledWith('mediawiki.test');
			expect(record).toHaveBeenCalledWith(42);
		}
	);

	test('wraps each chunk with only its static dependencies', async () => {
		const build = await rollup({
			input: {
				first: 'first.js',
				second: 'second.js',
				plain: 'plain.js',
				dynamic: 'dynamic.js',
			},
			plugins: [
				fixture({
					'first.js': `
						import first from 'mediawiki.first';
						import second from 'mediawiki.first';
						console.log(first, second);
					`,
					'second.js': `
						import gadget from 'Example';
						import value from 'mediawiki.second';
						console.log(gadget, value);
					`,
					'plain.js': `console.log('plain');`,
					'dynamic.js': `globalThis.load = () => import('mediawiki.dynamic');`,
				}),
				...mediawiki({
					dependencies: ['mediawiki.first', 'mediawiki.second', 'mediawiki.dynamic'],
					gadgetDependencies: ['Example'],
				}),
			],
		});
		const { output } = await build.generate({
			format: 'cjs',
			entryFileNames: '[name].js',
			generatedCode: { arrowFunctions: false },
			validate: true,
		});
		await build.close();
		const chunks = Object.fromEntries(
			output
				.filter(
					(output): output is import('rollup').OutputChunk => output.type === 'chunk'
				)
				.map(({ fileName, code }) => [fileName, code])
		);

		expect(chunks['first.js']).toContain(`mw.loader.using(["mediawiki.first"])`);
		expect(chunks['second.js']).toContain(
			`mw.loader.using(["ext.gadget.Example","mediawiki.second"])`
		);
		expect(chunks['first.js']).toContain('function (require) {');
		expect(chunks['plain.js']).not.toContain('mw.loader.using');
		expect(chunks['dynamic.js']).not.toContain('mw.loader.using([');
		expect(chunks['dynamic.js']).toContain('mw.loader.using(module)');
	});
});
