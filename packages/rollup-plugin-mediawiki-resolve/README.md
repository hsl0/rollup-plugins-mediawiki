# rollup-plugin-mediawiki-resolve

A Rollup plugin that resolves ResourceLoader modules to `load.php` URLs, so that the scripts served by the wiki can be included in your bundle. Unlike [`rollup-plugin-mediawiki`](../rollup-plugin-mediawiki), which loads modules at runtime, this plugin turns module IDs into URLs.

## Requirements

This plugin requires Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-mediawiki-resolve --save-dev
```

## Usage

Suppose you have a source file that uses a value from the `mediawiki.test` module:

```js
// src/main.js
import { value } from 'mediawiki.test';
globalThis.result = value;
```

Create a `rollup.config.js` file and import the plugin:

```js
import mwResolve from 'rollup-plugin-mediawiki-resolve';

export default {
	input: 'src/main.js',
	plugins: [
		mwResolve({
			loadURL: 'https://example.org/w/load.php',
			dependencies: ['mediawiki.test'],
		}),
	],
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/).

Gadget dependencies are given as `gadgetDependencies: ['Example']`. Importing either `Example` or `ext.gadget.Example` resolves to the same module.

## Options

### `loadURL`

Type: `string`<br>
Required

The address of the wiki's `load.php` (for example `https://example.org/w/load.php`).

### `dependencies`

Type: `string[]`<br>
Required

A list of ResourceLoader module IDs to resolve.

### `gadgetDependencies`

Type: `string[]`

A list of gadget names. They resolve to `ext.gadget.<name>` modules.

### `bundleStartup`

Type: `boolean`

If `true`, the `startup` module is imported before every module.

## Limitations

- This plugin only resolves to URLs. Actually fetching the content from a URL needs another plugin that loads URLs, such as [@rollup/plugin-url](https://www.npmjs.com/package/@rollup/plugin-url).
- Names that are not in the lists are left alone.

## License

[MIT](../../LICENSE)
