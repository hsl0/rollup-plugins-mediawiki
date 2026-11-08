import MagicString from 'magic-string';
import type { Comment } from 'estree';

/**
 * Acorn이 수집하고 `estree-util-attach-comments`가 노드에 연결한 주석이다.
 *
 * `leading`과 `trailing`은 주석이 연결된 노드를 기준으로 한 방향이며,
 * Babel식 `leadingComments`/`trailingComments` 배열과는 다른 모델이다.
 */
export type PositionedComment = Comment & {
	/** 원문에서 주석이 시작하는 0 기반 문자 오프셋이다. */
	start: number;
	/** 원문에서 주석이 끝나는 배타적 문자 오프셋이다. */
	end: number;
	/** 주석이 연결된 노드보다 앞에 위치하는지를 나타낸다. */
	leading: boolean;
	/** 주석이 연결된 노드보다 뒤에 위치하는지를 나타낸다. */
	trailing: boolean;
};

/** `estree-util-attach-comments`가 확장한 ESTree 노드의 주석 부분이다. */
export interface CommentedNode {
	/** attachComments가 이 노드에 연결한 주석 목록이다. */
	comments?: PositionedComment[];
}

/**
 * 변환 대상과 그 피연산자에 연결된 주석을 한 목록으로 수집한다.
 *
 * @param nodes 주석을 확인할 인접 AST 노드들
 * @returns 동일 객체가 중복되지 않은 주석 목록
 */
export function getNearbyComments(...nodes: CommentedNode[]): PositionedComment[] {
	// `/* marker */ await foo()`는 AwaitExpression에 연결되지만
	// `await /* marker */ foo()`는 피연산자 CallExpression에 연결된다.
	// 호출자가 두 노드를 넘기면 두 위치의 표기법을 모두 수집할 수 있다.
	// `comments`는 모든 입력 노드의 선택적 주석 배열을 하나로 펼친 중간 목록이다.
	const comments = nodes.flatMap((node) => node.comments ?? []);

	// 같은 주석을 공유하는 노드를 함께 넘기는 경우를 대비해 중복을 제거한다.
	return Array.from(new Set(comments));
}

/**
 * 주석 전체가 아니라 지정한 의미 마커만 제거한다.
 *
 * @param editor 원본 위치를 기준으로 수정할 MagicString
 * @param comments 마커를 제거할 주석들
 * @param marker 주석 값 안에서 제거할 정규식
 */
export function removeCommentMarker(
	editor: MagicString,
	comments: PositionedComment[],
	marker: RegExp
): void {
	// `comment`는 이번 호출에서 의미 마커를 제거할 개별 원본 주석이다.
	for (const comment of comments) {
		// `content`는 마커만 제거하고 설명·공백 등 사용자가 쓴 나머지를 보존한 값이다.
		const content = comment.value.replace(marker, '');

		// `/* @__PURE__ 설명 */`처럼 설명이 남으면 원래 주석 형식을 보존한다.
		if (content.trim()) {
			// `left`와 `right`는 원래 Line/Block 주석 종류에 대응하는 구분자다.
			const [left, right] = comment.type === 'Line' ? ['//', ''] : ['/*', '*/'];
			editor.overwrite(comment.start, comment.end, `${left}${content}${right}`);
		} else {
			// `/* @__PURE__ */`처럼 마커만 있으면 빈 주석을 남기지 않는다.
			editor.remove(comment.start, comment.end);
		}
	}
}
