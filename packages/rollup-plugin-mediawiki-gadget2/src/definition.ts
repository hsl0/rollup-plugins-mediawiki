import { readFile } from 'node:fs/promises';

export interface GadgetBuildOptions {
	name: string;
	input: Record<string, string>;
	dependencies: string[];
	gadgetDependencies: string[];
	definition: GadgetDefinition;
}

/**
 * Gadget definition schema
 */
export interface GadgetDefinition {
	settings?: {
		/**
		 * The rights required to be able to enable/load this gadget
		 */
		rights?: string[];
		/**
		 * Whether this gadget is enabled by default
		 */
		default?: boolean;
		/**
		 * Whether this is gadget a packaged ResourceLoader module
		 */
		package?: boolean;
		/**
		 * Whether this gadget is hidden from preferences
		 */
		hidden?: boolean;
		/**
		 * Skins supported by this gadget; empty if all skins are supported
		 */
		skins?: string[];
		/**
		 * Page actions on which to load the gadget
		 */
		actions?: string[];
		/**
		 * Page namespaces in which to load the gadget
		 */
		namespaces?: number[];
		/**
		 * Categories in which to load the gadget
		 */
		categories?: string[];
		/**
		 * Content models on which the gadget is supported
		 */
		contentModels?: string[];
		/**
		 * Key of the section (group) this gadget belongs to
		 */
		section?: string;
		/**
		 * Whether this gadget supports ?withgadget query parameter
		 */
		supportsUrlLoad?: boolean;
		/**
		 * Whether this gadget requires ES6
		 */
		requiresES6?: boolean;
	};
	module?: {
		/**
		 * List of JS/CSS/JSON pages included in this gadget
		 */
		pages?: string[];
		/**
		 * ResourceLoader modules this gadget depends upon
		 */
		dependencies?: string[];
		/**
		 * Messages this gadget depends upon
		 */
		messages?: string[];
		/**
		 * Codex icons included in the gadget module
		 */
		codexIcons?: string[];

		// Not exist on schema
		type?: string;
		peers?: string[];
	};
}

export interface InputGadgetDefinition {
	name: string;
	settings?: GadgetDefinition['settings'];
	module: Omit<NonNullable<GadgetDefinition['module']>, 'pages'> & {
		pages: Record<string, string>;
		gadgetDependencies?: string[];
	};
}

function isRecord<K extends string | number | symbol, V>(
	value: unknown
): value is Record<K, V> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateGadgetDefinition(
	value: InputGadgetDefinition | unknown
): asserts value is InputGadgetDefinition {
	if (!isRecord(value)) throw new TypeError('Gadget definition must be a JSON object');
	if (typeof value.name !== 'string' || !value.name)
		throw new TypeError('name must be a non-empty gadget ID');
	if (!isRecord(value.module)) throw new TypeError('module must be an object');
	// `settings` is optional; every setting defaults to off.
	if (value.settings !== undefined && !isRecord(value.settings))
		throw new TypeError('settings must be an object');
	if (!isRecord(value.module.pages))
		throw new TypeError(
			'module.pages must be an object mapping output names to source files'
		);
	if (value.settings?.package && !value.module.pages.js)
		throw new TypeError(
			`Package gadget "${value.name}" must define the "${`${value.name}.js`}" page`
		);
}

export function parseGadgetDefinition(value: InputGadgetDefinition): GadgetBuildOptions;
export function parseGadgetDefinition(
	value: Record<string, unknown>
): GadgetBuildOptions | never;
export function parseGadgetDefinition(
	value: InputGadgetDefinition | unknown
): GadgetBuildOptions {
	validateGadgetDefinition(value);

	const {
		name,
		settings = {},
		module: { dependencies = [], gadgetDependencies = [], ...module },
	} = value;
	const normalizedInput: Record<string, string> = Object.fromEntries(
		Object.entries(value.module.pages).map(([key, source]) => {
			if (typeof source !== 'string' || !source)
				throw new TypeError('module.pages values must be non-empty source file names');
			const outputName = key.includes('.')
				? `${value.name}-${key}`
				: `${value.name}.${key}`;
			return [outputName, source];
		})
	);
	const normalizedDependencies = [
		...new Set([
			...dependencies,
			...gadgetDependencies.map((dependency) => `ext.gadget.${dependency}`),
		]),
	];
	const pages = Object.keys(normalizedInput);
	if (settings?.package) {
		const packageEntry = `${name}.js`;
		const index = pages.indexOf(packageEntry);
		if (index < 0)
			throw new TypeError(
				`Package gadget "${name}" must define the "${packageEntry}" page`
			);
		pages.splice(index, 1);
		pages.unshift(packageEntry);
	}

	return {
		name,
		input: normalizedInput,
		dependencies: normalizedDependencies,
		gadgetDependencies,
		definition: {
			settings,
			module: {
				...module,
				pages,
				dependencies: normalizedDependencies,
			},
		},
	};
}

function option(name: string, values?: (string | number)[]) {
	return values?.length ? `${name} = ${values.join(', ')}` : undefined;
}

export function formatGadgetsDefinition({ name, definition }: GadgetBuildOptions) {
	if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name))
		throw new TypeError(
			`Gadget name ${JSON.stringify(name)} is invalid for MediaWiki:Gadgets-definition`
		);

	const { settings, module } = definition;
	const options = [
		'ResourceLoader',
		settings?.default && 'default',
		settings?.hidden && 'hidden',
		settings?.package && 'package',
		option('rights', settings?.rights),
		option('skins', settings?.skins),
		option('actions', settings?.actions),
		option('namespaces', settings?.namespaces),
		option('categories', settings?.categories),
		option('contentModels', settings?.contentModels),
		option('dependencies', module?.dependencies),
		module?.type && `type = ${module.type}`,
		option('peers', module?.peers),
		option('codexIcons', module?.codexIcons),
		settings?.supportsUrlLoad === true && 'supportsUrlLoad',
		settings?.supportsUrlLoad === false && 'supportsUrlLoad = false',
	].filter((value): value is string => Boolean(value));
	const pages = module?.pages?.map((page) => ` | ${page}`).join('');
	const section = settings?.section ? `== ${settings.section} ==\n` : '';
	return `${section}* ${name} [ ${options.join(' | ')} ]${pages}\n`;
}

export async function readGadgetDefinition(
	fileName: string
): Promise<GadgetBuildOptions> {
	return parseGadgetDefinition(JSON.parse(await readFile(fileName, 'utf8')));
}
