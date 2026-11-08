import * as path from 'node:path';
import { rollup, type Plugin } from 'rollup';
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

import mwGadget, { parseGadgetDefinition, readGadgetDefinition } from '../src/main.js';
import { formatGadgetsDefinition } from '../src/definition.js';

let fixtureId = 0;

function sourcePlugin(sources: Record<string, string>): Plugin {
	return {
		name: 'test-sources',
		resolveId(source) {
			return source in sources ? source : null;
		},
		load(id) {
			return sources[id] ?? null;
		},
	};
}

function createFixture(definition: object, sources: Record<string, string> = {}) {
	const input = `virtual-${fixtureId++}/gadget.json`;
	const source = JSON.stringify(definition);
	const entries = [
		[input, source],
		[path.resolve(input), source],
		...Object.entries(sources),
	] as const;
	for (const [fileName, contents] of entries) files.set(fileName, contents);
	return {
		input,
		plugin: sourcePlugin(Object.fromEntries(entries)),
		dispose: () => entries.forEach(([fileName]) => files.delete(fileName)),
	};
}

async function withFixture<T>(
	definition: object,
	sources: Record<string, string>,
	run: (fixture: ReturnType<typeof createFixture>) => Promise<T>
) {
	const fixture = createFixture(definition, sources);
	try {
		return await run(fixture);
	} finally {
		fixture.dispose();
	}
}

