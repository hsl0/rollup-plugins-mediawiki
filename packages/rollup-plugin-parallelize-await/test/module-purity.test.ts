import { describe, expect, test } from 'vitest';
import { AWAIT_MARKERS } from '../src/await.js';
import { bundle, bundleModules } from './bundle.js';

const ALL_MARKERS = Object.values(AWAIT_MARKERS);

function expectClean(code: string): void {
	for (const marker of ALL_MARKERS) expect(code).not.toContain(marker);
	expect(code).not.toContain('__async_function__');
}

describe('Rollup 모듈 간 순수성 판정', () => {
	test('별칭, 재내보내기, namespace import의 순수 호출을 병렬화한다', async () => {
		const chunks = await bundleModules({
			entry: `
        import { renamed } from "barrel";
        import * as dependency from "dependency";

        function local() { return 0; }

        export async function run() {
          const localValue = await local();
          const first = await renamed();
          const second = await dependency.annotated();
          return [localValue, first, second];
        }
      `,
			barrel: `export { inferred as renamed } from "dependency";`,
			dependency: `
        export function inferred() {
          return 1;
        }

        /*@__NO_SIDE_EFFECTS__*/
        export function annotated() {
          return Promise.resolve(2);
        }
      `,
		});

		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.code).toMatch(
			/const \[localValue, first, second\] = await Promise\.all\(\[/
		);
		expectClean(chunks[0]!.code);
	});

	test('분리된 청크와 preserveModules에서도 판정을 전달한다', async () => {
		const chunks = await bundleModules(
			{
				entry: `
          import { first, second } from "dependency";
          export async function run() {
            const a = await first();
            const b = await second();
            return [a, b];
          }
        `,
				dependency: `
          export function first() { return 1; }
          export function second() { return 2; }
        `,
			},
			{ input: ['entry', 'dependency'], preserveModules: true }
		);

		expect(chunks.length).toBeGreaterThanOrEqual(2);
		const entry = chunks.find((chunk) => chunk.facadeModuleId === 'entry');
		expect(entry?.code).toMatch(/await Promise\.all\(\[/);
		for (const chunk of chunks) expectClean(chunk.code);
	});

	test('순환 import에서도 원래 선언의 판정을 사용한다', async () => {
		const chunks = await bundleModules({
			entry: `
        import { first, second } from "dependency";
        export const token = 1;
        export async function run() {
          const a = await first();
          const b = await second();
          return [a, b];
        }
      `,
			dependency: `
        import { token } from "entry";
        export function first() { return token; }
        export function second() { return token + 1; }
      `,
		});

		expect(chunks[0]!.code).toMatch(/await Promise\.all\(\[/);
		expectClean(chunks[0]!.code);
	});

	test('부작용이 있는 호출이나 인자가 있으면 자동 병렬화하지 않는다', async () => {
		const chunks = await bundleModules({
			entry: `
        import { impure, pure } from "dependency";
        function sideEffect() { console.log("argument"); return 1; }
        export async function run() {
          const first = await impure();
          const second = await pure(sideEffect());
          return [first, second];
        }
      `,
			dependency: `
        export function impure() { console.log("call"); return 1; }
        export function pure(value) { return value; }
      `,
		});

		expect(chunks[0]!.code).not.toContain('Promise.all');
		expect(chunks[0]!.code.match(/await /g)).toHaveLength(2);
		expectClean(chunks[0]!.code);
	});

	test('자동으로 순수한 호출도 앞선 await 결과를 읽으면 순차 실행한다', async () => {
		const chunks = await bundleModules({
			entry: `
        import { getId, getValue } from "dependency";
        export async function run() {
          const id = await getId();
          const value = await getValue(id);
          return value;
        }
      `,
			dependency: `
        export function getId() { return Promise.resolve(1); }
        export function getValue(id) { return Promise.resolve(id); }
      `,
		});

		expect(chunks[0]!.code).not.toContain('Promise.all');
		expect(chunks[0]!.code.match(/await /g)).toHaveLength(2);
		expectClean(chunks[0]!.code);
	});

	test('external 호출은 pureFunctions 설정이 있을 때만 병렬화한다', async () => {
		const modules = {
			entry: `
        import { first, second } from "external-dependency";
        export async function run() {
          const a = await first();
          const b = await second();
          return [a, b];
        }
      `,
		};
		const common = { external: ['external-dependency'] };

		const unknown = await bundleModules(modules, common);
		expect(unknown[0]!.code).not.toContain('Promise.all');

		const configured = await bundleModules(modules, {
			...common,
			pluginOptions: { pureFunctions: ['first', 'second'] },
		});
		expect(configured[0]!.code).toMatch(/await Promise\.all\(\[/);
		expectClean(configured[0]!.code);
	});

	test('treeshake가 꺼지면 자동 판정을 중단하고 명시적 표식은 유지한다', async () => {
		const automatic = await bundleModules(
			{
				entry: `
          function first() { return 1; }
          function second() { return 2; }
          export async function run() {
            const a = await first();
            const b = await second();
            return [a, b];
          }
        `,
			},
			{ treeshake: false }
		);
		expect(automatic[0]!.code).not.toContain('Promise.all');
		expectClean(automatic[0]!.code);

		const explicit = await bundleModules(
			{
				entry: `
          function first() { return 1; }
          function second() { return 2; }
          export async function run() {
            const a = /*@__CONCURRENT__*/ await first();
            const b = /*@__CONCURRENT__*/ await second();
            return [a, b];
          }
        `,
			},
			{ treeshake: false }
		);
		expect(explicit[0]!.code).toMatch(/await Promise\.all\(\[/);
		expectClean(explicit[0]!.code);
	});

	test('optional call과 중첩 await/yield는 분석 함수를 만들지 않고 복원한다', async () => {
		const code = await bundle(`
      const maybe = async () => 1;
      async function outer(value) { return value; }
      async function inner() { return 2; }
      export async function run() {
        const first = await maybe?.();
        const second = await outer(await inner());
        return [first, second];
      }
      export async function* stream() {
        return await outer(yield 3);
      }
    `);

		expect(code).not.toContain('Promise.all');
		expect(code).toMatch(/await maybe\?\.\(\)/);
		expect(code).toMatch(/await outer\([^)]*await inner\(\)\)/);
		expect(code).toMatch(/await outer\(yield 3\)/);
		expectClean(code);
	});

	test('CONCURRENT 그룹의 인자 안에 중첩된 await도 함께 복원된다', async () => {
		const code = await bundle(`
      async function outer(value) { return value; }
      async function inner() { return 2; }
      export async function run() {
        const a = /*@__CONCURRENT__*/ await outer(await inner());
        const b = /*@__CONCURRENT__*/ await outer(2);
        return [a, b];
      }
    `);

		expect(code).toMatch(/await Promise\.all\(\[/);
		expect(code).toMatch(/outer\(await inner\(\)\)/);
		expectClean(code);
	});

	test('CONCURRENT 그룹의 인자 안에 중첩된 async 화살표도 함께 복원된다', async () => {
		const code = await bundle(`
      async function outer(value) { return value; }
      export async function run() {
        const a = /*@__CONCURRENT__*/ await outer(async () => 1);
        const b = /*@__CONCURRENT__*/ await outer(async () => 2);
        return [a, b];
      }
    `);

		expect(code).toMatch(/await Promise\.all\(\[/);
		expect(code).toMatch(/outer\(async \(\) => 1\)/);
		expect(code).toMatch(/outer\(async \(\) => 2\)/);
		expectClean(code);
	});

	test('분석 함수는 실행되지 않아 각 피연산자를 한 번만 호출한다', async () => {
		const code = await bundle(`
      let calls = 0;
      /*@__NO_SIDE_EFFECTS__*/
      function first() { calls += 1; return Promise.resolve(1); }
      /*@__NO_SIDE_EFFECTS__*/
      function second() { calls += 1; return Promise.resolve(2); }
      export async function run() {
        const a = await first();
        const b = await second();
        return [a, b, calls];
      }
    `);
		const moduleUrl = `data:text/javascript,${encodeURIComponent(code)}`;
		const generated = (await import(moduleUrl)) as {
			run(): Promise<[number, number, number]>;
		};

		await expect(generated.run()).resolves.toEqual([1, 2, 2]);
		expectClean(code);
	});
});
