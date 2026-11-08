# rollup-plugin-mediawiki

A set of Rollup plugins that lets a Rollup bundle use MediaWiki ResourceLoader modules as external dependencies. It binds imported ResourceLoader modules with `require()` and wraps the whole chunk in `mw.loader.using()`.

## Requirements

This plugin requires Node.js v22+ and Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-mediawiki --save-dev
```

## Usage

Suppose you have a source file that imports the `mediawiki.api` module:

```js
// src/main.js
import api from 'mediawiki.api';
api.get();
```

Create a `rollup.config.js` file and import the plugin. It returns an **array** of plugins.

```js
import mediawiki from 'rollup-plugin-mediawiki';

export default {
	input: 'src/main.js',
	plugins: mediawiki({
		dependencies: ['mediawiki.api', 'mediawiki.util'],
		gadgetDependencies: ['Example'],
	}),
	output: { format: 'cjs', file: 'dist/main.js' },
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). The output looks like this:

```js
mw.loader.using(["mediawiki.api"]).then(function (require) {
'use strict';

var api = require("mediawiki.api");

api.get();
});
```

A dynamic `import('mediawiki.api')` is rewritten to:

```js
((module) => mw.loader.using(module).then((require) => require(module)))('mediawiki.api')
```

## Options

### `dependencies`

Type: `string[]`<br>
Default: `[]`

A list of ResourceLoader module IDs (such as `mediawiki.api`).

### `gadgetDependencies`

Type: `string[]`<br>
Default: `[]`

A list of gadget names. You can import a gadget as either `Example` or `ext.gadget.Example`; its module ID is `ext.gadget.Example`.

### `transformAllDynamicImports`

Type: `boolean`<br>
Default: `false`

If `true`, every dynamic `import()` that is not a relative path, an absolute path, or a URL is treated as a ResourceLoader module.

### `wrapLoaderUsing`

Type: `boolean`<br>
Default: `true`

Wraps the whole chunk in `mw.loader.using([...]).then(...)`. If `false`, the outer wrapper is omitted and only `require("mediawiki.api")` remains.

## Notes

- Importing the same module several times, or mixing default and named imports, still calls `require()` only once per module.
- Side-effect imports (`import 'mediawiki.test'`), namespace imports, and named re-exports are supported.
- Names that are not in the lists, and URLs (`https://...`), are left alone and handed to normal Rollup resolution.
- When `wrapLoaderUsing` is on, only the modules the chunk actually uses go into the `mw.loader.using` list.
- The `exports` output option is forced to `'none'`, because the whole chunk is wrapped in a function.

## Limitations

- The generated wrapper assumes `mw` is a global. The output does not run outside a MediaWiki page.
- Module IDs must be written in the options. They are not discovered by querying the wiki.
