import type { Node as AcornNode } from 'acorn';
import * as acornWalk from 'acorn-walk';
import type {
	ArrowFunctionExpression,
	BlockStatement,
	CallExpression,
	Expression,
	Identifier,
	Node,
	Program,
	Statement,
	VariableDeclaration,
} from 'estree';
import MagicString from 'magic-string';

/** await 마커가 보존하는 병렬화 안전성의 출처를 나타내는 문자열 합집합이다. */
export type AwaitMarkerKind = 'await' | 'pure' | 'concurrent';

/** 각 안전성 종류를 고정 호출 식별자에 대응시키는 읽기 전용 매핑 타입이다. */
export type AwaitMarkers = Readonly<Record<AwaitMarkerKind, string>>;

/** ESTree 노드 T에 MagicString 편집과 원문 추출에 필요한 오프셋을 더한 타입이다. */
type Positioned<T extends Node = Node> = T & {
	/** 노드가 시작하는 0 기반 문자 오프셋이다. */
	start: number;
	/** 노드가 끝나는 배타적 문자 오프셋이다. */
	end: number;
};

/** 마커 호출 노드에 판별된 종류와 실제 await 피연산자를 결합한 내부 표현이다. */
export type AwaitMarkerCall = Positioned<CallExpression> & {
	/** 호출 식별자가 보존한 병렬화 안전성 종류다. */
	kind: AwaitMarkerKind;
	/** 마커 호출의 첫 번째 인자이자 원래 await의 피연산자다. */
	argument: Positioned<Expression>;
	/** 일반 await의 자동 순수성 판정에 사용한 분석용 함수다. */
	purityProbe?: Positioned<ArrowFunctionExpression> & {
		body: Positioned<BlockStatement>;
	};
};

/** 원문의 반열린 문자 오프셋 구간이다 (`[start, end)`). */
type Range = readonly [start: number, end: number];

/**
 * `parallelizeAwaits`가 덮어쓴 원문 구간과, 그 구간에 흡수되어 개별 await
 * 복원 대상에서 제외할 마커 호출 집합이다.
 */
export interface ParallelizedEdits {
	/** Promise.all 골격에 흡수되어 개별 복원 대상에서 제외할 마커 호출 집합이다. */
	calls: Set<CallExpression>;
	/** 그룹 렌더링이 이미 덮어쓴 골격 구간이다. 이후 단계는 이 안을 편집하면 안 된다. */
	ranges: readonly Range[];
}

/**
 * 주어진 구간이 이미 덮어쓴 골격 구간과 겹치는지 검사한다.
 *
 * @param ranges parallelizeAwaits가 반환한 골격 구간 목록
 * @param start 검사할 구간의 시작 오프셋
 * @param end 검사할 구간의 끝 오프셋 (배타적)
 * @returns 하나라도 겹치면 true
 */
export function overlapsParallelizedRange(
	ranges: readonly Range[],
	start: number,
	end: number
): boolean {
	return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && rangeStart < end);
}

/** Promise.all 그룹에 들어갈 수 있는 문장 단위 await 후보다. */
interface AwaitCandidate {
	/** 후보의 병렬화 안전성 종류다. 일반 await은 그룹 경계로 사용된다. */
	kind: AwaitMarkerKind;
	/** 후보 문장 안에서 검증된 원래 마커 호출 노드다. */
	call: AwaitMarkerCall;
	/** Promise.all 배열에 넣을 원래 await 피연산자다. */
	argument: Positioned<Expression>;
	/** 그룹 렌더링 시 통째로 교체할 최상위 문장이다. */
	statement: Positioned<Statement>;
	/** 변수 선언 후보가 결과를 저장하는 단순 식별자 이름이다. */
	binding?: string;
	/** 여러 선언을 하나로 합칠 때 유지해야 하는 const/let/var 종류다. */
	declarationKind?: VariableDeclaration['kind'];
}

/**
 * 각 Program/BlockStatement에서 독립적인 연속 await 마커를 병렬화한다.
 *
 * @param ast 청크 코드를 파싱한 ESTree Program
 * @param editor 골격 구간 치환을 기록할 MagicString 편집기
 * @param markers 호출 식별자를 안전성 종류로 해석할 고정 매핑
 * @returns Promise.all로 교체된 원래 CallExpression 집합과 덮어쓴 골격 구간 목록.
 * uncover 단계가 이 호출들을 다시 개별 await으로 복원하지 않고, 골격 구간 안의
 * 래퍼 주석을 다시 편집하지 않도록 사용하는 정보다.
 */
