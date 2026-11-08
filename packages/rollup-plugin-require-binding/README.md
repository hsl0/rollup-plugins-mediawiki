# rollup-plugin-require-binding

Bind selected imports to `require()` independently of Rollup's output format.

## Requirements

This plugin requires Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-require-binding --save-dev
```

## Usage

Suppose you have a source file that imports a local module, an external module, and a module that should be loaded with `require()`:

```js
// src/main.js
import localValue from './local.js';
import external from 'external';
import required from 'require';

export const run = () => [localValue, external, required];
```

Create a `rollup.config.js` file and import the plugin:

```js
import requireBinding from 'rollup-plugin-require-binding';

export default {
	input: 'src/main.js',
	external: ['external'],
	plugins: [
		requireBinding({
			importer: {
				include: ['src/**'],
				exclude: ['src/vendor/**'],
			},
			target: {
				include: ['require', /^-cjs/],
			},
		}),
	],
	output: {
		format: 'es',
	},
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). The local module is bundled, the `external` module remains a normal ES external, and the selected target is loaded with `require()` while the bundle still uses ES exports:

```js
import external from 'external';

const localValue = 42;
const required = require('require');

const run = () => [localValue, external, required];
export { run };
```

## Options

An import is bound to `require()` when **both** filters match: the module that contains the import (`importer`) and the module it imports (`target`). Both options have the same shape:

```ts
interface RequireBindingFilter {
	include?: FilterPattern;
	exclude?: FilterPattern;
}
```

`FilterPattern` is the type used by [`createFilter` from `@rollup/pluginutils`](https://github.com/rollup/plugins/tree/master/packages/pluginutils#createfilter): a string, a `RegExp`, or an array of them. Strings are glob patterns.

- If `include` is omitted (or empty), everything matches.
- Otherwise a name must match at least one `include` pattern.
- A name that matches any `exclude` pattern never matches, even if it is included. Exclusions take precedence.

### `importer`

Type: `{ include?: FilterPattern, exclude?: FilterPattern }`<br>
Default: every importing module

Selects the modules whose imports are rewritten. The filter is applied to the importing module's resolved ID (its absolute file path), and relative glob patterns are resolved against the current working directory.

```js
requireBinding({
	importer: { include: 'src/**', exclude: 'src/vendor/**' },
});
```

With this config, imports in `src/main.js` are rewritten, while imports in `src/vendor/lib.js` are left to Rollup.

### `target`

Type: `{ include?: FilterPattern, exclude?: FilterPattern }`<br>
Default: every import

Selects which imported modules are bound with `require()`. Unlike `importer`, the filter is applied to the import specifier **exactly as written in the source** (for example `'require'`, `'./local.js'` or `'mediawiki.api'`), not to a resolved path. Do not use absolute path patterns here.

```js
requireBinding({
	target: { include: ['mediawiki.api', /^ext\./], exclude: 'ext.skipped' },
});
```

When `target` is omitted, **every** import of a matching importer is bound, including relative imports of local files. Restrict `target` when local imports should remain bundled.

### When the filters are created

Both filters are created when the build starts, after every plugin's `options` hook has run. An array passed as `include` or `exclude` can therefore still be filled in by another plugin's `options` hook before the build begins. [`rollup-plugin-mediawiki`](../rollup-plugin-mediawiki) uses this to supply its list of ResourceLoader modules.

## Notes

### Rollup's `external` option

Matched imports are always handled by this plugin, even if they are also listed in Rollup's `external` option (as a string, a regular expression, or a function). Listing them is unnecessary. Imports that do not match both filters follow `external` as usual.

### Supported static imports

Default, named, namespace, and side-effect imports are supported, as are explicit named re-exports and namespace re-exports (`export * as name from 'target'`). Importing the same target several times produces a single `require()` call. Bare `export * from 'target'` is rejected with an error, because Rollup cannot know a CommonJS module's runtime export names; use `export * as default from 'target'` instead.

### Dynamic imports

Matched dynamic imports are marked external and rendered normally by Rollup. For CJS output, this follows `dynamicImportInCjs`:

- `true` (the Rollup default): `import('target')`
- `false`: `Promise.resolve().then(() => require('target'))`

Computed imports such as `import(moduleName)` are selected only when `target` itself is omitted; otherwise they are left to Rollup because their target cannot be matched statically. Other output formats retain their normal Rollup dynamic-import behavior.
