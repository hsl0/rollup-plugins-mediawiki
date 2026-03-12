import type { OutputOptions, AddonFunction } from 'rollup';

export function toArray<T>(arr?: T[] | T): T[] {
	return Array.isArray(arr) ? arr : arr ? [arr] : [];
}

export function extendIntroOutro(...args: OutputOptions['footer'][]): AddonFunction {
	return async (chunk) =>
		(
			await Promise.all(
				args.map((x) => (typeof x === 'function' ? x(chunk) : x))
			)
		)
			.filter((x) => x)
			.join('\n');
}

interface WikiURLInfo {
	https?: boolean;
	domain?: string;
	port?: string;
	origin?: string;

	originRelative?: boolean;

	scriptPath?: string;
	loadPath?: string;

	loadURL?: string;
}

export function absoluteWikiURL(info: WikiURLInfo) {
	const protocol = `${(info?.https ?? true) ? 'https' : 'http'}://`;
	const port = info?.port ? `:${info.port}` : '';
	const origin =
		info?.origin ?? (info?.domain && `${protocol}${info.domain}${port}`) ?? '';

	const scriptPath = info?.scriptPath ?? '/w';
	const loadPath = info?.loadPath ?? `${scriptPath}/load.php`;

	const loadURL = info?.loadURL ?? (info?.originRelative ? origin : '') + loadPath;
}