export function parallelizeAwaits(
	ast: Program,
	editor: MagicString,
	markers: AwaitMarkers
): ParallelizedEdits {
	// `parallelizedCalls`는 골격 overwrite에 포함되어 개별 복원에서 제외할 호출 집합이다.
	const parallelizedCalls = new Set<CallExpression>();
	// `parallelizedRanges`는 골격 overwrite가 이미 소비한 원문 구간이다.
	const parallelizedRanges: Range[] = [];

	acornWalk.fullAncestor(ast as unknown as AcornNode, (acornNode) => {
		// `node`는 실행 문장 배열을 가진 블록인지 검사할 현재 ESTree 노드다.
		const node = acornNode as unknown as Node;

		// 실행 순서를 직접 담는 최상위 Program과 중첩 BlockStatement만 처리한다.
		// 이 가드를 통과하면 공통 `body` 문장 배열을 블록 단위로 읽을 수 있다.
		if (node.type !== 'Program' && node.type !== 'BlockStatement') return;

		// 각 블록은 별도의 실행 순서를 가지므로 블록 경계를 넘어 그룹화하지 않는다.
		// `group`은 같은 블록에서 의존성 없이 연속된 둘 이상의 await 후보다.
		for (const group of createConcurrentGroups(node.body, markers)) {
			// `first`는 overwrite할 연속 문장 범위의 시작 후보다.
			const first = group[0]!;
			// `last`는 overwrite할 연속 문장 범위의 끝 후보다.
			const last = group.at(-1)!;

			// 중첩 그룹(인자 안에 자신만의 마커 문장을 가진 블록)이 먼저 처리되어
			// 이미 이 범위를 덮어썼다면 다시 덮어쓰지 않는다. 정상 경로에서는 골격
			// 구간과 인자 구간이 서로소라 겹치지 않지만, 순회 순서가 뒤바뀌는 경우를
			// 방어한다.
			if (
				overlapsParallelizedRange(
					parallelizedRanges,
					first.statement.start,
					last.statement.end
				)
			) {
				continue;
			}

			// `skeletonRanges`는 이 그룹에서 실제로 덮어쓴 골격 구간만 담는다.
			// 인자 표현식 범위(그 안의 중첩 마커를 포함해)는 덮지 않으므로 여기에
			// 포함하지 않는다 — 포함하면 이후 uncover가 인자 안의 래퍼 주석을
			// 정당하게 제거하지 못한다.
			const skeletonRanges = renderConcurrentGroup(group, editor);
			parallelizedRanges.push(...skeletonRanges);

			// 이 호출들은 골격 overwrite에 포함됐다. 이후 uncover가 같은 AST
			// 노드를 개별 await으로 다시 복원하지 않도록 객체 식별자를 보존한다.
			// `candidate`의 호출 객체는 이후 AST 순회에서 동일성으로 제외할 수 있게 보존한다.
			for (const candidate of group) parallelizedCalls.add(candidate.call);
		}
	});

	return { calls: parallelizedCalls, ranges: parallelizedRanges };
}

/**
 * 노드가 지정된 마커 호출인지 검사한다. 명시적 마커는 단일 인자, 일반 마커는
 * Rollup 자동 분석을 위한 두 번째 화살표 함수 인자를 선택적으로 허용한다.
 *
 * @param node 호출 프로토콜과 대조할 임의의 ESTree 노드
 * @param markers 허용할 식별자와 안전성 종류의 매핑
 * @returns 검증된 마커 호출, 형태나 이름이 다르면 null
 */
