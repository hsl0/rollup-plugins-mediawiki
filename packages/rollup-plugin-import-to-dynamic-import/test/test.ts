import { describe, it, test, expect } from 'vitest';
import staticToDynamicImport from '../src/main.js';
import { rollup } from 'rollup';
import virtual from '@rollup/plugin-virtual';
import type { ImportToDynamicImportOptions } from '../src/main.js';

async function testRollup(inputCode: string) {
	const bundle = await rollup({
		input: 'input.js',
		external: () => true,
		plugins: [
			virtual({
				'input.js': inputCode,
			}),
			staticToDynamicImport(),
		],
		strictDeprecations: true,
	});
	const { output } = await bundle.generate({
		format: 'es',
		exports: 'none',
		validate: true,
	});
	return output[0].code;
}

describe('top level await', () => {
	test('no imports', async () => {
		expect(await testRollup(`console.log('Hello, World!');`)).toMatchSnapshot();
	});

	it('transforms void import', async () => {
		expect(
			await testRollup(`
					import 'myModule.js';
					console.log('Hello, World!');
				`)
		).toMatchSnapshot();
	});

	it('transforms default import', async () => {
		expect(
			await testRollup(`
					import foo from 'myModule.js';
					console.log(foo);
				`)
		).toMatchSnapshot();
	});

	it('transforms named import', async () => {
		expect(
			await testRollup(`
					import { bar } from 'myModule.js';
					console.log(bar);
				`)
		).toMatchSnapshot();
	});

	it('transforms named import with alias', async () => {
		expect(
			await testRollup(`
					import { bar as baz } from 'myModule.js';
					console.log(baz);
				`)
		).toMatchSnapshot();
	});

	it('transforms namespace import', async () => {
		expect(
			await testRollup(`
					import * as myModule from 'myModule.js';
					console.log(myModule);
				`)
		).toMatchSnapshot();
	});

	it('transforms multiple namespace import from same source', async () => {
		expect(
			await testRollup(`
					import * as myModule from 'myModule.js';
					import * as yourModule from 'myModule.js';

					console.log(myModule, yourModule);
				`)
		).toMatchSnapshot();
	});

	it('transforms default and named import', async () => {
		expect(
			await testRollup(`
					import foo, { bar } from 'myModule.js';
					console.log(foo, bar);
				`)
		).toMatchSnapshot();
	});

	it('transforms default and namespace import', async () => {
		expect(
			await testRollup(`
					import foo, * as myModule from 'myModule.js';
					console.log(foo, myModule);
				`)
		).toMatchSnapshot();
	});

	it('transforms multiple imports from different sources', async () => {
		expect(
			await testRollup(`
					import 'myModule.js';
					import foo from 'myModule0.js';
					import { bar } from 'myModule1.js';
					import * as myModule from 'myModule2.js';

					console.log(foo, bar, myModule);
				`)
		).toMatchSnapshot();
	});

	it('transforms multiple colliding imports with alias from different sources', async () => {
		expect(
			await testRollup(`
					import { foo } from 'myModule.js';
					import { foo as bar } from 'otherModule.js';

					console.log(foo, bar);
				`)
		).toMatchSnapshot();
	});

	it('transforms multiple imports from same source', async () => {
		expect(
			await testRollup(`
					import foo from 'myModule.js';
					import { bar } from 'myModule.js';
					import * as myModule from 'myModule.js';

					console.log(foo, bar, myModule);
				`)
		).toMatchSnapshot();
	});
});

async function testFilteredRollup(
	inputCode: string,
	options: ImportToDynamicImportOptions
) {
	const bundle = await rollup({
		input: 'input.js',
		external: (id) => id !== 'input.js' && id !== 'internal.js',
		plugins: [
			virtual({
				'input.js': inputCode,
				'internal.js': 'export const internal = true;',
			}),
			staticToDynamicImport(options),
		],
	});
	const { output } = await bundle.generate({ format: 'es', validate: true });
	await bundle.close();
	return output[0].code;
}

describe('include/exclude', () => {
	test('keeps the default behavior when options are omitted', async () => {
		const code = await testFilteredRollup(
			`import value from 'external.js'; console.log(value);`,
			{}
		);

		expect(code).toContain(`await import('external.js')`);
	});

	test('filters original module specifiers with globs, regexps and arrays', async () => {
		const code = await testFilteredRollup(
			`
				import url from 'https://example.org/module.js';
				import remote from 'remote-module';
				import excluded from 'https://example.org/excluded/module.js';
				import other from 'other-module';
				import { internal } from 'internal.js';
				console.log(url, remote, excluded, other, internal);
			`,
			{
				include: ['https://**', /^remote-/],
				exclude: 'https://example.org/excluded/**',
			}
		);

		expect(code).toContain(`import('https://example.org/module.js')`);
		expect(code).toContain(`import('remote-module')`);
		expect(code).toContain(`from 'https://example.org/excluded/module.js'`);
		expect(code).toContain(`from 'other-module'`);
		expect(code).not.toContain(`import('internal.js')`);
	});

	test('applies the filter to re-exports', async () => {
		const code = await testFilteredRollup(
			`
				export { value } from 'https://example.org/module.js';
				export { other } from 'other-module';
			`,
			{ include: /^https?:\/\//i }
		);

		expect(code).toContain(`await import('https://example.org/module.js')`);
		expect(code).toContain(`from 'other-module'`);
	});
});
