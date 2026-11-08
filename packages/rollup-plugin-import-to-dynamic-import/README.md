# rollup-plugin-import-to-dynamic-import

A Rollup plugin that turns static `import` / `export ... from` of external modules (modules that are not included in the bundle) into top-level `await import()`. Its purpose is to load static imports asynchronously at runtime, so the target modules must be treated as `external`.

## Requirements

This plugin requires Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-import-to-dynamic-import --save-dev
```

The plugin also registers [`rollup-plugin-parallelize-await`](../rollup-plugin-parallelize-await), so several imports are loaded in parallel.

## Usage

Suppose you have a source file that imports an external module:

```js
// src/main.js
import foo, { bar } from 'myModule.js';
console.log(foo, bar);
```

Create a `rollup.config.js` file and import the plugin:

```js
import importToDynamicImport from 'rollup-plugin-import-to-dynamic-import';

export default {
	input: 'src/main.js',
	external: ['myModule.js'],
	plugins: importToDynamicImport(),
	output: { format: 'es', exports: 'none', file: 'dist/main.js' },
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). The output looks like this:

```js
const myModule_js = await import('myModule.js');

console.log(myModule_js.default, myModule_js.bar);
```

A side-effect import is rewritten like this:

```js
// input
import 'myModule.js';
console.log('Hello, World!');

// output
await import('myModule.js');

console.log('Hello, World!');
```

Imports from several different modules are combined and run in parallel:

```js
// input
import { foo } from 'myModule.js';
import { foo as bar } from 'otherModule.js';

console.log(foo, bar);

// output
const [myModule_js, otherModule_js] = await Promise.all([import('myModule.js'), import('otherModule.js')]);

console.log(myModule_js.foo, otherModule_js.foo);
```

## Options

### `parallelize`

Type: `boolean`<br>
Default: `true`

If `false`, `rollup-plugin-parallelize-await` is not registered. The imports then stay as sequential `await import()` calls, and the `/*@__CONCURRENT__*/` comments may remain in the output.

### `include`, `exclude`

Type: `string | RegExp | (string | RegExp)[]`<br>
Default: `undefined`

Which imports to transform. These are filter patterns like [`createFilter` from `@rollup/pluginutils`](https://github.com/rollup/plugins/tree/master/packages/pluginutils#createfilter), applied to the **import specifier**, not to the module ID.

```js
importToDynamicImport({ include: ['esm-only-package'] });
```

## Notes

- The plugin generates top-level `await`, so the output environment must support it.
- A warning is printed when the `exports` output option is not `'none'`.

## License

[MIT](../../LICENSE)
