import { namespaces as defaultNamespaces } from './defaultMappings.js';

export default function rel2abs(
	title: string,
	location?: string,
	namespaces = defaultNamespaces
) {
	const relative = /^\.\.?(\/|$)/.test(title) || title.startsWith('/');
	if (relative && !location)
		throw new TypeError('Cannot resolve relative path: no location provided');

	const base = relative ? location! : title;
	const colon = base.indexOf(':');
	const hasNamespace =
		colon >= 0 &&
		namespaces.some(
			(namespace) =>
				namespace.toLowerCase().replaceAll('_', ' ') ===
				base.slice(0, colon).toLowerCase().replaceAll('_', ' ')
		);
	const namespace = hasNamespace ? base.slice(0, colon + 1) : '';
	const page = base.slice(namespace.length);
	const parts: string[] = [];
	for (const part of [...page.split('/'), ...(relative ? title.split('/') : [])]) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (!parts.length)
				throw new TypeError(
					`Cannot resolve relative path beyond namespace root: ${title}`
				);
			parts.pop();
		} else parts.push(part);
	}
	if (!parts.length)
		throw new TypeError('Cannot resolve wiki title: no page name provided');
	return namespace + parts.join('/');
}
