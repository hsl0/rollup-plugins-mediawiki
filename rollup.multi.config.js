import baseConfig from './rollup.config.js';
import path from 'node:path';
import { opendir } from 'node:fs/promises';

async function filesInDir(dirname) {
	const dir = await Array.fromAsync(await opendir(dirname));
	return (
		await Promise.all(
			dir.map(async (dirent) => {
				return dirent.isDirectory()
					? (
							await filesInDir(
								path.join(dirent.parentPath, dirent.name)
							)
						).map((name) => path.join(dirent.name, name))
					: dirent.name;
			})
		)
	).flat();
}

export default {
	...baseConfig,
	input: {
		'main.js': 'main.ts',
		...Object.fromEntries(
			(await filesInDir(path.join(process.cwd(), 'src')))
				.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
				.map((name) => [
					'dist/' + name.replace(/\.ts$/, '.js'),
					'src/' + name,
				])
		),
	},
	output: {
		...baseConfig.output,
		dir: '.',
		entryFileNames: '[name]',
	},
	plugins: [...baseConfig.plugins],
};