export function getAwaitMarkerCall(
	node: Node,
	markers: AwaitMarkers
): AwaitMarkerCall | null {
	// 마커는 `identifier(expression[, probe])`이라는 정확한 형태여야 한다.
	if (
		node.type !== 'CallExpression' ||
		node.callee.type !== 'Identifier' ||
		(node.arguments.length !== 1 && node.arguments.length !== 2) ||
		node.arguments[0]?.type === 'SpreadElement'
	) {
		return null;
	}

	// `kind`는 검증된 callee 이름에 대응하는 병렬화 안전성 종류다.
	const kind = getAwaitMarkerKind(node.callee.name, markers);

	// 호출 구조가 같아도 식별자가 세 고정 마커 중 하나가 아니면 사용자 호출이다.
	if (!kind) return null;

	// 두 번째 인자는 일반 await 마커에만 허용되는 분석 함수다. Rollup 출력에서
	// 매개변수가 없고 동기이며 블록 본문인 정확한 프로토콜 형태만 인정한다.
	const probeArgument = node.arguments[1];
	if (probeArgument !== undefined) {
		if (
			kind !== 'await' ||
			probeArgument.type !== 'ArrowFunctionExpression' ||
			probeArgument.async ||
			probeArgument.generator ||
			probeArgument.params.length !== 0 ||
			probeArgument.body.type !== 'BlockStatement'
		) {
			return null;
		}

		const purityProbe = probeArgument as Positioned<ArrowFunctionExpression> & {
			body: Positioned<BlockStatement>;
		};
		const analyzedKind: AwaitMarkerKind =
			purityProbe.body.body.length === 0 ? 'pure' : 'await';
		return Object.assign(node as Positioned<CallExpression>, {
			// Rollup이 검사 호출을 모두 제거해 본문이 비었을 때만 pure 후보로 승격한다.
			kind: analyzedKind,
			argument: node.arguments[0] as Positioned<Expression>,
			purityProbe,
		});
	}

	return Object.assign(node as Positioned<CallExpression>, {
		kind,
		argument: node.arguments[0] as Positioned<Expression>,
	});
}

/**
 * 하나의 문장 목록을 순서대로 읽어 Promise.all 후보 그룹을 만든다.
 * 그룹 크기가 1이면 병렬화 이점이 없으므로 결과에서 제외한다.
 *
 * @param body 하나의 Program 또는 BlockStatement에 직접 속한 문장 목록
 * @param markers 후보 호출을 판별할 고정 식별자 매핑
 * @returns 서로 독립적인 둘 이상의 연속 후보로 구성된 그룹 목록
 */
function createConcurrentGroups(
	body: readonly Node[],
	markers: AwaitMarkers
): AwaitCandidate[][] {
	// `groups`는 flush가 확정한 병렬화 가능 그룹의 최종 목록이다.
	const groups: AwaitCandidate[][] = [];
	// `current`는 현재 문장 위치까지 이어지고 있는 미확정 후보 그룹이다.
	let current: AwaitCandidate[] = [];
	// `currentBindings`는 뒤 후보의 데이터 의존성을 검사할 앞선 선언 이름 집합이다.
	let currentBindings = new Set<string>();
	// `declarationKind`는 한 구조 분해 선언으로 합칠 후보들의 공통 선언 종류다.
	let declarationKind: VariableDeclaration['kind'] | undefined;

	// `flush`는 현재 그룹을 조건부 확정한 뒤 다음 그룹을 위한 상태를 초기화한다.
	const flush = () => {
		// 하나뿐인 호출은 Promise.all로 바꿀 이점이 없으므로 결과에 넣지 않는다.
		if (current.length >= 2) groups.push(current);
		current = [];
		currentBindings = new Set();
		declarationKind = undefined;
	};

	// `statement`는 원래 실행 순서를 유지한 채 차례로 판별할 현재 문장이다.
	for (const statement of body) {
		// `candidate`는 지원되는 직접 마커 문장일 때만 정규화된 후보 정보를 가진다.
		const candidate = getAwaitCandidate(statement, markers);

		// 일반 await 또는 지원하지 않는 문장은 앞뒤 호출의 동시 시작을 막는 경계다.
		if (!candidate || candidate.kind === 'await') {
			flush();
			continue;
		}

		// `readsPreviousBinding`은 현재 인자가 앞 후보의 결과를 필요로 하는지 나타낸다.
		const readsPreviousBinding = expressionReadsAny(candidate.argument, currentBindings);
		// `hasIncompatibleDeclaration`은 하나의 선언문으로 합칠 수 없는 종류 충돌 여부다.
		const hasIncompatibleDeclaration =
			candidate.declarationKind !== undefined &&
			declarationKind !== undefined &&
			candidate.declarationKind !== declarationKind;

		// `const a = ...; const b = load(a);`는 데이터 의존성 때문에 분리한다.
		// const/let처럼 선언 종류가 다르면 하나의 구조 분해 선언으로 합칠 수 없다.
		if (readsPreviousBinding || hasIncompatibleDeclaration) flush();

		current.push(candidate);
		if (candidate.binding) currentBindings.add(candidate.binding);
		declarationKind ??= candidate.declarationKind;
	}

	flush();
	return groups;
}

/**
 * 현재 렌더러가 안전하게 재작성할 수 있는 두 문장 형태만 후보로 추출한다.
 *
 * @param statement 현재 블록에서 후보 여부를 검사할 문장 노드
 * @param markers 직접 호출을 판별할 고정 식별자 매핑
 * @returns 정규화된 변수 선언/표현식 후보, 지원하지 않으면 null
 */
