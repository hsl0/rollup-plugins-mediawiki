# rollup-plugin-input-anything

A Rollup plugin that lets you put non-JS files (CSS, JSON, and so on) directly into Rollup's `input`. Matching inputs are not parsed as JS modules; their contents are read and emitted as assets.

## Requirements

This plugin requires Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-input-anything --save-dev
```

## Usage

Suppose you have these two files:

```js
// src/main.js
console.log('main');
```

```css
/* src/style.css */
.a { color: red; }
```

Create a `rollup.config.js` file and import the plugin:

```js
import inputAnything from 'rollup-plugin-input-anything';

export default {
	input: { main: 'src/main.js', 'style.css': 'src/style.css' },
	plugins: [inputAnything({ extensions: '.css' })],
	output: { dir: 'dist' },
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/).

`src/main.js` becomes a single JS chunk as usual. `src/style.css` does not become a JS chunk; it is emitted unchanged (`.a { color: red; }`) as one asset named `style.css`. The asset's file name follows Rollup's `assetFileNames` option.

## Options

`inputAnything(...configs)` takes any number of config objects. For each input, a config is selected if any of the conditions below match.

### `pattern`

Type: `RegExp`

A regular expression tested against the input path.

### `extensions`

Type: `string | string[]`

Extensions the input path ends with.

### `transformer`

Type: `(code: string) => string | Promise<string>`, or an array of them

A function that changes the contents of the asset. If an array is given, the functions are applied in order, and synchronous and asynchronous functions can be mixed.

```js
inputAnything({
	extensions: '.css',
	transformer: [(code) => code.replace('red', 'blue'), async (code) => `/* min */ ${code}`],
});
```

With this config, `.a { color: red; }` becomes `/* min */ .a { color: blue; }`.

## Notes

- If several configs are given, **only the first matching one** is used. A warning is printed when more than one matches (`only the first one is used`).
- If every input matches, no JS input is left. Rollup needs at least one input, so another plugin has to supply one.

## License

[MIT](../../LICENSE)
