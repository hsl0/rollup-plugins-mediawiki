import { parse, type Comment as AcornComment } from 'acorn';
import type { Node as AcornNode } from 'acorn';
import * as acornWalk from 'acorn-walk';
import { attachComments } from 'estree-util-attach-comments';
import type { Program } from 'estree';
import MagicString from 'magic-string';
import type { InputOptions, Plugin, TreeshakingOptions } from 'rollup';
import {
	ASYNC_DIRECTIVES,
	ASYNC_FUNCTION_MARKER,
	coverAsyncFunctions,
	uncoverAsyncFunctions,
} from './async.js';
import { AWAIT_MARKERS, coverAwaits, uncoverAwaits } from './await.js';

/** 플러그인이 Rollup에 추가로 순수하다고 알려 줄 호출 경로 목록이다. */
export interface ParallelizeAwaitOptions {
	/** Rollup에 부작용 없는 호출로 추가 등록할 완전한 함수 경로 목록이다. */
	pureFunctions?: readonly string[];
}

/**
 * Acorn으로 모듈을 파싱하고 별도로 수집한 주석을 인접 AST 노드에 연결한다.
 * 연결 결과는 `node.comments`이며 각 주석에는 leading/trailing 방향이 기록된다.
 *
 * @param code 파싱하고 주석을 연결할 JavaScript 모듈 원문
 * @returns 주석 연결이 끝난 ESTree Program
 */
function parseWithComments(code: string): Program {
	// `comments`는 Acorn이 AST와 별도로 보고한 모든 원본 주석을 순서대로 모은다.
	const comments: AcornComment[] = [];
	// `ast`는 code와 동일한 오프셋을 가지며 attachComments의 연결 대상이 된다.
	const ast = parse(code, {
		ecmaVersion: 'latest',
		sourceType: 'module',
		onComment: comments,
	}) as unknown as Program;

	attachComments(ast, comments);
	return ast;
}

/**
 * Rollup의 boolean/preset/object treeshake 입력을 병합 가능한 객체로 정규화한다.
 * treeshake=false는 호출부에서 별도로 처리하므로 여기서는 빈 객체가 된다.
 *
 * @param treeshake 사용자가 Rollup InputOptions에 지정한 모든 허용 형태의 값
 * @returns manualPureFunctions를 안전하게 병합할 수 있는 옵션 객체
 */
function normalizeTreeshake(treeshake: InputOptions['treeshake']): TreeshakingOptions {
	switch (typeof treeshake) {
		case 'object':
			// 이미 상세 옵션 객체이면 사용자가 지정한 필드를 그대로 병합 대상으로 쓴다.
			return treeshake;
		case 'string':
			// 프리셋 문자열은 동등한 객체 형태로 바꿔 manualPureFunctions를 추가할 수 있게 한다.
			return { preset: treeshake };
		default:
			// undefined/true는 Rollup 기본값을 뜻한다. false는 호출부에서 먼저 제외된다.
			return {};
	}
}

/**
 * cover가 만들 await 래퍼 호출 앞에 Rollup PURE 주석을 예약 삽입한다.
 * MagicString은 같은 원본 위치의 overwrite와 prepend를 합성하므로 최종적으로
 * `/*@__PURE__*\/marker(expression)` 형태가 된다.
 *
 * @param ast cover 전 원본 코드에서 파싱한 ESTree Program
 * @param editor await 시작 위치에 PURE 주석 삽입을 예약할 편집기
 */
function markAwaitWrappersPure(ast: Program, editor: MagicString): void {
	acornWalk.full(ast as unknown as AcornNode, (node) => {
		// 전체 순회에서 AwaitExpression만 좁혀야 `start`가 await 키워드 위치임을
		// 전제로 PURE 주석을 정확한 자리에 예약할 수 있다.
		if (node.type === 'AwaitExpression') {
			editor.prependLeft(node.start, '/*@__PURE__*/');
		}
	});
}

/**
 * async/await을 임시 일반 문법으로 가린 뒤 Rollup 분석 후 다시 복원하는 플러그인이다.
 *
 * @param pluginOptions 순수 함수 경로 등 플러그인별 사용자 옵션
 * @returns Rollup options/transform/renderChunk 훅을 구현한 플러그인
 */