function getAwaitCandidate(
	statement: Node,
	markers: AwaitMarkers
): AwaitCandidate | null {
	// `const value = marker(expression)` 형태만 구조 분해 선언으로 재작성할 수 있다.
	// 구조 분해 및 다중 선언은 현재 렌더러가 원형을 보존할 규칙이 없어 제외한다.
	if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
		// `declaration`은 단일 선언만 허용한 타입 가드 뒤의 유일한 declarator다.
		const declaration = statement.declarations[0]!;

		// 단순 Identifier만 Promise.all 구조 분해 결과에 다시 바인딩할 수 있다.
		// 초기값이 없는 선언은 애초에 await 마커 호출을 포함하지 않는다.
		if (declaration.id.type !== 'Identifier' || !declaration.init) return null;

		// `call`은 선언 초기값 전체가 고정 마커 호출일 때의 검증된 호출 정보다.
		const call = getAwaitMarkerCall(declaration.init, markers);

		// 초기값 전체가 직접 마커 호출인 경우만 문장 전체를 안전하게 치환한다.
		if (!call) return null;

		return {
			kind: call.kind,
			call,
			argument: call.argument,
			statement: statement as Positioned<typeof statement>,
			binding: declaration.id.name,
			declarationKind: statement.kind,
		};
	}

	// 결과를 바인딩하지 않는 `marker(expression);`도 Promise.all 입력이 될 수 있다.
	if (statement.type === 'ExpressionStatement') {
		// `call`은 결과를 버리는 표현식 문장 전체가 직접 마커 호출일 때만 존재한다.
		const call = getAwaitMarkerCall(statement.expression, markers);

		// 임의의 표현식 문장은 그룹 경계이며, 직접 마커를 호출하는 문장만 후보다.
		if (!call) return null;

		return {
			kind: call.kind,
			call,
			argument: call.argument,
			statement: statement as Positioned<typeof statement>,
		};
	}

	return null;
}

/**
 * 호출 식별자와 일치하는 await 마커 종류를 찾는다.
 *
 * @param identifier 호출 callee의 식별자 이름
 * @param markers 안전성 종류별 고정 식별자 매핑
 * @returns 일치한 안전성 종류, 플러그인 마커가 아니면 null
 */
function getAwaitMarkerKind(
	identifier: string,
	markers: AwaitMarkers
): AwaitMarkerKind | null {
	switch (identifier) {
		case markers.await:
			return 'await';
		case markers.pure:
			return 'pure';
		case markers.concurrent:
			return 'concurrent';
		default:
			return null;
	}
}

/**
 * 현재 표현식이 같은 그룹의 앞선 후보가 선언한 이름을 읽는지 검사한다.
 *
 * @param expression 새 후보의 원래 await 피연산자
 * @param bindings 같은 그룹의 앞선 후보들이 선언한 이름 집합
 * @returns 표현식이 그중 하나를 런타임 값으로 참조하면 true
 */
function expressionReadsAny(expression: Node, bindings: Set<string>): boolean {
	// 앞선 선언이 없으면 어떤 Identifier를 만나도 그룹 내부 의존성일 수 없다.
	if (bindings.size === 0) return false;

	// `found`는 순회 중 의존 식별자를 한 번이라도 발견했는지를 기억한다.
	let found = false;
	acornWalk.fullAncestor(
		expression as unknown as AcornNode,
		(acornNode, _state, acornAncestors) => {
			// `node`는 Identifier인지 검사할 현재 표현식 하위 노드다.
			const node = acornNode as unknown as Node;
			// `ancestors`는 Identifier의 문법적 역할을 판별할 부모 경로다.
			const ancestors = acornAncestors as unknown as Node[];

			// 의존성을 하나 찾은 뒤에는 추가 판별이 필요 없다. 그 전에는 실제 이름을
			// 가질 수 있는 Identifier 노드만 아래 참조 위치 검사로 보낸다.
			if (found || node.type !== 'Identifier') return;

			// 속성 키나 레이블은 같은 철자여도 변수 값을 읽는 것이 아니다.
			if (!isIdentifierReference(node, ancestors.at(-2))) return;
			if (bindings.has(node.name)) found = true;
		}
	);
	return found;
}

