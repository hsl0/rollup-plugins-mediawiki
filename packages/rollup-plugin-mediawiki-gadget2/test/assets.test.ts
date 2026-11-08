import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { rollup, type OutputAsset } from 'rollup';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import mwGadget from '../src/main.js';

describe('가젯 플러그인 경유', () => {
	let directory: string;

	beforeAll(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'input-anything-gadget-'));
		await writeFile(path.join(directory, 'main.js'), 'console.log("main");');
		await writeFile(path.join(directory, 'style.css'), '.a { color: red; }');
		await writeFile(path.join(directory, 'data.json'), '{"ok":true}');
		await writeFile(
			path.join(directory, 'gadget.json'),
			JSON.stringify({
				name: 'Example',
				settings: {},
				module: {
					pages: {
						js: path.join(directory, 'main.js'),
						css: path.join(directory, 'style.css'),
						'data.json': path.join(directory, 'data.json'),
					},
				},
			})
		);
	});

	afterAll(() => rm(directory, { recursive: true, force: true }));

	test('CSS와 JSON 페이지가 JS로 파싱되지 않고 에셋으로 나간다', async () => {
		const bundle = await rollup({
			input: path.join(directory, 'gadget.json'),
			plugins: mwGadget(),
		});
		try {
			const { output } = await bundle.generate({});
			expect(output.map((o) => o.fileName).sort()).toEqual([
				'Gadget-Example-data.json',
				'Gadget-Example.css',
				'Gadget-Example.js',
				'Gadgets/Example.json',
			]);
			const stylesheet = output.find(
				(o) => o.fileName === 'Gadget-Example.css'
			) as OutputAsset;
			expect(String(stylesheet.source)).toBe('.a { color: red; }');
		} finally {
			await bundle.close();
		}
	});
});
