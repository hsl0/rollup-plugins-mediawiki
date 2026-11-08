import type { Node as AcornNode } from 'acorn';
import * as acornWalk from 'acorn-walk';
import type { Node, Program } from 'estree';
import MagicString from 'magic-string';
import {
	getNearbyComments,
	removeCommentMarker,
	type CommentedNode,
	type PositionedComment,
} from './comment.js';
import {
	getAwaitMarkerCall,
	overlapsParallelizedRange,
	parallelizeAwaits,
	type AwaitMarkerKind,
	type AwaitMarkers,
} from './parallelize.js';

export type { AwaitMarkerKind, AwaitMarkers } from './parallelize.js';

/**
 * Rollup 분석 중 await 표현식을 대신하는 고정 호출 식별자 세트다.
 *
 * 종류를 식별자 자체에 보존하므로 renderChunk 시점에도 일반 await,
 * 명시적 PURE await, 강제 CONCURRENT await을 구분할 수 있다.
 */
export const AWAIT_MARKERS: AwaitMarkers = Object.freeze({
	/** 안전성 표식이 없는 await을 보존하는 식별자다. */
	await: '__rollup_plugin_parallelize_await_await__',
	/** PURE 주석이 붙은 await을 보존하는 식별자다. */
	pure: '__rollup_plugin_parallelize_await_pure__',
	/** CONCURRENT 주석이 붙은 await을 보존하는 식별자다. */
	concurrent: '__rollup_plugin_parallelize_await_concurrent__',
});

