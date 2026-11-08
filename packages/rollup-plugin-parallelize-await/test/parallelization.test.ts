import { parse } from 'acorn';
import type { Program } from 'estree';
import { describe, expect, test } from 'vitest';
import type { ParallelizeAwaitOptions } from '../src/main.js';
import { bundle } from './bundle.js';

/** 위치와 export 래퍼를 제외해 포맷에 영향받지 않는 AST를 만든다. */
function comparableAst(code: string): unknown {
	const ast = parse(code, {
		ecmaVersion: 'latest',
		sourceType: 'module',
	}) as unknown as Program;

	ast.body = ast.body.filter((node) => node.type !== 'ExportNamedDeclaration');
	return removeLocations(ast);
}

/** AST에서 소스 위치 필드만 재귀적으로 제거한다. */
function removeLocations(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(removeLocations);
	if (!value || typeof value !== 'object') return value;

	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === 'start' || key === 'end') continue;
		result[key] = removeLocations(child);
	}
	return result;
}

/** 기존 입출력 사례를 Rollup 전체 파이프라인에서 검증한다. */
async function expectTransformation(
	input: string,
	output: string,
	exportedName: string,
	options: ParallelizeAwaitOptions = {}
): Promise<void> {
	const actual = await bundle(`${input}\nexport { ${exportedName} };`, options);
	expect(comparableAst(actual)).toEqual(comparableAst(output));
}

describe('await 병렬화 입출력 사례', () => {
	test('함수 정의와 호출의 순수성을 이용해 병렬화한다', async () => {
		const input = `
      /*@__NO_SIDE_EFFECTS__*/
      async function fetchData1() {
        return Promise.resolve('Data 1');
      }

      /*@__NO_SIDE_EFFECTS__*/
      async function fetchData2() {
        return Promise.resolve('Data 2');
      }

      async function getMyData() {
        const data1 = await fetchData1(); // 함수 정의 주석으로 순수 판단
        const data2 = await fetchData2(); // 함수 정의 주석으로 순수 판단
        const data3 = await /*@__PURE__*/ Promise.resolve('Data 3'); // 호출 주석으로 순수 판단
        console.log('Fetching complete');
        return { data1, data2, data3 };
      }
    `;

		const output = `
      /*@__NO_SIDE_EFFECTS__*/
      async function fetchData1() {
        return Promise.resolve('Data 1');
      }

      /*@__NO_SIDE_EFFECTS__*/
      async function fetchData2() {
        return Promise.resolve('Data 2');
      }

      async function getMyData() {
        const [data1, data2, data3] = await Promise.all([
          fetchData1(), // 함수 정의 주석으로 순수 판단
          fetchData2(), // 함수 정의 주석으로 순수 판단
          Promise.resolve('Data 3') // 호출 주석으로 순수 판단
        ]);
        console.log('Fetching complete');
        return { data1, data2, data3 };
      }
    `;

		await expectTransformation(input, output, 'getMyData');
	});

	test('앞선 await 결과에 의존하면 병렬화하지 않는다', async () => {
		const input = `
      /*@__NO_SIDE_EFFECTS__*/
      async function fetchId() {
        return 123;
      }

      /*@__NO_SIDE_EFFECTS__*/
      async function fetchDataById(id) {
        return 'Data for ID: ' + id;
      }

      async function processData() {
        const id = await fetchId();
        const data = await fetchDataById(id); // 'id'에 의존
        return data;
      }
    `;

		const output = `
      /*@__NO_SIDE_EFFECTS__*/
      async function fetchId() {
        return 123;
      }

      /*@__NO_SIDE_EFFECTS__*/
      async function fetchDataById(id) {
        return 'Data for ID: ' + id;
      }

      async function processData() {
        const id = await fetchId();
        const data = await fetchDataById(id); // 'id'에 의존
        return data;
      }
    `;

		await expectTransformation(input, output, 'processData');
	});

	test('CONCURRENT 주석이 붙은 독립 await을 강제로 병렬화한다', async () => {
		const input = `
      async function logAndFetch(message) {
        console.log(message);
        return Promise.resolve('Result ' + message);
      }

      async function runTasks() {
        const resultA = /*@__CONCURRENT__*/ await logAndFetch('Task A'); // CONCURRENT 주석 (await 앞)
        const resultB = await /*@__CONCURRENT__*/ logAndFetch('Task B'); // CONCURRENT 주석 (await 뒤, 피연산자 앞)
        const finalResult = 'Combined: ' + resultA + ' and ' + resultB;

        const processedResult = /*@__CONCURRENT__*/ await logAndFetch(resultA + ' processed'); // 'resultA'에 의존
        return finalResult + processedResult;
      }
    `;

		const output = `
      async function logAndFetch(message) {
        console.log(message);
        return Promise.resolve('Result ' + message);
      }

      async function runTasks() {
        const [resultA, resultB] = await Promise.all([ // CONCURRENT 주석 제거, 병렬화
          logAndFetch('Task A'),
          logAndFetch('Task B')
        ]);
        const finalResult = 'Combined: ' + resultA + ' and ' + resultB;

        const processedResult = await logAndFetch(resultA + ' processed'); // 데이터 종속성으로 인해 병렬화되지 않음
        return finalResult + processedResult;
      }
    `;

		await expectTransformation(input, output, 'runTasks');
	});

	test('설정으로 지정한 순수 함수 호출을 병렬화한다', async () => {
		// 플러그인 설정 예시: { pureFunctions: ["getRemoteConfig", "loadUserData"] }
		const input = `
      async function getRemoteConfig() {
        return Promise.resolve({ setting: true });
      }

      async function loadUserData() {
        return Promise.resolve({ user: 'Alice' });
      }

      async function initializeApp() {
        const config = await getRemoteConfig(); // 설정으로 순수 판단
        const user = await loadUserData(); // 설정으로 순수 판단
        return { config, user };
      }
    `;

		const output = `
      async function getRemoteConfig() {
        return Promise.resolve({ setting: true });
      }

      async function loadUserData() {
        return Promise.resolve({ user: 'Alice' });
      }

      async function initializeApp() {
        const [config, user] = await Promise.all([
          getRemoteConfig(),
          loadUserData()
        ]);
        return { config, user };
      }
    `;

		await expectTransformation(input, output, 'initializeApp', {
			pureFunctions: ['getRemoteConfig', 'loadUserData'],
		});
	});
});
