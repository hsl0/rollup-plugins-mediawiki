# vite-plugin-mediawiki-gadget

A Vite plugin for using [`rollup-plugin-mediawiki-gadget2`](../rollup-plugin-mediawiki-gadget2) with Vite. It corrects the output file names to fit Vite's CSS handling.

## Requirements

This plugin requires Node.js v22+ and Vite v6.2+.

## Install

```console
npm install vite-plugin-mediawiki-gadget --save-dev
```

## Usage

Create a gadget definition file (see [Definition file](#definition-file) below).

```json
// src/gadget.json
{
	"name": "Example",
	"settings": {},
	"module": { "pages": { "js": "main.js", "css": "style.css" } }
}
```

Create a `vite.config.js` file and import the plugin. Set the definition file as the library entry:

```js
import { defineConfig } from 'vite';
import mwGadget from 'vite-plugin-mediawiki-gadget';

export default defineConfig({
	plugins: [mwGadget()],
	build: {
		lib: { entry: 'src/gadget.json', formats: ['es'] },
	},
});
```

Running `vite build` emits these files:

```
Gadget-Example.js
Gadget-Example.css
Gadgets/Example.json
```

If a CSS page is empty, only the CSS file is emitted, with no JS.

## Options

### `definitionFormat`

Type: `'json' | 'wikitext'`<br>
Default: `'json'`

If `'wikitext'`, a single line for `MediaWiki:Gadgets-definition` is emitted as a `Gadgets-definition` file instead of `Gadgets/<name>.json`. `module.messages` is not supported in this format, so it is dropped with a warning.

### `transformDynamicImport`

Type: `boolean`<br>
Default: `false`

Treats every dynamic `import()` as a ResourceLoader module.

### `inputJSON`

Type: `boolean | InputAnythingConfig`<br>
Default: `true`

Emits `.json` pages as assets. An object is used as a [`rollup-plugin-input-anything`](../rollup-plugin-input-anything) config.

### `inputAnythingOptions`

Type: `InputAnythingConfig | InputAnythingConfig[]`

Additional `input-anything` configs to apply.

Do not use `inputCSS`. CSS is always handled by Vite.

## Definition file

It is almost identical to the [JSON format of MediaWiki:Gadgets subpages](https://www.mediawiki.org/wiki/Extension:Gadgets#Using_a_subpage_of_MediaWiki:Gadgets). The mapping of `module.pages` differs slightly.

- `name` (required): the gadget ID.
- `module.pages` (required): output name → source file. A key without `.` becomes `<name>.<key>`; a key with `.` becomes `<name>-<key>` (`js` → `Example.js`, `data.json` → `Example-data.json`).
- `settings` (optional): if omitted, every setting is off. You can use `rights`, `default`, `package`, `hidden`, `skins`, `actions`, `namespaces`, `categories`, `contentModels`, `section`, `supportsUrlLoad`, and so on.
- `module.dependencies` / `module.gadgetDependencies`: the ResourceLoader modules and gadgets your code imports. Imports of them are bound with `require()` instead of being bundled.
- If `settings.package` is `true`, a `<name>.js` page is required and is sorted to the first page of the definition.

## Vite config defaults

Only when you have not set them, the plugin fills in `build.cssCodeSplit: true` and `build.minify: false`.

## Notes

- If there are two or more CSS pages, do not set `build.cssCodeSplit` to `false`; use the default `true` (or set it to `true`). With `false`, the CSS is merged into one file and cannot be split per page.
- Do not let a CSS page produce JS or be referenced from another chunk. Do not import CSS from JS; declare every CSS file in the definition's `pages`.
- JSON pages are removed from the build inputs, and Rollup and Vite cannot build with no input at all. A gadget whose pages are empty or only JSON cannot be built, so you need at least one JS or CSS page.
