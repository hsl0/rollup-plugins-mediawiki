export interface ImportStatement {
	mappings: Record<string, string>;
	source: string;
}

export interface GenerateDynamicImportAllConfig {
	topLevelAwait?: boolean;
	asyncFunctions?: boolean;
	indent?: string | boolean;
	arrowFunctions?: boolean;
	constBindings?: boolean;
	objectShorthand?: boolean;
}

type Declaration = { binding: string; value: string };

function indent(statements: string, config?: GenerateDynamicImportAllConfig): string {
	if (config?.indent === false) return statements;
	const prefix = typeof config?.indent === 'string' ? config.indent : '\t';
	return statements.replace(/^(?!$)/gm, prefix);
}

function bindings(
	mappings: Record<string, string>,
	config?: GenerateDynamicImportAllConfig
): string[] {
	const direct: string[] = [];
	const destructured: string[] = [];

	for (const [local, imported] of Object.entries(mappings)) {
		if (imported === '*') direct.push(local);
		else if ((config?.objectShorthand ?? true) && imported === local)
			destructured.push(imported);
		else destructured.push(`${imported}: ${local}`);
	}

	if (destructured.length > 0) direct.push(`{ ${destructured.join(', ')} }`);
	return direct;
}

function declaration(
	binding: string,
	value: string,
	config?: GenerateDynamicImportAllConfig
): string {
	return `${(config?.constBindings ?? true) ? 'const' : 'var'} ${binding} = ${value}`;
}

function dynamicImport(source: string): string {
	return `import(${JSON.stringify(source)})`;
}

function lambda(arguments_: string[], config?: GenerateDynamicImportAllConfig): string {
	const args = `(${arguments_.join(', ')})`;
	return (config?.arrowFunctions ?? true) ? `${args} => ` : `function ${args} `;
}

function awaitImport(
	source: string,
	mappings: Record<string, string>,
	config?: GenerateDynamicImportAllConfig
): string {
	const [direct, ...indirect] = bindings(mappings, config);
	const value = `await ${dynamicImport(source)}`;
	if (!direct) return `${value};\n`;
	return (
		[
			`${declaration(direct, value, config)};`,
			...indirect.map((binding) => `${declaration(binding, direct, config)};`),
		].join('\n') + '\n'
	);
}

function thenImport(
	source: string,
	mappings: Record<string, string>,
	config?: GenerateDynamicImportAllConfig
): [string, string] {
	const [argument = '', ...extra] = bindings(mappings, config);
	const intro =
		argument && extra.length > 0
			? indent(
					extra.map((binding) => `${declaration(binding, argument, config)};`).join('\n'),
					config
				) + '\n'
			: '';
	return [
		`${dynamicImport(source)}.then(${lambda([argument], config)}{\n${intro}`,
		'});',
	];
}

function wrapPromiseBindings(
	declarations: Declaration[],
	intro = '',
	config?: GenerateDynamicImportAllConfig
): [string, string] {
	if (declarations.length === 0) return ['', ''];
	const bindings_ = declarations.map(({ binding }) => binding);
	const promises = declarations.map(({ value }) => value);
	const binding = bindings_.length === 1 ? bindings_[0] : `[ ${bindings_.join(', ')} ]`;
	const promise =
		promises.length === 1 ? promises[0] : `Promise.all([ ${promises.join(', ')} ])`;

	if (config?.asyncFunctions ?? true) {
		const code = `${declaration(binding, `await ${promise}`, config)};`;
		if (config?.topLevelAwait ?? true) return [code + intro + '\n\n', ''];
		return [
			`(async ${lambda([], config)}{\n${indent(code + intro, config)}\n\n`,
			'})();\n',
		];
	}

	const body = intro ? indent(intro, config) + '\n\n' : '';
	return [`${promise}.then(${lambda([binding], config)}{\n${body}`, '});\n'];
}

function fromStaticImport(
	source: string,
	mappings: Record<string, string>,
	config?: GenerateDynamicImportAllConfig
): [string, string] {
	if (!(config?.asyncFunctions ?? true)) return thenImport(source, mappings, config);
	const code = awaitImport(source, mappings, config);
	if (config?.topLevelAwait ?? true) return [code + '\n', ''];
	return [`(async ${lambda([], config)}{\n${indent(code, config)}\n`, '})();\n'];
}

export function generateDynamicImportAll(
	importStatements: ImportStatement[],
	config?: GenerateDynamicImportAllConfig
): [string, string] {
	if (importStatements.length === 0) return ['', ''];
	if (importStatements.length === 1) {
		const { source, mappings } = importStatements[0];
		return fromStaticImport(source, mappings, config);
	}

	const declarations: Declaration[] = [];
	const intro: string[] = [];
	for (const { source, mappings } of importStatements) {
		const [direct, ...indirect] = bindings(mappings);
		if (!direct) continue;
		declarations.push({ binding: direct, value: dynamicImport(source) });
		intro.push(...indirect.map((binding) => `${declaration(binding, direct, config)};`));
	}
	return wrapPromiseBindings(declarations, intro.join('\n'), config);
}