describe('mediawiki gadget definition', () => {
	test('maps pages and emits the MediaWiki definition', () =>
		withFixture(
			{
				name: 'Example-gadget',
				settings: { default: true },
				module: {
					pages: {
						js: 'virtual-main.js',
						css: 'virtual-style.css',
						'data.json': 'virtual-data.json',
					},
					dependencies: ['mediawiki.api', 'ext.gadget.Foo'],
					gadgetDependencies: ['Foo', 'Bar'],
				},
			},
			{
				'virtual-main.js': 'console.log("main");',
				'virtual-style.css': '.example { color: red; }',
				'virtual-data.json': '{"example":true}',
			},
			async ({ input, plugin }) => {
				const build = await rollup({ input, plugins: [plugin, ...mwGadget()] });
				try {
					const generated = await build.generate({ format: 'es' });
					// Emits each mapped page and the transformed gadget definition.
					expect(generated.output.map((output) => output.fileName).sort()).toEqual(
						[
							'Gadget-Example-gadget-data.json',
							'Gadget-Example-gadget.css',
							'Gadget-Example-gadget.js',
							'Gadgets/Example-gadget.json',
						].sort()
					);
					const definitionAsset = generated.output.find(
						(output) => output.fileName === 'Gadgets/Example-gadget.json'
					);
					// Preserves settings while replacing custom pages and gadget dependencies.
					expect(
						JSON.parse(String((definitionAsset as import('rollup').OutputAsset).source))
					).toEqual({
						settings: { default: true },
						module: {
							pages: [
								'Example-gadget.js',
								'Example-gadget.css',
								'Example-gadget-data.json',
							],
							dependencies: ['mediawiki.api', 'ext.gadget.Foo', 'ext.gadget.Bar'],
						},
					});
				} finally {
					await build.close();
				}
			}
		));

	test('formats legacy options and pages', () => {
		const definition = parseGadgetDefinition({
			name: 'Example',
			settings: {
				section: 'tools',
				default: true,
				hidden: true,
				package: true,
				rights: ['edit'],
				skins: ['vector'],
				actions: ['edit', 'history'],
				namespaces: ['0'],
				categories: ['Tools'],
				contentModels: ['wikitext'],
				supportsUrlLoad: false,
			},
			module: {
				pages: {
					js: 'main.js',
					css: 'style.css',
					'data.json': 'data.json',
				},
				dependencies: ['mediawiki.api'],
				peers: ['Example-styles'],
				codexIcons: ['edit'],
				type: 'general',
			},
		});
		expect(formatGadgetsDefinition(definition)).toBe(
			`== tools ==
* Example [ ResourceLoader | default | hidden | package | rights = edit | skins = vector | actions = edit, history | namespaces = 0 | categories = Tools | contentModels = wikitext | dependencies = mediawiki.api | type = general | peers = Example-styles | codexIcons = edit | supportsUrlLoad = false ] | Example.js | Example.css | Example-data.json
`
		);
	});

	test('emits Gadgets-definition instead of JSON', () =>
		withFixture(
			{
				name: 'Example',
				settings: {},
				module: { pages: { js: 'virtual-main.js' } },
			},
			{ 'virtual-main.js': 'console.log("main");' },
			async ({ input, plugin }) => {
				const build = await rollup({
					input,
					plugins: [plugin, ...mwGadget({ definitionFormat: 'wikitext' })],
				});
				try {
					const generated = await build.generate({ format: 'es' });
					expect(
						generated.output
							.filter(
								(output) =>
									output.fileName === 'Gadgets-definition' ||
									output.fileName.startsWith('Gadgets/')
							)
							.map((output) => output.fileName)
					).toEqual(['Gadgets-definition']);
					expect(generated.output.map((output) => output.fileName)).toEqual(
						expect.arrayContaining(['Gadgets-definition', 'Gadget-Example.js'])
					);
				} finally {
					await build.close();
				}
			}
		));

	test('warns when module.messages cannot be represented', () =>
		withFixture(
			{
				name: 'Example',
				settings: {},
				module: { pages: { js: 'main.js' }, messages: ['example-message'] },
			},
			{ 'main.js': '' },
			async ({ input, plugin }) => {
				const warnings: string[] = [];
				const build = await rollup({
					input,
					plugins: [plugin, ...mwGadget({ definitionFormat: 'wikitext' })],
					onwarn: (warning) => warnings.push(warning.message),
				});
				try {
					expect(warnings.some((warning) => warning.includes('module.messages'))).toBe(
						true
					);
				} finally {
					await build.close();
				}
			}
		));

	test('always includes ResourceLoader in legacy definitions', () => {
		const definition = parseGadgetDefinition({
			name: 'Example',
			settings: {},
			module: { pages: {} },
		});
		expect(formatGadgetsDefinition(definition)).toBe('* Example [ ResourceLoader ]\n');
	});

	test('rejects invalid legacy gadget names', () => {
		expect(() =>
			formatGadgetsDefinition(
				parseGadgetDefinition({
					name: 'Invalid name',
					settings: {},
					module: { pages: {} },
				})
			)
		).toThrow('invalid for MediaWiki:Gadgets-definition');
	});

	test('omits empty legacy options and writes supportsUrlLoad as a flag', () => {
		const definition = parseGadgetDefinition({
			name: 'Example',
			settings: {
				default: false,
				hidden: false,
				rights: [],
				supportsUrlLoad: true,
			},
			module: { pages: {}, dependencies: [], peers: [], codexIcons: [] },
		});
		expect(formatGadgetsDefinition(definition)).toBe(
			'* Example [ ResourceLoader | supportsUrlLoad ]\n'
		);
	});

	test('renames physical chunks after Rollup resolves their internal paths', () =>
		withFixture(
			{
				name: 'Example',
				settings: { package: true },
				module: {
					pages: { js: 'virtual-main.js', 'helper.js': 'virtual-helper.js' },
				},
			},
			{
				'virtual-main.js':
					'import { helper } from "virtual-helper.js"; console.log(helper);',
				'virtual-helper.js': 'export const helper = 1;',
			},
			async ({ input, plugin }) => {
				const build = await rollup({ input, plugins: [plugin, ...mwGadget()] });
				try {
					const generated = await build.generate({
						format: 'es',
						sourcemap: true,
					});
					const main = generated.output.find(
						(output) => output.type === 'chunk' && output.fileName === 'Gadget-Example.js'
					) as import('rollup').OutputChunk;
					expect(main.code).toContain("require('./Example-helper.js')");
					expect(generated.output.map((output) => output.fileName)).toEqual(
						expect.arrayContaining([
							'Gadget-Example.js',
							'Gadget-Example-helper.js',
							'Gadget-Example.js.map',
							'Gadget-Example-helper.js.map',
							'Gadgets/Example.json',
						])
					);
				} finally {
					await build.close();
				}
			}
		));

	test('converts gadget dependencies', () => {
		const definition = parseGadgetDefinition({
			name: 'Example',
			settings: {},
			module: { pages: { js: 'main.js' }, gadgetDependencies: ['Foo'] },
		});
		// Keeps short gadget names for import alias resolution.
		expect(definition.gadgetDependencies).toEqual(['Foo']);
		// Appends gadget modules to the emitted MediaWiki dependencies.
		expect(definition.dependencies).toEqual(['ext.gadget.Foo']);
	});

	test('binds dependencies loaded from the gadget definition', () =>
		withFixture(
			{
				name: 'Example',
				settings: {},
				module: {
					pages: { js: 'main.js' },
					dependencies: ['mediawiki.api'],
				},
			},
			{ 'main.js': `import api from 'mediawiki.api'; console.log(api);` },
			async ({ input, plugin }) => {
				const build = await rollup({ input, plugins: [plugin, ...mwGadget()] });
				try {
					const generated = await build.generate({ format: 'es' });
					const chunk = generated.output.find(
						(output) => output.type === 'chunk'
					) as import('rollup').OutputChunk;
					expect(chunk.code).toMatch(/require\(["']mediawiki\.api["']\)/);
				} finally {
					await build.close();
				}
			}
		));

	test('keeps package exports and puts its JavaScript page first', () => {
		const definition = parseGadgetDefinition({
			name: 'Example',
			settings: { package: true },
			module: { pages: { css: 'style.css', js: 'main.js', json: 'data.json' } },
		});
		expect(definition.definition.module?.pages).toEqual([
			'Example.js',
			'Example.css',
			'Example.json',
		]);
	});

	test('rejects a package without its named JavaScript page', () => {
		expect(() =>
			parseGadgetDefinition({
				name: 'Example',
				settings: { package: true },
				module: { pages: { css: 'style.css' } },
			})
		).toThrow('must define the "Example.js" page');
	});

	test('preserves exports from the package JavaScript page', () =>
		withFixture(
			{
				name: 'Example',
				settings: { package: true },
				module: { pages: { js: 'main.js' } },
			},
			{ 'main.js': 'export const publicValue = 1;' },
			async ({ input, plugin }) => {
				const build = await rollup({ input, plugins: [plugin, ...mwGadget()] });
				try {
					const generated = await build.generate({});
					const chunk = generated.output.find(
						(output) => output.type === 'chunk'
					) as import('rollup').OutputChunk;
					expect(chunk.exports).toContain('publicValue');
				} finally {
					await build.close();
				}
			}
		));

	test('treats missing settings as all defaults', () => {
		const definition = parseGadgetDefinition({
			name: 'Example',
			module: { pages: { js: 'main.js' } },
		});
		expect(definition.definition.settings).toEqual({});
		expect(formatGadgetsDefinition(definition)).toBe(
			'* Example [ ResourceLoader ] | Example.js\n'
		);
	});

	test('rejects a settings value that is not an object', () => {
		expect(() =>
			parseGadgetDefinition({
				name: 'Example',
				settings: ['default'],
				module: { pages: { js: 'main.js' } },
			} as never)
		).toThrow('settings must be an object');
	});

	test('rejects a missing module', () => {
		expect(() => parseGadgetDefinition({ name: 'Example' } as never)).toThrow(
			'module must be an object'
		);
	});

	test('rejects a module without pages', () => {
		expect(() => parseGadgetDefinition({ name: 'Example', module: {} } as never)).toThrow(
			'module.pages must be an object'
		);
	});

	test('rejects a non-map pages value', () => {
		// Requires the custom page-to-source mapping needed to create Rollup inputs.
		expect(() =>
			parseGadgetDefinition({
				name: 'Example',
				settings: {},
				module: { pages: ['main.js'] },
			})
		).toThrow('module.pages must be an object');
	});

	test('rejects an empty page map because Rollup requires an input', () =>
		withFixture(
			{ name: 'Empty', settings: {}, module: { pages: {} } },
			{},
			async ({ input, plugin }) => {
				await expect(rollup({ input, plugins: [plugin, ...mwGadget()] })).rejects.toThrow(
					'You must supply options.input to rollup'
				);
			}
		));

	test('loads a project-relative definition without writing it', () =>
		withFixture(
			{ name: 'Example', settings: {}, module: { pages: { js: 'main.js' } } },
			{},
			async ({ input }) => {
				// Reads a relative definition path and returns its normalized input map.
				await expect(readGadgetDefinition(input)).resolves.toMatchObject({
					name: 'Example',
					input: { 'Example.js': 'main.js' },
				});
			}
		));

	test('keeps transformDynamicImport as a build option', async () =>
		withFixture(
			{ name: 'Example', settings: {}, module: { pages: { js: 'main.js' } } },
			{ 'main.js': `globalThis.load = () => import('mediawiki.unconfigured');` },
			async ({ input, plugin }) => {
				const build = await rollup({
					input,
					plugins: [plugin, ...mwGadget({ transformDynamicImport: true })],
				});
				try {
					const generated = await build.generate({ format: 'es' });
					const code = (generated.output[0] as import('rollup').OutputChunk).code;
					expect(code).not.toContain('import(');
					expect(code).toContain('mw.loader.using(module)');
				} finally {
					await build.close();
				}
			}
		));
});
