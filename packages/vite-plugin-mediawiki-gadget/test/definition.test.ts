import * as path from 'node:path';
import { build, type Plugin } from 'vite';
import { describe, expect, test, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	const readFile = actual.readFile as (...args: any[]) => Promise<any>;
	return {
		...actual,
		readFile: (...args: any[]) =>
			files.has(String(args[0]))
				? Promise.resolve(Buffer.from(files.get(String(args[0]))!))
				: readFile(...args),
	};
});

import mwGadget from '../src/main.js';

const sourcePlugin: Plugin = {
	name: 'test-sources',
	resolveId(source) {
		return files.has(source) ? source : null;
	},
	load(id) {
		return files.get(id) ?? null;
	},
};

function createFixture(
	pages: Record<string, string> = { js: 'main.js', css: 'style.css' },
	sources: Record<string, string> = {
		'main.js': 'console.log("main");',
		'style.css': '.example { color: red; }',
	}
) {
	const input = 'virtual-vite/gadget.json';
	const source = JSON.stringify({
		name: 'Example',
		settings: {},
		module: { pages },
	});
	const entries = [
		[input, source],
		[path.resolve(input), source],
		...Object.entries(sources),
	] as const;
	for (const [fileName, contents] of entries) files.set(fileName, contents);
	return {
		input,
		dispose: () => entries.forEach(([fileName]) => files.delete(fileName)),
	};
}

describe('vite mediawiki gadget', () => {
	test('builds from an in-memory JSON definition and CSS source', async () => {
		const fixture = createFixture();
		try {
			const result = await build({
				configFile: false,
				plugins: [sourcePlugin, ...mwGadget()],
				build: {
					lib: { entry: fixture.input, formats: ['es'] },
					write: false,
					minify: false,
				},
			});
			const output = (Array.isArray(result) ? result[0] : result).output;
			// Emits JavaScript, transformed CSS, and the gadget definition in memory.
			expect(output.map((item) => item.fileName)).toEqual(
				expect.arrayContaining([
					'Gadget-Example.css',
					'Gadget-Example.js',
					'Gadgets/Example.json',
				])
			);
			expect(output.map((item) => item.fileName).join()).not.toContain(
				'__mediawiki-gadget-assets'
			);
		} finally {
			fixture.dispose();
		}
	});

	test('emits an empty CSS page without a JavaScript placeholder', async () => {
		const fixture = createFixture({ css: 'empty.css' }, { 'empty.css': '' });
		try {
			const result = await build({
				configFile: false,
				plugins: [sourcePlugin, ...mwGadget()],
				build: { lib: { entry: fixture.input, formats: ['es'] }, write: false },
			});
			const output = (Array.isArray(result) ? result[0] : result).output;
			expect(output.map((item) => item.fileName).sort()).toEqual([
				'Gadget-Example.css',
				'Gadgets/Example.json',
			]);
		} finally {
			fixture.dispose();
		}
	});

	// Same as the Rollup plugin: Rollup requires at least one input, and JSON pages are emitted as assets, not inputs.
	test.each([
		['an empty page map', {}, {}],
		['a JSON-only page map', { json: 'data.json' }, { 'data.json': '{"ok":true}' }],
	])('rejects %s', async (_, pages, sources) => {
		const fixture = createFixture(pages, sources);
		try {
			await expect(
				build({
					configFile: false,
					plugins: [sourcePlugin, ...mwGadget()],
					build: { lib: { entry: fixture.input, formats: ['es'] }, write: false },
				})
			).rejects.toThrow('You must supply options.input to rollup');
		} finally {
			fixture.dispose();
		}
	});

	test('does not remove a CSS Modules entry that still contains used JavaScript', async () => {
		const fixture = createFixture(
			{ js: 'main.js', css: 'style.module.css' },
			{
				'main.js': 'import styles from "style.module.css"; console.log(styles.example);',
				'style.module.css': '.example { color: red; }',
			}
		);
		try {
			await expect(
				build({
					configFile: false,
					plugins: [sourcePlugin, ...mwGadget()],
					build: { lib: { entry: fixture.input, formats: ['es'] }, write: false },
				})
			).rejects.toThrow(
				'Non-JavaScript gadget page ["Example.css"] produced JavaScript or is referenced by another chunk'
			);
		} finally {
			fixture.dispose();
		}
	});

	test('supports one combined CSS page and rejects multiple declared CSS pages', async () => {
		const fixture = createFixture({ css: 'style.css' }, { 'style.css': '.example {}' });
		try {
			const result = await build({
				configFile: false,
				plugins: [sourcePlugin, ...mwGadget()],
				build: {
					lib: { entry: fixture.input, formats: ['es'] },
					cssCodeSplit: false,
					write: false,
				},
			});
			const output = (Array.isArray(result) ? result[0] : result).output;
			expect(output.map((item) => item.fileName).sort()).toEqual([
				'Gadget-Example.css',
				'Gadgets/Example.json',
			]);
		} finally {
			fixture.dispose();
		}

		const multiple = createFixture(
			{ 'a.css': 'a.css', 'b.css': 'b.css' },
			{ 'a.css': '.a {}', 'b.css': '.b {}' }
		);
		try {
			await expect(
				build({
					configFile: false,
					plugins: [sourcePlugin, ...mwGadget()],
					build: {
						lib: { entry: multiple.input, formats: ['es'] },
						cssCodeSplit: false,
						write: false,
					},
				})
			).rejects.toThrow('cssCodeSplit: false cannot emit multiple gadget CSS pages');
		} finally {
			multiple.dispose();
		}
	});
});