export default function parallelizeAwait(
	pluginOptions: ParallelizeAwaitOptions = {}
): Plugin {
	return {
		name: 'rollup-plugin-parallelize-await',

		options(inputOptions) {
			// `inputOptions`는 다른 플러그인과 사용자가 앞서 구성한 Rollup 입력 옵션이다.
			// 트리셰이킹이 꺼져 있으면 이 플러그인의 순수성 우회 자체가 의미가 없다.
			if (inputOptions.treeshake === false) return null;

			// `treeshake`는 사용자 설정을 보존하면서 순수 함수 목록을 병합할 객체 형태다.
			const treeshake = normalizeTreeshake(inputOptions.treeshake);

			// 사용자가 지정한 순수 함수는 기존 Rollup 설정을 덮지 않고 뒤에 합친다.
			return {
				...inputOptions,
				treeshake: {
					...treeshake,
					manualPureFunctions: [
						...(treeshake.manualPureFunctions ?? []),
						...(pluginOptions.pureFunctions ?? []),
					],
				},
			} satisfies InputOptions;
		},

		transform(code) {
			// `code`는 Rollup이 현재 모듈에 대해 transform 훅으로 전달한 원본 문자열이다.
			// 파싱 비용을 피하기 위한 빠른 경로다. 식별자 일부가 포함된 경우에는 파싱한다.
			if (!code.includes('await') && !code.includes('async')) return null;

			// `ast`는 cover 대상과 주변 의미 주석을 탐색할 원본 모듈 트리다.
			const ast = parseWithComments(code);
			// `editor`는 두 cover 단계의 편집을 같은 원본 오프셋 기준으로 합성한다.
			const editor = new MagicString(code);

			// Rollup이 모듈을 분석하기 전에 async/await을 일반 함수와 호출 형태로 가린다.
			// PURE 표식은 cover가 같은 위치에 만들 await 마커 호출에 적용된다.
			markAwaitWrappersPure(ast, editor);
			// `awaitsCovered`는 하나 이상의 await 마커 호출이 생성됐는지를 나타낸다.
			const awaitsCovered = coverAwaits(code, ast, editor, AWAIT_MARKERS);
			// `asyncFunctionsCovered`는 async 함수 또는 충돌 디렉티브가 수정됐는지를 나타낸다.
			const asyncFunctionsCovered = coverAsyncFunctions(
				code,
				ast,
				editor,
				ASYNC_DIRECTIVES,
				ASYNC_FUNCTION_MARKER
			);

			// 실제 수정이 없다면 null을 반환해 Rollup이 불필요한 코드와 소스맵을
			// 새 변환 결과로 취급하지 않게 한다.
			if (!awaitsCovered && !asyncFunctionsCovered) return null;

			return {
				code: editor.toString(),
				map: editor.generateMap({ hires: 'boundary' }),
			};
		},

		renderChunk(code) {
			// `code`는 Rollup 분석과 트리셰이킹을 마친 뒤 renderChunk에 전달된 청크다.
			// 이 플러그인이 만든 표식이 없는 청크는 파싱하지 않는다.
			// `hasMarker`는 청크 파싱 전에 고정 await/async 프로토콜의 존재를 싸게 검사한다.
			const hasMarker =
				Object.values(AWAIT_MARKERS).some((marker) => code.includes(marker)) ||
				code.includes(ASYNC_DIRECTIVES.async) ||
				code.includes(ASYNC_DIRECTIVES.noAsync) ||
				code.includes(ASYNC_FUNCTION_MARKER);

			// 어떤 표식도 없다면 이 청크에는 복원할 대상이 없으므로 파싱을 생략한다.
			if (!hasMarker) return null;

			// `ast`는 Rollup 최적화 뒤 살아남은 마커와 연속 문장 관계를 분석할 청크 트리다.
			const ast = parseWithComments(code);
			// `editor`는 병렬화와 async/await 복원을 동일한 청크 원문에 기록한다.
			const editor = new MagicString(code);
			// `changed`는 두 uncover 단계의 수정 여부를 누적해 반환값을 결정한다.
			let changed = false;

			// Rollup 트리셰이킹 이후 살아남은 await 마커를 먼저 병렬화·복원하고,
			// async 함수 디렉티브와 화살표 래퍼를 이어서 복원한다.
			changed = uncoverAwaits(code, ast, editor, AWAIT_MARKERS) || changed;
			changed =
				uncoverAsyncFunctions(
					code,
					ast,
					editor,
					ASYNC_DIRECTIVES,
					ASYNC_FUNCTION_MARKER
				) || changed;

			return changed
				? {
						code: editor.toString(),
						map: editor.generateMap({ hires: 'boundary' }),
					}
				: null;
		},
	};
}
