import MagicString from 'magic-string';
import * as acornWalk from 'acorn-walk';
import type { Node as AcornNode } from 'acorn';
import type {
	ArrowFunctionExpression,
	CallExpression,
	ExpressionStatement,
	FunctionDeclaration,
	FunctionExpression,
	Literal,
	Node,
	Program,
} from 'estree';
import { getNearbyComments, removeCommentMarker, type CommentedNode } from './comment.js';

/** async 화살표 래퍼에 추가한 Rollup PURE 표식을 찾아내는 패턴이다. */
const PURE_COMMENT = /[@#]__PURE__/;

/**
 * 함수 선언·함수 표현식의 async 상태를 일반 함수 본문에 기록하는 디렉티브다.
 * `noAsync`는 사용자 코드에 원래 있던 `use async`를 escape하는 데 사용한다.
 */
export const ASYNC_DIRECTIVES = Object.freeze({
	/** 원래 async였던 함수 선언·표현식을 표시한다. */
	async: 'use async',
	/** 사용자 코드에 원래 있던 use-async 디렉티브를 escape한다. */
	noAsync: 'no async',
});

/** 고정 async 디렉티브 세트의 키와 읽기 전용 리터럴 값을 보존하는 타입이다. */
export type AsyncDirectives = typeof ASYNC_DIRECTIVES;

/**
 * Rollup 분석 중 async 화살표 함수를 감싸는 고정 호출 식별자다.
 * 화살표 함수에는 본문 왜곡 없이 디렉티브를 삽입할 수 없으므로 래퍼를 쓴다.
 */
export const ASYNC_FUNCTION_MARKER = '__async_function__';

/** cover가 처리하는 독립 함수 선언·표현식과 화살표 함수의 합집합이다. */
type SupportedFunction =
	| FunctionDeclaration
	| FunctionExpression
	| ArrowFunctionExpression;

/** ESTree 노드 T에 MagicString 편집용 원문 오프셋을 더한 타입이다. */
type Positioned<T extends Node = Node> = T & {
	/** 노드가 시작하는 0 기반 문자 오프셋이다. */
	start: number;
	/** 노드가 끝나는 배타적 문자 오프셋이다. */
	end: number;
};

/**
 * async 함수를 Rollup이 일반 함수로 분석할 수 있는 임시 형태로 가린다.
 *
 * @param code AST 위치와 async 토큰 탐색의 기준이 되는 원본 코드
 * @param ast 변환 전 모듈의 ESTree Program
 * @param editor 원본 오프셋을 유지하며 수정 사항을 기록하는 편집기
 * @param directives 함수 선언·표현식에 삽입할 async/escape 문자열 세트
 * @param arrowMarker async 화살표 함수를 감싸는 호출 식별자
 * @returns 하나 이상의 함수 또는 충돌 디렉티브를 가렸으면 true
 */
export function coverAsyncFunctions(
	code: string,
	ast: Program,
	editor: MagicString,
	directives: AsyncDirectives,
	arrowMarker: string
): boolean {
	// `changed`는 어떤 함수라도 수정했는지를 모든 순회 분기에서 누적한다.
	let changed = false;

	acornWalk.fullAncestor(
		ast as unknown as AcornNode,
		(acornNode, _state, acornAncestors) => {
			// `node`는 현재 acorn-walk 노드를 ESTree 공용 타입으로 해석한 값이다.
			const node = acornNode as unknown as Node;
			// `ancestors`는 현재 노드까지의 경로이며 바로 앞 부모로 메서드 여부를 판별한다.
			const ancestors = acornAncestors as unknown as Node[];

			// 전체 AST 중 이 변환기가 지원하는 세 함수 노드만 남긴다. 통과 후에는
			// `async`, `body`와 함수의 원문 범위를 공통으로 사용할 수 있다.
			if (!isSupportedFunction(node)) return;

			// 객체·클래스 메서드는 async 토큰을 제거하면 독립 함수와 다른 문법이 되므로
			// 현재 프로토콜로 안전하게 cover할 수 없다.
			if (isMethodFunction(ancestors.at(-2), node)) return;

			if (node.type === 'ArrowFunctionExpression') {
				// 동기 화살표 함수는 async 상태를 가리거나 충돌 디렉티브를 escape할
				// 필요가 없으므로 그대로 둔다.
				if (!node.async) return;

				// `async (x) => x + 1`을 `/* PURE */ marker((x) => x + 1)`로 바꾼다.
				// 디렉티브를 넣으려고 표현식 본문을 블록으로 왜곡하지 않기 위한 경로다.
				// `arrow`는 async 화살표 노드에 원문 편집 범위를 명시한 값이다.
				const arrow = node as Positioned<ArrowFunctionExpression>;
				// `asyncToken`은 화살표 헤더에서 실제 async 키워드가 차지하는 원문 범위다.
				const asyncToken = findAsyncToken(code, arrow);

				// AST가 async라고 하더라도 원문 헤더에서 토큰을 찾지 못하면 정확한 수정
				// 범위를 보장할 수 없으므로, 잘못된 위치를 덮어쓰지 않고 건너뛴다.
				if (!asyncToken) return;

				editor.overwrite(
					asyncToken.start,
					asyncToken.end,
					`/*@__PURE__*/${arrowMarker}(`
				);
				editor.appendRight(arrow.end, ')');
				changed = true;
				return;
			}

			if (!node.async) {
				// 원래 동기 함수가 "use async"로 시작하면 uncover가 async 함수로
				// 오인하지 않도록 그 앞에 "no async"를 삽입한다.
				changed = coverExistingAsyncDirective(node, editor, directives) || changed;
				return;
			}

			// `functionNode`는 디렉티브 방식을 사용할 async 선언/표현식의 위치 포함 노드다.
			const functionNode = node as Positioned<FunctionDeclaration | FunctionExpression>;
			// `asyncToken`은 제거할 async 키워드의 정확한 원문 범위다.
			const asyncToken = findAsyncToken(code, functionNode);

			// 파서가 표시한 async 상태와 원문이 일치하지 않는 비정상 입력에서는
			// 임의의 범위를 삭제하지 않는다.
			if (!asyncToken) return;

			editor.remove(asyncToken.start, asyncToken.end);

			// `async function foo(){}`에서 async를 제거하고 블록 첫 위치에
			// `"use async";`를 삽입한다. 함수 선언과 표현식은 항상 블록 본문이다.
			// `body`는 여는 중괄호 바로 뒤에 디렉티브를 넣기 위해 위치를 명시한 블록이다.
			const body = functionNode.body as Positioned<typeof functionNode.body>;
			editor.appendLeft(body.start + 1, `${JSON.stringify(directives.async)};`);

			changed = true;
		}
	);

	return changed;
}

/**
 * Rollup 출력에 살아남은 async 디렉티브와 화살표 래퍼를 원래 문법으로 복원한다.
 *
 * @param code Rollup이 생성한 청크 원문
 * @param ast 청크 원문을 파싱한 ESTree Program
 * @param editor 청크 원문에 복원 편집을 기록하는 편집기
 * @param directives cover 단계와 동일한 async/escape 문자열 세트
 * @param arrowMarker cover 단계와 동일한 화살표 래퍼 식별자
 * @returns 하나 이상의 임시 표식을 복원하거나 제거했으면 true
 */
export function uncoverAsyncFunctions(
	code: string,
	ast: Program,
	editor: MagicString,
	directives: AsyncDirectives,
	arrowMarker: string
): boolean {
	// `changed`는 두 번의 AST 순회에서 발생한 모든 복원 여부를 누적한다.
	let changed = false;

	acornWalk.fullAncestor(ast as unknown as AcornNode, (acornNode) => {
		// `node`는 화살표 래퍼 호출인지 검사할 현재 ESTree 노드다.
		const node = acornNode as unknown as Node;

		// 화살표 래퍼는 CallExpression으로만 존재한다. 이 가드 덕분에 아래 판별기는
		// callee와 arguments를 안전하게 검사할 수 있다.
		if (node.type !== 'CallExpression') return;

		// `call`은 플러그인 래퍼 형태로 검증된 호출과 그 화살표 인자다.
		const call = getAsyncArrowCall(node, arrowMarker);

		// 이름이나 인자 형태가 하나라도 다른 호출은 사용자가 작성한 코드일 수 있으므로
		// 플러그인 래퍼로 간주하지 않는다.
		if (!call) return;

		// 래퍼를 순수 호출로 표시하기 위해 cover에서 추가했던 PURE 주석도 제거한다.
		// `pureComments`는 래퍼를 Rollup에 순수 호출로 알리기 위해 추가했던 주석만 담는다.
		const pureComments = getNearbyComments(call).filter((comment) =>
			PURE_COMMENT.test(comment.value)
		);
		removeCommentMarker(editor, pureComments, PURE_COMMENT);
		// `marker((x) => value)`의 래퍼 범위만 `async `로 치환한다.
		// ArrowFunctionExpression 자체는 수정하지 않아 원래 본문 형태가 유지된다.
		editor.overwrite(call.start, call.arrow.start, 'async ');
		editor.remove(call.arrow.end, call.end);
		changed = true;
	});

	acornWalk.fullAncestor(
		ast as unknown as AcornNode,
		(acornNode, _state, acornAncestors) => {
			// `node`는 async 디렉티브가 있는지 검사할 현재 함수 후보 노드다.
			const node = acornNode as unknown as Node;
			// `ancestors`는 바로 위 부모가 객체·클래스 메서드인지 판별하는 경로다.
			const ancestors = acornAncestors as unknown as Node[];

			// 디렉티브 복원은 블록 본문을 갖는 함수 선언/표현식에만 적용한다. 이미 async인
			// 함수는 Rollup 출력에 원래 문법으로 남은 것이므로 다시 async를 붙이지 않는다.
			if (!isDirectiveFunction(node) || node.async) return;

			// 메서드는 독립 함수와 키워드 위치가 달라 현재 복원 규칙을 적용할 수 없다.
			if (isMethodFunction(ancestors.at(-2), node)) return;

			// ESTree상 함수 선언/표현식은 블록 본문이지만, 외부 파서가 만든 확장 AST까지
			// 고려해 디렉티브 배열에 접근하기 전에 형태를 다시 확인한다.
			if (node.body.type !== 'BlockStatement') return;

			// `firstStatement`는 JavaScript 디렉티브로 인정될 수 있는 본문의 첫 문장이다.
			const firstStatement = node.body.body[0];
			if (isDirective(firstStatement, directives.noAsync)) {
				// escape된 동기 함수이므로 noAsync만 제거하고 async로 복원하지 않는다.
				// `directiveStatement`는 제거할 escape 디렉티브의 원문 위치 포함 문장이다.
				const directiveStatement = firstStatement as Positioned<ExpressionStatement>;
				editor.remove(directiveStatement.start, directiveStatement.end);
				changed = true;
				return;
			}

			// 첫 문장이 플러그인의 async 디렉티브가 아니면 일반 동기 함수다.
			if (!isDirective(firstStatement, directives.async)) return;

			// "use async"만 있는 함수는 cover에서 async를 제거한 함수다.
			// 함수 앞에 키워드를 되살리고 임시 디렉티브를 제거한다.
			// `functionNode`는 앞에 async 키워드를 다시 삽입할 함수의 원문 범위다.
			const functionNode = node as Positioned<SupportedFunction>;
			// `directiveStatement`는 키워드로 의미를 되돌린 뒤 삭제할 임시 문장이다.
			const directiveStatement = firstStatement as Positioned<ExpressionStatement>;
			editor.prependLeft(functionNode.start, 'async ');
			editor.remove(directiveStatement.start, directiveStatement.end);
			changed = true;
		}
	);

	return changed;
}

/**
 * 사용자 동기 함수가 원래 use-async 디렉티브로 시작하는 경우 escape한다.
 *
 * @param node 충돌 여부를 검사할 동기 함수 선언 또는 표현식
 * @param editor no-async 디렉티브 삽입을 기록할 편집기
 * @param directives 충돌 판별과 escape에 사용할 디렉티브 세트
 * @returns escape 디렉티브를 삽입했으면 true
 */
function coverExistingAsyncDirective(
	node: FunctionDeclaration | FunctionExpression,
	editor: MagicString,
	directives: AsyncDirectives
): boolean {
	// 이 함수는 선언/표현식을 받으므로 보통 블록이지만, 타입 확장이나 잘못된 AST에서
	// body 배열을 읽지 않도록 런타임 형태도 확인한다.
	if (node.body.type !== 'BlockStatement') return false;

	// 첫 문장이 정확히 "use async"인 경우에만 escape가 필요하다. 다른 문자열이나
	// 본문 중간의 문자열은 디렉티브 프로토콜과 충돌하지 않는다.
	if (!isDirective(node.body.body[0], directives.async)) return false;

	// `{"use async"; ...}`를 `{"no async"; "use async"; ...}`로 만든다.
	// uncover는 첫 디렉티브만 제거하므로 원래 use-async 문자열은 보존된다.
	// `body`는 여는 중괄호 직후에 escape를 삽입하기 위한 위치 포함 블록이다.
	const body = node.body as Positioned<typeof node.body>;
	editor.appendLeft(body.start + 1, `${JSON.stringify(directives.noAsync)};`);
	return true;
}

/**
 * 주어진 호출이 플러그인이 만든 async 화살표 함수 래퍼인지 판별한다.
 * 정확히 하나의 ArrowFunctionExpression 인자를 가진 고정 식별자 호출만 허용한다.
 *
 * @param node 래퍼 프로토콜과 대조할 호출 표현식
 * @param marker 일치해야 하는 고정 래퍼 식별자
 * @returns 검증된 호출과 화살표 인자, 일치하지 않으면 null
 */
function getAsyncArrowCall(
	node: CallExpression,
	marker: string
):
	| (Positioned<CallExpression> & {
			arrow: Positioned<ArrowFunctionExpression>;
	  } & CommentedNode)
	| null {
	// 이름만 같은 사용자 함수를 오인하지 않도록 호출 형태를 전부 확인한다.
	// 이 가드를 통과하면 callee는 지정한 Identifier이고, 유일한 인자를
	// ArrowFunctionExpression으로 안전하게 좁혀 `arrow`에 담을 수 있다.
	if (
		node.callee.type !== 'Identifier' ||
		node.callee.name !== marker ||
		node.arguments.length !== 1 ||
		node.arguments[0]?.type !== 'ArrowFunctionExpression'
	) {
		return null;
	}

	return Object.assign(node as Positioned<CallExpression> & CommentedNode, {
		arrow: node.arguments[0] as Positioned<ArrowFunctionExpression>,
	});
}

/**
 * 문장이 지정한 문자열 디렉티브인지 판별한다.
 *
 * @param statement 함수 본문의 첫 문장 또는 빈 본문의 undefined
 * @param directive 일치해야 하는 디렉티브 문자열
 * @returns 일치하면 expression이 Literal인 ExpressionStatement로 타입을 좁힌다
 */
function isDirective(
	statement: Node | undefined,
	directive: string
): statement is ExpressionStatement & { expression: Literal } {
	// optional chaining은 빈 함수 본문도 함께 거른다. 이후 두 가드는 표현식 문장이
	// 문자열 Literal이며 그 값까지 프로토콜과 일치하는지를 차례로 확인한다.
	return (
		statement?.type === 'ExpressionStatement' &&
		statement.expression.type === 'Literal' &&
		statement.expression.value === directive
	);
}

/**
 * 함수 시작부터 본문 시작 전까지의 원문에서 async 토큰 범위를 찾는다.
 * MagicString 수정은 AST의 원본 오프셋을 사용하므로 절대 위치로 환산해 반환한다.
 *
 * @param code AST 오프셋의 기준이 되는 전체 원문
 * @param node async 헤더를 가진 위치 포함 함수 노드
 * @returns async 토큰의 절대 원문 범위, 찾지 못하면 null
 */
function findAsyncToken(
	code: string,
	node: Positioned<SupportedFunction>
): {
	/** async 토큰이 시작하는 전체 코드 기준 오프셋이다. */
	start: number;
	/** async 토큰이 끝나는 전체 코드 기준 배타적 오프셋이다. */
	end: number;
} | null {
	// `bodyStart`는 함수 헤더가 끝나고 본문이 시작하는 절대 오프셋이다.
	const bodyStart = (node.body as Positioned).start;
	// `header`는 다른 함수 본문의 async와 혼동하지 않도록 제한한 검색 범위다.
	const header = code.slice(node.start, bodyStart);
	// `match`는 단어 경계를 포함해 찾은 async 토큰과 헤더 내부 상대 위치다.
	const match = /\basync\b/.exec(header);

	// 찾지 못한 경우 호출자가 원문을 수정하지 않도록 null로 실패를 명시한다.
	if (!match) return null;

	return {
		start: node.start + match.index,
		end: node.start + match.index + match[0].length,
	};
}

/**
 * 이 변환기가 처리하는 함수 노드인지 판별한다.
 *
 * @param node 전체 AST 순회에서 받은 임의의 ESTree 노드
 * @returns 지원되는 함수이면 SupportedFunction으로 타입을 좁힌다
 */
function isSupportedFunction(node: Node): node is SupportedFunction {
	// 세 ESTree 태그를 확인해 공통 필드인 async/body를 가진 SupportedFunction으로
	// 타입을 좁힌다. 메서드 여부는 부모 정보가 필요하므로 여기서는 판단하지 않는다.
	return (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	);
}

/**
 * 디렉티브 방식으로 cover할 수 있는 함수 노드인지 판별한다.
 *
 * @param node 전체 AST 순회에서 받은 임의의 ESTree 노드
 * @returns 블록 디렉티브 방식의 함수 선언·표현식이면 해당 합집합으로 좁힌다
 */
function isDirectiveFunction(
	node: Node
): node is FunctionDeclaration | FunctionExpression {
	// 화살표 함수는 표현식 본문일 수 있어 디렉티브 삽입이 불가능하므로 제외한다.
	// 통과한 두 타입은 BlockStatement 본문을 전제로 한 복원 경로에 들어갈 수 있다.
	return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression';
}

/**
 * 객체 축약 메서드와 클래스 메서드를 판별한다.
 * 이들은 독립 FunctionExpression처럼 async를 제거하면 유효한 문법이 되지 않아 제외한다.
 *
 * @param parent 현재 함수 바로 위의 AST 노드
 * @param node 부모의 value와 동일한지 확인할 현재 함수 노드
 * @returns 객체 축약 메서드 또는 클래스 메서드이면 true
 */
function isMethodFunction(parent: Node | undefined, node: SupportedFunction): boolean {
	// Property는 `{ async method() {} }`의 value가 현재 함수인 경우만 메서드다.
	// 일반 `{ key: function() {} }`는 method=false이므로 독립 함수처럼 처리한다.
	// MethodDefinition은 클래스 메서드이며 value 동일성으로 정확한 자식만 확인한다.
	return (
		(parent?.type === 'Property' && parent.method && parent.value === node) ||
		(parent?.type === 'MethodDefinition' && parent.value === node)
	);
}
