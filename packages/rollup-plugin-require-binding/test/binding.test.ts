import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
	rollup,
	type InputOptions,
	type InternalModuleFormat,
	type OutputOptions,
	type Plugin,
} from 'rollup';
import requireBinding, { type RequireBindingOptions } from '../src/main.js';

function fixture(modules: Record<string, string>): Plugin {
	const resolvedModules = new Map(
		Object.entries(modules).map(([id, code]) => [path.resolve(id), code])
	);

	return {
		name: 'require-binding/test-fixture',
		resolveId(source, importer) {
			const id = importer?.startsWith(path.parse(importer).root)
				? path.resolve(path.dirname(importer), source)
				: path.resolve(source);
			return resolvedModules.has(id) ? id : null;
		},
		load(id) {
			return resolvedModules.get(id) ?? null;
		},
	};
}

async function bundle(
	modules: Record<string, string>,
	options: RequireBindingOptions = {},
	outputOptions: OutputOptions = { format: 'es', validate: true },
	inputOptions: Partial<InputOptions> = {}
): Promise<string> {
	const build = await rollup({
		...inputOptions,
		input: Object.keys(modules)[0],
		plugins: [fixture(modules), requireBinding(options)],
	});
	const { output } = await build.generate(outputOptions);
	await build.close();
	return output[0].code;
}

describe('require-binding', () => {
	test('keeps bundled, normal external, require-bound, and ES exports together', async () => {
		const code = await bundle(
			{
				'src/main.js': `
					import localValue from './local.js';
					import react from 'react';
					import mwApi from 'mediawiki.api';
					export const run = () => [localValue, react, mwApi];
				`,
				'src/local.js': 'export default 42;',
			},
			{ target: { include: 'mediawiki.api' } },
			{ format: 'es', validate: true },
			{ external: ['react', 'mediawiki.api'] }
		);

		expect(code).toContain("from 'react'");
		expect(code).toMatch(/require\(["']mediawiki\.api["']\)/);
		expect(code).not.toContain('./local.js');
		expect(code).toContain('export { run }');
	});

	test.each([
		['regexp', /^foo$/],
		['function', (id: string) => id === 'foo'],
	] as Array<[string, InputOptions['external']]>)(
		'overrides %s external configuration for require-bound imports',
		async (_name, external) => {
			const code = await bundle(
				{ 'src/main.js': `import foo from 'foo'; console.log(foo);` },
				{ target: { include: 'foo' } },
				undefined,
				{ external }
			);
			expect(code).toMatch(/require\(["']foo["']\)/);
		}
	);

	test('uses symmetric importer and target filters', async () => {
		const included = await bundle(
			{
				'src/main.js': `import foo from 'foo'; import bar from 'bar'; console.log(foo, bar);`,
			},
			{
				importer: { include: 'src/**', exclude: 'src/vendor/**' },
				target: { include: ['foo', 'bar'], exclude: 'bar' },
			},
			undefined,
			{ external: ['bar'] }
		);
		expect(included).toMatch(/require\(["']foo["']\)/);
		expect(included).toContain("from 'bar'");

		const excluded = await bundle(
			{
				'src/vendor/main.js': `import foo from 'foo'; console.log(foo);`,
			},
			{
				importer: { include: 'src/**', exclude: 'src/vendor/**' },
				target: { include: 'foo' },
			},
			undefined,
			{ external: ['foo'] }
		);
		expect(excluded).toContain("from 'foo'");
		expect(excluded).not.toMatch(/require\(["']foo["']\)/);
	});

	test('creates filters after earlier options hooks update shared patterns', async () => {
		const targets: string[] = [];
		const build = await rollup({
			input: 'src/main.js',
			external: ['foo'],
			plugins: [
				fixture({
					'src/main.js': `import foo from 'foo'; console.log(foo);`,
				}),
				{
					name: 'require-binding/test-options',
					options() {
						targets.push('foo');
					},
				},
				requireBinding({ target: { include: targets } }),
			],
		});
		const { output } = await build.generate({ format: 'es', validate: true });
		await build.close();

		expect(output[0].code).toMatch(/require\(["']foo["']\)/);
	});

	test('binds every target by default and merges repeated static imports', async () => {
		const code = await bundle({
			'src/main.js': `
				import first, { value } from 'foo';
				import * as namespace from 'foo';
				import 'foo';
				export { other } from 'foo';
				export * as exportedNamespace from 'foo';
				globalThis.result = [first, value, namespace];
			`,
		});

		expect(code.match(/require\(["']foo["']\)/g)).toHaveLength(1);
		expect(code).toContain('export {');
	});

	test.each(['es', 'cjs', 'amd', 'iife', 'umd', 'system'] as InternalModuleFormat[])(
		'uses dynamicImportInCjs=false in %s output',
		async (format) => {
			const code = await bundle(
				{ 'src/main.js': `globalThis.load = () => import('foo');` },
				{},
				{
					format,
					dynamicImportInCjs: false,
					generatedCode: { arrowFunctions: true },
					name: 'Test',
					validate: true,
				}
			);

			expect(code).toMatch(
				/Promise\.resolve\(\)\.then\(\(\) => require\(["']foo["']\)\)/
			);
			expect(code).not.toContain("import('foo')");
		}
	);

	test.each(['es', 'cjs', 'amd', 'iife', 'umd', 'system'] as InternalModuleFormat[])(
		'delegates dynamicImportInCjs=true to Rollup in %s output',
		async (format) => {
			const code = await bundle(
				{ 'src/main.js': `globalThis.load = () => import('foo');` },
				{},
				{ format, dynamicImportInCjs: true, name: 'Test', validate: true }
			);

			expect(code).toContain('foo');
			expect(code).not.toContain('Promise.resolve().then');
		}
	);

	test('binds computed dynamic imports when target is omitted', async () => {
		const code = await bundle(
			{
				'src/main.js': `globalThis.load = moduleName => import(moduleName);`,
			},
			{},
			{
				format: 'es',
				dynamicImportInCjs: false,
				generatedCode: { arrowFunctions: true },
				validate: true,
			}
		);
		expect(code).toContain('Promise.resolve().then(() => require(moduleName))');
	});

	test('leaves computed dynamic imports to Rollup when target is explicit', async () => {
		const code = await bundle(
			{
				'src/main.js': `globalThis.load = moduleName => import(moduleName);`,
			},
			{ target: { include: 'foo' } },
			{ format: 'es', dynamicImportInCjs: false, validate: true }
		);
		expect(code).toContain('import(moduleName)');
	});

	test('rejects bare star re-exports', async () => {
		await expect(bundle({ 'src/main.js': `export * from 'foo';` })).rejects.toThrow(
			'runtime export names are not known to Rollup'
		);
	});

	test('executes static bindings through require', async () => {
		const code = await bundle(
			{
				'src/main.js': `import value from 'foo'; globalThis.result = value;`,
			},
			{},
			{ format: 'cjs', validate: true }
		);
		const require = vi.fn(() => 42);

		new Function('require', code)(require);

		expect(require).toHaveBeenCalledOnce();
		expect(require).toHaveBeenCalledWith('foo');
		expect(globalThis.result).toBe(42);
		delete (globalThis as { result?: unknown }).result;
	});
});
