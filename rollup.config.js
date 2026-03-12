import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import resolveMonorepoRoot from './rollup-plugin-resolve-monorepo-root.js';
import path from 'node:path';

/** @type {import('rollup').RollupOptions} */
export default {
	output: {
		format: 'es',
		sourcemap: true,
	},
	external: [
		/node_modules/,
		(id, parent) => path.relative(parent, id).startsWith('../'),
	],
	preserveSymlinks: true,
	plugins: [
		nodeResolve(),
		resolveMonorepoRoot(),
		typescript({
			tsconfig: path.join(import.meta.dirname, 'tsconfig.json'),
			include: [
				path.join(process.cwd(), 'main.ts'),
				path.join(process.cwd(), 'src/*.ts'),
			],
			compilerOptions: {
				allowImportingTsExtensions: false,
			},
		}),
		commonjs(),
	],
};
