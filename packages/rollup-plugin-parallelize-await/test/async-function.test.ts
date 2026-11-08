import { parse } from 'acorn';
import { describe, expect, test } from 'vitest';
import { bundle } from './bundle.js';

/** 출력 코드가 유효하고 임시 async 표식을 포함하지 않는지 검사한다. */
function expectCleanOutput(code: string): void {
	expect(() =>
		parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
	).not.toThrow();
	expect(code).not.toContain('__async_function__');
	expect(code).not.toContain('"no async"');
}

describe('async 함수 cover/uncover', () => {
	test('함수 선언과 함수 표현식을 async로 복원한다', async () => {
		const code = await bundle(`
      export async function declared() {
        return 1;
      }

      export const expressed = async function () {
        return 2;
      };
    `);

		expect(code).toMatch(/async function declared\(\)/);
		expect(code).toMatch(/async function \(\)/);
		expect(code).not.toContain('"use async"');
		expectCleanOutput(code);
	});

	test('화살표 함수의 표현식 본문을 블록으로 바꾸지 않는다', async () => {
		const code = await bundle(`
      export const increment = async (value) => value + 1;
    `);

		expect(code).toMatch(/async \(?value\)? => value \+ 1/);
		expect(code).not.toMatch(/async \(?value\)? => \{\s*return/);
		expectCleanOutput(code);
	});

	test('동기 함수의 기존 use async 디렉티브를 보존한다', async () => {
		const code = await bundle(`
      export function synchronous() {
        "use async";
        return 1;
      }
    `);

		expect(code).toMatch(/function synchronous\(\)/);
		expect(code).not.toMatch(/async function synchronous\(\)/);
		expect(code).toContain('"use async"');
		expectCleanOutput(code);
	});
});
