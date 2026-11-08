# rollup-plugin-wrap-dynamic-import

A Rollup plugin that wraps the dynamic `import()` in the output with `new Function`, so that bundlers and post-processing tools cannot touch the `import()`.

## Requirements

This plugin requires Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-wrap-dynamic-import --save-dev
```

## Usage

Suppose you have a source file that uses a dynamic `import()`:

```js
// src/main.js
export const load = (name) => import(name);
```

Create a `rollup.config.js` file and import the plugin:

```js
import wrapDynamicImport from 'rollup-plugin-wrap-dynamic-import';

export default {
	input: 'src/main.js',
	plugins: [wrapDynamicImport()],
	output: { format: 'es', file: 'dist/main.js' },
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). The output looks like this:

```js
const load = (name) => new Function('module', 'return import(module)')(name);

export { load };
```

## Notes

- Because it uses `new Function`, it does not work in environments where the `Content-Security-Policy` forbids `unsafe-eval`.

## License

[MIT](../../LICENSE)
