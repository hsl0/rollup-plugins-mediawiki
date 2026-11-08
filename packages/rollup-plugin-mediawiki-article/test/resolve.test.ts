import { describe, expect, test, vi } from 'vitest';
import { rollup, type InputOption, type Plugin, type PluginContext } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import mwPageResolve, { type MWPageResolveConfig } from '../src/main.js';
import rel2abs from '../src/rel2abs.js';

function resolve(plugin: Plugin, source: string, custom = {}) {
	if (typeof plugin.resolveId !== 'function')
		throw new Error('Expected a resolveId function');
	return plugin.resolveId.call({} as PluginContext, source, undefined, {
		isEntry: false,
		attributes: {},
		custom,
	});
}

async function bundle(
	input: InputOption,
	modules: Record<string, string>,
	config: Partial<MWPageResolveConfig>,
	plugins: Plugin[] = []
) {
	const fixture: Plugin = {
		name: 'article-test-fixture',
		resolveId(source) {
			if (source in modules && !source.startsWith('https:'))
				return { id: `\0${source}`, meta: { fixture: true } };
		},
		load(id) {
			return modules[id.startsWith('\0') ? id.slice(1) : id] ?? null;
		},
	};
	const build = await rollup({
		input,
		plugins: [fixture, mwPageResolve(config), ...plugins],
	});
	try {
		return await build.generate({ format: 'es', validate: true });
	} finally {
		await build.close();
	}
}

describe('article prefixes', () => {
	test.each([
		'http://example.org/A.js',
		'HTTP://example.org/A.js',
		'data:text/javascript,',
		'blob:https://example.org/id',
	])('preserves URL %s', async (source) => {
		expect(
			await resolve(mwPageResolve({ urlProtocols: ['HTTP', 'DATA', 'BLOB'] }), source)
		).toBe(source);
	});

	test('detects normalized protocol/namespace collisions', () => {
		expect(() =>
			mwPageResolve({ urlProtocols: ['HTTP'], wikiNamespaces: ['Http'] })
		).toThrow(/definitions/);
	});

	test.each([
		['User', 'USER:A'],
		['User_talk', 'user talk:A'],
		['USER TALK', 'User_talk:A'],
	])('normalizes forbidden prefix %s', async (prefix, source) => {
		await expect(
			resolve(mwPageResolve({ forbiddenPrefix: [prefix] }), source)
		).rejects.toThrow(/forbidden/);
	});

	test('keeps wiki result properties and metadata', async () => {
		const plugin = mwPageResolve({
			wiki: async () => ({
				id: 'https://example.org/raw',
				moduleSideEffects: false,
				external: true,
				meta: { other: 42 },
			}),
		});
		expect(await resolve(plugin, 'User:A')).toEqual({
			id: 'https://example.org/raw',
			moduleSideEffects: false,
			external: true,
			meta: { other: 42 },
		});
	});

	test.each([null, false] as const)(
		'preserves wiki resolver result %s',
		async (result) => {
			expect(await resolve(mwPageResolve({ wiki: () => result }), 'User:A')).toBe(result);
		}
	);

	test.each([
		'C:/project/main.js',
		'C:\\project\\main.js',
		'\\\\server\\share\\main.js',
		'\0virtual',
	])('passes through non-wiki ID %s', async (source) => {
		const wiki = vi.fn();
		expect(await resolve(mwPageResolve({ wiki }), source)).toBeNull();
		expect(wiki).not.toHaveBeenCalled();
	});

	test('passes through IDs already resolved by node-resolve', async () => {
		const wiki = vi.fn();
		expect(
			await resolve(mwPageResolve({ wiki }), 'C:/project/main.js', {
				'node-resolve': { resolved: { id: 'C:/project/main.js' } },
			})
		).toBeNull();
		expect(wiki).not.toHaveBeenCalled();
	});
});

describe('relative wiki titles', () => {
	test.each([
		['./C', 'User:A/B', 'User:A/B/C'],
		['../C', 'User:A/B', 'User:A/C'],
		['../../C', 'User:A/B', 'User:C'],
		['./C', 'A/B', 'A/B/C'],
		['../../C', 'A/B', 'C'],
	])('%s from %s resolves to %s', (source, base, expected) => {
		expect(rel2abs(source, base)).toBe(expected);
	});

	test('supports configured namespaces', () => {
		expect(rel2abs('../../C', '포털:A/B', ['포털'])).toBe('포털:C');
	});

	test.each(['User:A/B', 'A/B'])('rejects namespace overflow from %s', (base) => {
		expect(() => rel2abs('../../../C', base)).toThrow(TypeError);
	});

	test('rejects missing base and empty page name', () => {
		expect(() => rel2abs('../C')).toThrow(/no location/);
		expect(() => rel2abs('..', 'User:A')).toThrow(/no page name/);
	});
});

describe('Rollup integration', () => {
	test('nodeResolve handles local relative imports', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'article-test-'));
		try {
			const entry = path.join(directory, 'entry.js');
			await writeFile(entry, "import { local } from './local.js'; console.log(local);");
			await writeFile(path.join(directory, 'local.js'), 'export const local = 7;');
			const wiki = vi.fn();
			const { output } = await bundle(entry, {}, { wiki }, [nodeResolve()]);
			expect(wiki).not.toHaveBeenCalled();
			if (output[0].type === 'chunk') expect(output[0].code).toContain('7');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('lets nodeResolve handle a bare package and its absolute path re-entry', async () => {
		const wiki = vi.fn();
		const { output } = await bundle(
			'entry.js',
			{
				'entry.js':
					"import { __assign } from 'tslib'; console.log(__assign({}, { value: 1 }));",
			},
			{ wiki },
			[nodeResolve()]
		);
		expect(wiki).not.toHaveBeenCalled();
		if (output[0].type === 'chunk') expect(output[0].code).toContain('__assign');
	});
});