/** Rollup 관례의 PURE 표식에서 `@`와 `#` 표기를 모두 인식하는 패턴이다. */
const PURE_COMMENT = /[@#]__PURE__/;
/** 사용자가 병렬 실행을 강제하는 CONCURRENT 표식을 인식하는 패턴이다. */
const CONCURRENT_COMMENT = /[@#]__CONCURRENT__/;
/** cover 단계가 마커 호출을 Rollup에 순수하다고 알리기 위해 삽입하는 정확한 주석이다. */
const WRAPPER_PURE_COMMENT = '/*@__PURE__*/';

/** ESTree 노드 T에 MagicString이 요구하는 원문 오프셋과 주석 정보를 더한 타입이다. */
type Positioned<T extends Node = Node> = T & {
	/** 노드가 시작하는 0 기반 문자 오프셋이다. */
	start: number;
	/** 노드가 끝나는 배타적 문자 오프셋이다. */
	end: number;
} & CommentedNode;

/**
 * 모든 await 표현식을 Rollup이 일반 호출로 분석할 수 있는 형태로 가린다.
 *
 * @param code AST 위치의 기준이 된 원본 코드
 * @param ast 주석이 연결된 변환 전 AST
 * @param editor 원본 코드를 보존하는 MagicString 편집기
 * @param markers await 종류별 임시 호출 식별자
 * @returns 하나 이상의 await을 가렸으면 true
 */
export function coverAwaits(
	code: string,
	ast: Program,
	editor: MagicString,
	markers: AwaitMarkers
): boolean {
	// `changed`는 호출자가 변환 결과를 반환해야 하는지 알려 주는 누적 변경 상태다.
	let changed = false;

	acornWalk.fullAncestor(ast as unknown as AcornNode, (acornNode) => {
		// `node`는 acorn-walk 노드를 이 모듈이 사용하는 ESTree 판별 공용 타입으로 본 값이다.
		const node = acornNode as unknown as Node;

		// 전체 AST를 순회하므로 먼저 AwaitExpression만 남긴다. 이 가드를 통과하면
		// `argument`와 await 표현식 전체 범위를 사용해 호출 형태로 바꿀 수 있다.
		if (node.type !== 'AwaitExpression') return;

		// `awaitNode`는 타입 가드가 확인한 AwaitExpression에 원문 위치 타입을 결합한 값이다.
		const awaitNode = node as Positioned<typeof node>;
		// `comments`는 await 키워드 앞과 피연산자 앞에 붙을 수 있는 표식을 합친 목록이다.
		const comments = getNearbyComments(awaitNode, awaitNode.argument as Positioned);
		// `kind`는 주석에서 결정해 마커 호출에 보존할 병렬화 안전성 종류다.
		const kind = getAwaitKind(comments);
		// `marker`는 현재 종류를 Rollup 분석 이후까지 운반할 고정 호출 식별자다.
		const marker = markers[kind];
		// `hasPurityProbe`는 Rollup이 피연산자의 부작용을 분석할 보조 호출을 만들 수
		// 있는지를 나타낸다. 명시적 표식은 기존 의미를 그대로 사용하며, 중첩 await이나
		// yield가 있는 호출은 원문 편집 범위가 겹칠 수 있어 자동 분석에서 제외한다.
		const hasPurityProbe =
			kind === 'await' && canProbePurity(awaitNode.argument as Positioned);

		// `await foo()`의 키워드를 `awaitMarker(`로 바꾸고 표현식 뒤에 `)`를 붙인다.
		// 결과는 일반 함수 호출처럼 보여 Rollup이 호출의 순수성을 분석할 수 있다.
		editor.overwrite(awaitNode.start, awaitNode.start + 'await'.length, `${marker}(`);
		if (hasPurityProbe) {
			// 두 번째 인자의 함수는 실행되지 않는다. Rollup은 그 본문에서 결과가 버려지는
			// 동일 호출을 제거할 수 있는지 분석하고, renderChunk는 빈 본문을 순수성 신호로
			// 읽는다. 첫 번째 인자만 최종 await 피연산자로 복원된다.
			const argumentCode = code.slice(
				(awaitNode.argument as Positioned).start,
				(awaitNode.argument as Positioned).end
			);
			editor.appendRight(awaitNode.end, `, () => { ${argumentCode}; })`);
		} else {
			editor.appendRight(awaitNode.end, ')');
		}

		if (kind !== 'await') {
			// PURE/CONCURRENT 의미는 식별자 종류에 보존됐으므로 원래 주석에서 제거한다.
			// `pattern`은 현재 kind를 결정했던 표식만 골라 제거하는 정규식이다.
			const pattern = kind === 'pure' ? PURE_COMMENT : CONCURRENT_COMMENT;
			removeCommentMarker(editor, comments, pattern);
		}

		changed = true;
	});

	return changed;
}

/**
 * await 피연산자를 Rollup 순수성 검사 함수에 안전하게 복사할 수 있는지 판별한다.
 * 일반 동기 CallExpression만 허용하며 optional call과 중첩 await/yield는 제외한다.
 *
 * @param argument 원본 await 피연산자
 * @returns 분석용 함수로 복사해도 되는 호출이면 true
 */
function canProbePurity(argument: Positioned): boolean {
	if (argument.type !== 'CallExpression' || argument.optional) return false;

	let containsSuspension = false;
	acornWalk.full(argument as unknown as AcornNode, (node) => {
		if (
			node !== argument &&
			(node.type === 'AwaitExpression' || node.type === 'YieldExpression')
		) {
			containsSuspension = true;
		}
	});
	return !containsSuspension;
}

/**
 * Rollup 출력에 남은 await 마커를 실제 await 문법으로 복원한다.
 *
 * @param code renderChunk에서 받은 청크 원문
 * @param ast 청크 원문을 파싱한 AST
 * @param editor 청크 원문을 수정하는 MagicString
 * @param markers transform 단계에서 사용한 것과 동일한 마커 세트
 * @returns 병렬화 또는 개별 await 복원이 한 번이라도 일어났으면 true
 */
export function uncoverAwaits(
	code: string,
	ast: Program,
	editor: MagicString,
	markers: AwaitMarkers
): boolean {
	// 병렬화 가능한 호출을 먼저 Promise.all 골격으로 교체한다. 반환된 정보는
	// 아래의 개별 복원 순회에서 같은 호출을 다시 수정하지 않고, 골격이 이미
	// 흡수한 원문 구간을 다시 편집하지 않기 위한 제외 목록이다.
	const { calls: parallelizedCalls, ranges: parallelizedRanges } = parallelizeAwaits(
		ast,
		editor,
		markers
	);
	// `changed`는 병렬화 결과를 초기값으로 삼고 개별 복원 여부를 누적한다.
	let changed = parallelizedCalls.size > 0;

	acornWalk.full(ast as unknown as AcornNode, (acornNode) => {
		// `node`는 마커 호출 여부를 검사할 현재 ESTree 노드다.
		const node = acornNode as unknown as Node;

		// 호출식이 아닌 노드는 마커 호출일 수 없다.
		if (node.type !== 'CallExpression') return;

		// `call`은 고정 마커 호출로 검증된 경우에만 종류와 단일 인자를 포함한다.
		const call = getAwaitMarkerCall(node, markers);

		// 일반 사용자 호출은 그대로 두고, 고정 마커 이름과 단일 인자 구조를 모두
		// 만족하는 플러그인 호출만 실제 await 문법으로 복원한다.
		if (!call) return;

		const parallelized = parallelizedCalls.has(node);

		// transform에서 await 마커 호출을 Rollup에 순수하다고 알리기 위해 추가한
		// 주석은 역할을 마쳤으므로 최종 await 문법에 남기지 않는다. 골격 구간
		// 안의 주석은 이미 Promise.all 텍스트로 대체됐으므로 다시 편집하지 않는다.
		const wrapperPureComments = getNearbyComments(
			call as AwaitMarkerCallWithComments
		).filter(
			(comment) =>
				PURE_COMMENT.test(comment.value) &&
				!overlapsParallelizedRange(parallelizedRanges, comment.start, comment.end)
		);
		removeCommentMarker(editor, wrapperPureComments, PURE_COMMENT);

		// 파일 첫 표현식의 래퍼 주석은 Program에 연결될 수 있어 call.comments에서
		// 발견되지 않는다. 골격 구간 안쪽은 Promise.all overwrite가 대체하므로,
		// 그 범위 밖에 남은 정확한 내부 주석만 직접 제거한다.
		const wrapperCommentStart = call.start - WRAPPER_PURE_COMMENT.length;
		const wrapperCommentIsAttached = wrapperPureComments.some(
			(comment) => comment.start === wrapperCommentStart && comment.end === call.start
		);

		if (
			!wrapperCommentIsAttached &&
			wrapperCommentStart >= 0 &&
			code.slice(wrapperCommentStart, call.start) === WRAPPER_PURE_COMMENT &&
			!overlapsParallelizedRange(parallelizedRanges, wrapperCommentStart, call.start)
		) {
			editor.remove(wrapperCommentStart, call.start);
		}

		// Promise.all로 치환된 호출은 위의 주석 정리만 하고 개별 await으로 복원하지 않는다.
		if (parallelized) return;

		// 그룹에 들지 못한 `marker(expression)`의 바깥 부분만 바꿔
		// 원래 피연산자를 손대지 않고 `await expression`으로 되돌린다.
		editor.overwrite(call.start, call.argument.start, 'await ');
		editor.remove(call.argument.end, call.end);
		changed = true;
	});

	return changed;
}

/** 복원 시 마커 호출에 연결된 Rollup 주석을 읽기 위한 내부 타입이다. */
type AwaitMarkerCallWithComments = ReturnType<typeof getAwaitMarkerCall> & CommentedNode;

/**
 * await 주변 주석에서 마커 종류를 결정한다.
 *
 * PURE가 CONCURRENT보다 우선하며 둘 다 없으면 일반 await이다. 일반 await은
 * 안전성이 확인되지 않았으므로 `parallelizeAwaits`의 후보가 되지 않는다.
 *
 * @param comments await 표현식과 피연산자 주변에서 수집한 원본 주석 목록
 * @returns 표식 우선순위에 따라 결정한 await 마커 종류
 */
function getAwaitKind(comments: PositionedComment[]): AwaitMarkerKind {
	// 두 표식이 함께 있으면 더 강한 순수성 선언인 PURE를 우선한다.
	if (comments.some((comment) => PURE_COMMENT.test(comment.value))) {
		return 'pure';
	}
	if (comments.some((comment) => CONCURRENT_COMMENT.test(comment.value))) {
		return 'concurrent';
	}
	// 명시적 안전성 표식이 없는 await은 병렬화 대상이 아닌 일반 종류로 남긴다.
	return 'await';
}
