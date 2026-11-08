import { parse, type Comment as AcornComment } from 'acorn';
import { attachComments } from 'estree-util-attach-comments';
import type { Program } from 'estree';
import MagicString from 'magic-string';
import { describe, expect, test } from 'vitest';
import { AWAIT_MARKERS, coverAwaits, uncoverAwaits } from '../src/await.js';

/** cover/uncover 유닛 테스트용으로 주석이 연결된 AST를 만든다. */
function parseWithComments(code: string): Program {
	const comments: AcornComment[] = [];
	const ast = parse(code, {
		ecmaVersion: 'latest',
		sourceType: 'module',
		onComment: comments,
	}) as unknown as Program;
	attachComments(ast, comments);
	return ast;
}

/** Rollup을 거치지 않고 await cover 결과만 반환한다. */
function cover(code: string): string {
	const editor = new MagicString(code);
	coverAwaits(code, parseWithComments(code), editor, AWAIT_MARKERS);
	return editor.toString();
}

/** 이미 cover된 코드를 병렬화하고 uncover한다. */
function uncover(code: string): string {
	const editor = new MagicString(code);
	uncoverAwaits(code, parseWithComments(code), editor, AWAIT_MARKERS);
	return editor.toString();
}

describe('await 변환 단계', () => {
	test('await 앞과 피연산자 앞의 CONCURRENT 주석을 모두 인식한다', () => {
		const covered = cover(`
      async function load() {
        const first = /* @__CONCURRENT__ */ await one();
        const second = await /* @__CONCURRENT__ */ two();
      }
    `);

		const concurrentCount = covered.split(AWAIT_MARKERS.concurrent).length - 1;
		expect(concurrentCount).toBe(2);
		expect(covered).not.toContain('@__CONCURRENT__');
	});

	test('피연산자 앞의 PURE 주석을 pure 마커로 변환한다', () => {
		const covered = cover(`
      async function load() {
        const value = await /* @__PURE__ */ loadValue();
      }
    `);

		expect(covered).toContain(AWAIT_MARKERS.pure);
		expect(covered).not.toContain('@__PURE__');
	});

	test('두 concurrent 마커를 직접 받으면 Promise.all로 병렬화한다', () => {
		const covered = `
      function load() {
        "use async";
        const first = ${AWAIT_MARKERS.concurrent}(one());
        const second = ${AWAIT_MARKERS.concurrent}(two());
        return [first, second];
      }
    `;

		const uncovered = uncover(covered);
		expect(uncovered).toContain(
			'const [first, second] = await Promise.all([one(), two()]);'
		);
	});

	test('일반 await 마커는 내부 호출의 순수성과 무관하게 일반 종류로 남는다', () => {
		const covered = cover(`
      async function load() {
        const first = await configuredPureFunction();
        const second = await annotatedFunction();
      }
    `);

		expect(covered.match(/__rollup_plugin_parallelize_await_await__/g)).toHaveLength(2);
		expect(covered).not.toContain(AWAIT_MARKERS.pure);
		expect(covered).not.toContain(AWAIT_MARKERS.concurrent);
	});

	test('결과를 바인딩하지 않는 concurrent 마커들은 바인딩 없는 Promise.all로 병렬화한다', () => {
		const covered = `
      function load() {
        "use async";
        ${AWAIT_MARKERS.concurrent}(one());
        ${AWAIT_MARKERS.concurrent}(two());
        return null;
      }
    `;

		const uncovered = uncover(covered);
		expect(uncovered).toContain('await Promise.all([one(), two()]);');
	});

	test('일부만 바인딩된 concurrent 그룹은 빈 슬롯을 유지한 구조 분해로 병렬화한다', () => {
		const covered = `
      function load() {
        "use async";
        const first = ${AWAIT_MARKERS.concurrent}(one());
        ${AWAIT_MARKERS.concurrent}(two());
        const third = ${AWAIT_MARKERS.concurrent}(three());
        return [first, third];
      }
    `;

		const uncovered = uncover(covered);
		expect(uncovered).toContain(
			'const [first, , third] = await Promise.all([one(), two(), three()]);'
		);
	});
});
