# rollup-plugin-mediawiki-gadget2

A Rollup plugin that builds a MediaWiki gadget from a single JSON definition file. It emits the JS, CSS, and JSON pages listed in the definition under the file names you upload to the wiki, together with the gadget definition.

## Requirements

This plugin requires Node.js v22+ and Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-mediawiki-gadget2 --save-dev
```

## Usage

Create a gadget definition file. This file is Rollup's `input`.

```json
// src/gadget.json
{
	"name": "Example",
	"settings": {},
	"module": {
		"pages": {
			"js": "main.js",
			"css": "style.css",
			"data.json": "data.json"
		}
	}
}
```

`main.js`, `style.css`, and `data.json` are an ordinary JS, CSS, and JSON file respectively. Create a `rollup.config.js` file and import the plugin:

```js
import mwGadget from 'rollup-plugin-mediawiki-gadget2';

export default {
	input: 'src/gadget.json',
	plugins: [ mwGadget() ],
	output: { dir: 'dist' },
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). The following files are emitted:

```
Gadget-Example.js           # the bundled main.js
Gadget-Example.css          # style.css, unchanged
Gadget-Example-data.json    # data.json, unchanged
Gadgets/Example.json        # the gadget definition
```

Every file gets a `Gadget-` prefix, and the definition goes to `Gadgets/<name>.json`. The plugin fixes the output format to `cjs` and does not allow code splitting (an unexpected chunk is an error).

## Options

### `definitionFormat`

Type: `'json' | 'wikitext'`<br>
Default: `'json'`

If `'wikitext'`, a single line for `MediaWiki:Gadgets-definition` is emitted as a `Gadgets-definition` file instead of `Gadgets/<name>.json`. `module.messages` is not supported in this format, so it is dropped with a warning.

### `transformDynamicImport`

Type: `boolean`<br>
Default: `false`

Treats every dynamic `import()` as a ResourceLoader module.

### `inputCSS`

Type: `boolean | InputAnythingConfig`<br>
Default: `true`

Emits `.css` pages as assets. An object is used as a [`rollup-plugin-input-anything`](../rollup-plugin-input-anything) config.

### `inputJSON`

Type: `boolean | InputAnythingConfig`<br>
Default: `true`

Emits `.json` pages as assets.

### `inputAnythingOptions`

Type: `InputAnythingConfig | InputAnythingConfig[]`

Additional `input-anything` configs to apply.

## Definition file

It is almost identical to the [JSON format of MediaWiki:Gadgets subpages](https://www.mediawiki.org/wiki/Extension:Gadgets#Using_a_subpage_of_MediaWiki:Gadgets). The mapping of `module.pages` differs slightly.

- `name` (required): the gadget ID.
- `module.pages` (required): output name → source file. A key without `.` becomes `<name>.<key>`; a key with `.` becomes `<name>-<key>` (`js` → `Example.js`, `data.json` → `Example-data.json`).
- `settings` (optional): if omitted, every setting is off. You can use `rights`, `default`, `package`, `hidden`, `skins`, `actions`, `namespaces`, `categories`, `contentModels`, `section`, `supportsUrlLoad`, and so on.
- `module.dependencies` / `module.gadgetDependencies`: passed to [`rollup-plugin-mediawiki`](../rollup-plugin-mediawiki).
- If `settings.package` is `true`, a `<name>.js` page is required and is sorted to the first page of the definition.

## Notes

- `input` must be a single definition file (a string). Objects and arrays cannot be used.
- Declare every CSS file in the definition's `pages`. Importing CSS from JS (`import './x.css'`) is not supported.
- A JS page is required. CSS and JSON pages are removed from Rollup's inputs, so with no JS input Rollup fails with a missing-input error. A gadget with only CSS can be built with [`vite-plugin-mediawiki-gadget`](../vite-plugin-mediawiki-gadget).
- The definition file is watched, and changing it triggers a rebuild.

## License

[MIT](../../LICENSE)
