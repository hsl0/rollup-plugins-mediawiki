export function generateModuleMappings(mappings: Record<string, string>): string {
	return `{ ${Object.entries(mappings)
		.map(([local, imported]) =>
			imported === local ? imported : `${imported} as ${local}`
		)
		.join(', ')} }`;
}

export function generateExportFrom(
	module: string,
	mappings: Record<string, string>
): string {
	return `export ${generateModuleMappings(mappings)} from ${JSON.stringify(module)}`;
}

export function generateVirtualModule(
	namespaceIdentifier: string,
	actualId: string,
	syntheticExportName: string
): string {
	return (
		`const ${namespaceIdentifier} = /*@__CONCURRENT__*/await import(${JSON.stringify(actualId)});` +
		`export ${generateModuleMappings({ [syntheticExportName]: namespaceIdentifier })};`
	);
}
