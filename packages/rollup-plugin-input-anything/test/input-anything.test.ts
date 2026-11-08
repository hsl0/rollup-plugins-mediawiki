import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { rollup, type InputOptions, type OutputAsset, type RollupLog } from 'rollup';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import inputAnything, { type InputAnythingConfig } from '../src/main.js';

const css: InputAnythingConfig = { extensions: '.css' };
const json: InputAnythingConfig = { extensions: '.json' };

/** options 훅만 직접 호출해 입력이 어떻게 나뉘는지 본다. */
function splitInput(input: InputOptions['input'], ...configs: InputAnythingConfig[]) {
	const warn = vi.fn();
	const plugin = inputAnything(...configs);
	const result = (
		plugin.options as (this: unknown, o: InputOptions) => InputOptions | null | void
	).call({ warn }, { input });
	return { input: result ? result.input : undefined, warn };
}

describe('입력 분류', () => {
	test('설정 하나: 일치한 입력만 입력에서 빠진다', () => {
		expect(splitInput({ main: 'main.js', style: 'style.css' }, css).input).toEqual({
			main: 'main.js',
		});
	});

	test('설정 여럿: 일치한 입력은 입력에서 빠진 채로 남는다', () => {
		expect(
			splitInput({ main: 'main.js', style: 'style.css', data: 'data.json' }, css, json)
				.input
		).toEqual({ main: 'main.js' });
	});

	test('모든 입력이 일치하면 남는 입력이 없다', () => {
		expect(
			splitInput({ style: 'style.css', data: 'data.json' }, css, json).input
		).toEqual({});
	});

	test('일치하는 입력이 없으면 입력이 그대로 남는다', () => {
		expect(splitInput({ a: 'a.js', b: 'b.mjs' }, css, json).input).toEqual({
			a: 'a.js',
			b: 'b.mjs',
		});
	});

	test('설정이 없으면 입력이 그대로 남는다', () => {
		expect(splitInput({ a: 'a.js', b: 'b.css' }).input).toEqual({
			a: 'a.js',
			b: 'b.css',
		});
	});

	test('pattern 설정으로 일치를 판정한다', () => {
		expect(
			splitInput({ main: 'main.js', page: 'src/page.wiki' }, { pattern: /\.wiki$/ }).input
		).toEqual({ main: 'main.js' });
	});

	test('extensions를 배열로 지정할 수 있다', () => {
		expect(
			splitInput(
				{ main: 'main.js', a: 'a.scss', b: 'b.sass' },
				{ extensions: ['.scss', '.sass'] }
			).input
		).toEqual({ main: 'main.js' });
	});

	test('문자열 입력의 키는 .js를 뗀 파일 이름이다', () => {
		expect(splitInput('src/main.js', css).input).toEqual({ main: 'src/main.js' });
		expect(splitInput('src/style.css', css).input).toEqual({});
	});

	test('배열 입력도 같은 규칙으로 키를 만든다', () => {
		expect(splitInput(['src/a.js', 'src/b.css'], css).input).toEqual({ a: 'src/a.js' });
	});

	test('사용자가 넘긴 input 객체를 수정하지 않는다', () => {
		const input = { main: 'main.js', style: 'style.css' };
		splitInput(input, css);
		expect(input).toEqual({ main: 'main.js', style: 'style.css' });
	});

	test('input이 없으면 훅이 아무것도 반환하지 않는다', () => {
		expect(splitInput(undefined as never, css).input).toBeUndefined();
	});
});

describe('우선순위와 경고', () => {
	test('설정 둘이 같은 입력에 일치하면 경고하고 입력에서는 한 번만 뺀다', () => {
		const { input, warn } = splitInput(
			{ main: 'main.js', 'style.css': 'style.css' },
			css,
			{ extensions: '.css' }
		);
		expect(input).toEqual({ main: 'main.js' });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('style.css');
		expect(warn.mock.calls[0][0]).toContain('only the first one is used');
	});

	test('일치하는 설정이 하나뿐이면 경고하지 않는다', () => {
		const { warn } = splitInput(
			{ main: 'main.js', style: 'style.css', data: 'data.json' },
			css,
			json
		);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe('에셋 출력', () => {
	let directory: string;
	const file = (name: string) => path.join(directory, name);

	beforeAll(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'input-anything-'));
		await writeFile(file('main.js'), 'console.log("main");');
		await writeFile(file('style.css'), '.a { color: red; }');
		await writeFile(file('data.json'), '{"ok":true}');
	});

	afterAll(() => rm(directory, { recursive: true, force: true }));

	async function build(
		input: Record<string, string>,
		configs: InputAnythingConfig[],
		onwarn?: (warning: RollupLog) => void
	) {
		const bundle = await rollup({ input, plugins: [inputAnything(...configs)], onwarn });
		try {
			const { output } = await bundle.generate({ format: 'es' });
			return {
				assets: output.filter((o): o is OutputAsset => o.type === 'asset'),
				chunks: output.filter((o) => o.type === 'chunk'),
			};
		} finally {
			await bundle.close();
		}
	}

	test('일치한 입력은 원본 그대로 에셋이 되고 JS 청크가 되지 않는다', async () => {
		const { assets, chunks } = await build(
			{ main: file('main.js'), 'style.css': file('style.css') },
			[css]
		);
		expect(chunks).toHaveLength(1);
		expect(assets).toHaveLength(1);
		expect(assets[0].names).toEqual(['style.css']);
		expect(String(assets[0].source)).toBe('.a { color: red; }');
	});

	test('설정이 여럿이어도 CSS와 JSON은 에셋 하나씩, JS는 청크 하나다', async () => {
		const { assets, chunks } = await build(
			{
				main: file('main.js'),
				'style.css': file('style.css'),
				'data.json': file('data.json'),
			},
			[css, json]
		);
		expect(chunks).toHaveLength(1);
		expect(assets.map((a) => a.names[0]).sort()).toEqual(['data.json', 'style.css']);
	});

	test('변환기는 지정한 순서대로 적용된다 (동기와 비동기 혼합)', async () => {
		const { assets } = await build(
			{ main: file('main.js'), 'style.css': file('style.css') },
			[
				{
					extensions: '.css',
					transformer: [
						(code) => code.replace('red', 'blue'),
						async (code) => `/* min */ ${code}`,
					],
				},
			]
		);
		expect(String(assets[0].source)).toBe('/* min */ .a { color: blue; }');
	});

	test('변환기는 일치한 설정의 것만 적용된다', async () => {
		const { assets } = await build(
			{
				main: file('main.js'),
				'style.css': file('style.css'),
				'data.json': file('data.json'),
			},
			[{ extensions: '.css', transformer: (code) => code.toUpperCase() }, json]
		);
		const bySource = Object.fromEntries(
			assets.map((a) => [a.names[0], String(a.source)])
		);
		expect(bySource['style.css']).toBe('.A { COLOR: RED; }');
		expect(bySource['data.json']).toBe('{"ok":true}');
	});

	test('설정 둘이 일치하면 먼저 지정한 설정의 변환기만 쓰고 Rollup 경고로 알린다', async () => {
		const warnings: string[] = [];
		const { assets } = await build(
			{ main: file('main.js'), 'style.css': file('style.css') },
			[
				{ extensions: '.css', transformer: (code) => `first:${code}` },
				{ extensions: '.css', transformer: (code) => `second:${code}` },
			],
			(warning) => warnings.push(warning.message)
		);
		expect(assets).toHaveLength(1);
		expect(String(assets[0].source)).toBe('first:.a { color: red; }');
		expect(
			warnings.some((message) => message.includes('only the first one is used'))
		).toBe(true);
	});
});