/**
 * Identifier가 런타임 값을 읽는 위치인지 보수적으로 판별한다.
 * `object.key`의 key, 객체 리터럴의 비계산 key, 메서드 이름, 레이블은
 * 같은 철자를 가져도 변수 값을 읽지 않으므로 의존성에서 제외한다.
 *
 * @param identifier 참조 위치인지 검사할 Identifier 노드
 * @param parent Identifier의 문법적 역할을 결정하는 바로 위 노드
 * @returns 런타임 변수 값을 읽는 위치이거나 판단할 부모가 없으면 true
 */
function isIdentifierReference(identifier: Identifier, parent?: Node): boolean {
	// 부모 정보가 없으면 참조가 아니라고 단정할 수 없으므로 병렬화를 막는 쪽으로
	// 보수적으로 true를 반환한다.
	if (!parent) return true;

	// 아래 위치들은 Identifier 철자를 사용하지만 변수 값을 평가하지 않는다.
	// 어느 예외에도 해당하지 않을 때만 런타임 값 참조로 취급한다.
	return !(
		(parent.type === 'MemberExpression' &&
			parent.property === identifier &&
			!parent.computed) ||
		(parent.type === 'Property' &&
			parent.key === identifier &&
			!parent.computed &&
			parent.value !== identifier) ||
		(parent.type === 'MethodDefinition' &&
			parent.key === identifier &&
			!parent.computed) ||
		(parent.type === 'LabeledStatement' && parent.label === identifier) ||
		(parent.type === 'BreakStatement' && parent.label === identifier) ||
		(parent.type === 'ContinueStatement' && parent.label === identifier)
	);
}

/**
 * 후보 인자 사이의 골격만 덮어써 Promise.all 문장을 만든다. 인자 표현식 범위
 * 자체는 건드리지 않으므로 그 안에 남은 마커(중첩 await/async)는 이후 uncover
 * 단계가 계속 편집할 수 있다.
 *
 * @param group 둘 이상의 독립적인 연속 await 후보
 * @param editor 골격 구간을 덮어쓸 MagicString 편집기
 * @returns 실제로 덮어쓴 골격 구간 목록. 인자 표현식 범위는 포함하지 않는다.
 */
function renderConcurrentGroup(group: AwaitCandidate[], editor: MagicString): Range[] {
	// `ranges`는 이 함수가 실제로 덮어쓴 골격 구간만 모은다.
	const ranges: Range[] = [];

	// `assigned`는 Promise.all 결과 중 변수에 다시 연결해야 하는 후보 목록이다.
	const assigned = group.filter((candidate) => candidate.binding);

	// 모든 결과를 버리는 호출 그룹은 별도의 바인딩을 만들 필요가 없다.
	const prefix =
		assigned.length === 0
			? 'await Promise.all(['
			: // `declarationKind`는 그룹 검사에서 동일함이 보장된 선언 종류이며 기본값은 const다.
				// 결과를 버리는 항목은 빈 배열 요소로 두어 나머지 바인딩의 인덱스를 유지한다.
				// `bindings`는 Promise.all 결과 배열의 위치와 맞춘 구조 분해 패턴 문자열이다.
				`${assigned[0]!.declarationKind ?? 'const'} [${group.map((candidate) => candidate.binding ?? '').join(', ')}] = await Promise.all([`;

	// `first`/`last`는 골격 구간의 바깥 경계가 되는 첫/끝 후보다.
	const first = group[0]!;
	const last = group.at(-1)!;

	// 문장 시작부터 첫 인자 시작까지가 접두사로 바뀐다.
	// (`const a = /*@__PURE__*/marker(` 형태의 원문을 흡수한다.)
	if (first.statement.start < first.argument.start) {
		editor.overwrite(first.statement.start, first.argument.start, prefix);
		ranges.push([first.statement.start, first.argument.start]);
	}

	// 인접한 두 후보의 인자 사이가 구분자로 바뀐다.
	// (`); const b = /*@__PURE__*/marker(` 형태의 원문을 흡수한다.)
	for (let index = 0; index < group.length - 1; index += 1) {
		const current = group[index]!;
		const next = group[index + 1]!;
		if (current.argument.end < next.argument.start) {
			editor.overwrite(current.argument.end, next.argument.start, ', ');
			ranges.push([current.argument.end, next.argument.start]);
		}
	}

	// 마지막 인자 끝부터 문장 끝까지가 접미사로 바뀐다.
	// (`, () => { });` 형태의 원문을 흡수한다.)
	if (last.argument.end < last.statement.end) {
		editor.overwrite(last.argument.end, last.statement.end, ']);');
		ranges.push([last.argument.end, last.statement.end]);
	}

	return ranges;
}
