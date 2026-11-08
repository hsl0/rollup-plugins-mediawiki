import type { HasModuleSideEffects, Plugin } from 'rollup';
import {
	createFilter,
	makeLegalIdentifier,
	type FilterPattern,
} from '@rollup/pluginutils';
import MagicString from 'magic-string';
import parallelizeAwait from 'rollup-plugin-parallelize-await';
import { asyncFilter } from 'modern-async';
import type {
	ImportDeclaration,
	ExportAllDeclaration,
	ExportNamedDeclaration,
	Literal,
	Identifier,
} from 'estree';
import {
	generateExportFrom,
	generateModuleMappings,
	generateVirtualModule,
} from './modules.js';

const pluginName = 'import-to-dynamic-import';
const virtualModulePrefix = '\0dynamic-import/';
const virtualModuleRegExp = /^\0dynamic-import\/(?<actualId>[^\?]+)$/;
const syntheticNamedExportsName = '\0*';
const syntheticNamedExportsLiteral = JSON.stringify(syntheticNamedExportsName);

export interface ImportToDynamicImportOptions {
	include?: FilterPattern;
	exclude?: FilterPattern;
	/** Also run rollup-plugin-parallelize-await so the generated imports load concurrently. */
	parallelize?: boolean;
}

export default function importToDynamicImport(
	options: ImportToDynamicImportOptions = {}
): Plugin[] {
	const plugin = createPlugin(options);
	return options.parallelize === false ? [plugin] : [plugin, parallelizeAwait()];
}

function createPlugin(options: ImportToDynamicImportOptions): Plugin {
	const filter = createFilter(options.include, options.exclude, { resolve: false });
	let moduleSideEffects: HasModuleSideEffects;

	return {
		name: pluginName,
		buildStart(options) {
			const treeshake = options.treeshake;
			moduleSideEffects = treeshake ? treeshake.moduleSideEffects : () => false;
		},
		resolveId(id, importer, { custom = {}, isEntry }) {
			if (!id?.startsWith(virtualModulePrefix)) return null;
			if (isEntry)
				throw this.error(
					`Could not resolve entry module "${id}". ` +
						'Avoid using "\0" character for module name or disable your recently added plugin.'
				);
			if (!importer) return null;

			// 가상 모듈이 external로 처리되지 않게 방지
			return {
				id,
				resolvedBy: pluginName,
			};
		},
		async transform(code, id) {
			if (id.startsWith(virtualModulePrefix)) return null;

			const ast = this.parse(code);
			const ms = new MagicString(code);

			let syntheticNamedExports: boolean | string = false;

			const externalImports = await asyncFilter(
				ast.body.filter(
					(
						node
					): node is (
						| ImportDeclaration
						| ExportAllDeclaration
						| ExportNamedDeclaration
					) & { source: Literal & { value: string } } => {
						switch (node.type) {
							case 'ImportDeclaration':
							case 'ExportAllDeclaration':
							case 'ExportNamedDeclaration':
								break;
							default:
								return false;
						}

						const source = node.source?.value as string;

						// no import in ExportNamedDeclaration
						if (!source) return false;

						// check conflict
						if (source.startsWith(virtualModulePrefix)) {
							throw this.error(
								`Module name "${source}" conflicts with internal module.` +
									` Avoid using "\\0" character for module name or disable your recently added plugin.`,
								// @ts-ignore
								node.source.start
							);
						}

						return true;
					}
				),
				async (node) => {
					const source = node.source.value;
					if (!filter(source)) return false;

					// external only
					if (!((await this.resolve(source, id))?.external ?? true)) return false;

					// treeshaking
					return (
						node.type !== 'ImportDeclaration' ||
						node.specifiers.length > 0 ||
						moduleSideEffects(source, true)
					);
				}
			);

			externalImports
				.map((node) => node.source)
				.forEach((node) => {
					const source = node.value;
					ms.update(
						/*@ts-ignore*/
						node.start,
						/*@ts-ignore*/
						node.end,
						JSON.stringify(`${virtualModulePrefix}${source}`)
					);
				});

			// 불필요한 코드 생성 방지를 위해 전체 import(*)는 '\0*'(동적 import 결과, syntheticNamedExports)를 가져오는 것으로 변경
			externalImports
				.filter((node) => node.type === 'ImportDeclaration')
				.flatMap((node) => node.specifiers)
				.filter((node) => node.type === 'ImportNamespaceSpecifier')
				.forEach((node) => {
					ms.update(
						/*@ts-ignore*/
						node.start,
						/*@ts-ignore*/
						node.end,
						generateModuleMappings({
							[node.local.name]: syntheticNamedExportsLiteral,
						})
					);
				});

			externalImports
				.filter((node) => node.type === 'ExportAllDeclaration')
				.forEach((node) => {
					const source = node.source.value;
					let exportedName = ((exported) => {
						switch (exported?.type ?? null) {
							case 'Identifier':
								return (exported as Identifier).name;
							case 'Literal':
								return (exported as Literal).value as string;
							case null:
								return '*'; // *
						}
					})(node.exported);

					if (exportedName === '*') {
						exportedName = syntheticNamedExportsLiteral;
						syntheticNamedExports = syntheticNamedExportsName;
					}

					ms.update(
						/*@ts-ignore*/
						node.start,
						/*@ts-ignore*/
						node.end,
						`${generateExportFrom(`${virtualModulePrefix}${source}`, {
							[exportedName]: syntheticNamedExportsLiteral,
						})};`
					);
				});

			if (syntheticNamedExports)
				externalImports
					.filter((node) => node.type === 'ExportNamedDeclaration')
					.flatMap((node) => node.specifiers)
					.forEach((node) => {
						if (
							node.exported.type === 'Literal' &&
							node.exported.value === syntheticNamedExports
						)
							throw this.error(
								`Export name "${node.exported.value}" conflicts with synthetic named exports "${syntheticNamedExports}".` +
									` Avoid using "\\0" character for export name or disable your recently added plugin.`,
								// @ts-ignore
								node.start
							);
					});

			if (externalImports.length > 0)
				return {
					code: ms.toString(),
					map: ms.generateMap(),
					syntheticNamedExports,
				};
		},
		load(id) {
			// 동적으로 모듈을 불러오는 가상 모듈 만들기

			if (!id.startsWith(virtualModulePrefix)) return null;

			const { actualId } =
				(virtualModuleRegExp.exec(id)?.groups as { actualId: string }) ?? {};

			if (!actualId) throw this.error(`Wrong module id: ${id}`);

			const namespaceIdentifier = makeLegalIdentifier(actualId);
			const code = generateVirtualModule(
				namespaceIdentifier,
				actualId,
				syntheticNamedExportsLiteral
			);

			const ms = new MagicString(code);

			return {
				code: ms.toString(),
				map: ms.generateMap(),
				syntheticNamedExports: syntheticNamedExportsName,
			};
		},
		renderStart(outputOptions) {
			if (outputOptions.exports !== 'none') {
				this.warn(
					'Using import-to-dynamic-import plugin with exports is not recommended.' +
						' It is recommended to set the "output.exports" option to "none".'
				);
			}
		},
	};
}
