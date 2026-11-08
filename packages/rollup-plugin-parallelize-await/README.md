# rollup-plugin-parallelize-await

A Rollup plugin that groups consecutive, independent `await` expressions into `Promise.all` so they run in parallel. Only the `await` expressions that remain after Rollup has finished tree shaking are parallelized.

## Requirements

This plugin requires Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-parallelize-await --save-dev
```

## Usage

A function marked `/*@__NO_SIDE_EFFECTS__*/`, or a call marked `/*@__PURE__*/`, is considered pure.

```js
// src/main.js
/*@__NO_SIDE_EFFECTS__*/
async function fetchData1() {
	return Promise.resolve('Data 1');
}

/*@__NO_SIDE_EFFECTS__*/
async function fetchData2() {
	return Promise.resolve('Data 2');
}

export async function getMyData() {
	const data1 = await fetchData1();
	const data2 = await fetchData2();
	const data3 = await /*@__PURE__*/ Promise.resolve('Data 3');
	console.log('Fetching complete');
	return { data1, data2, data3 };
}
```

Create a `rollup.config.js` file and import the plugin:

```js
import parallelizeAwait from 'rollup-plugin-parallelize-await';

export default {
	input: 'src/main.js',
	plugins: [parallelizeAwait()],
	output: { format: 'es', file: 'dist/main.js' },
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). `getMyData` becomes:

```js
async function getMyData() {
	const [data1, data2, data3] = await Promise.all([
		fetchData1(),
		fetchData2(),
		Promise.resolve('Data 3'),
	]);
	console.log('Fetching complete');
	return { data1, data2, data3 };
}
```

When an `await` depends on the result of an earlier one, it is not parallelized and runs sequentially as written:

```js
async function processData() {
	const id = await fetchId();
	const data = await fetchDataById(id); // depends on `id`
	return data;
}
```

## Options

### `pureFunctions`

Type: `string[]`<br>
Default: `[]`

Extra function paths to register in Rollup's `treeshake.manualPureFunctions`.

```js
parallelizeAwait({ pureFunctions: ['fetchConfig'] });
```

If `treeshake` is `false`, the plugin does nothing.

## Comment markers

| Marker | Position | Meaning |
| --- | --- | --- |
| `/*@__NO_SIDE_EFFECTS__*/` | before a function declaration | Calls to that function are considered pure. |
| `/*@__PURE__*/` | before the call being awaited | That call is considered pure. |
| `/*@__CONCURRENT__*/` | before the `await` or before its operand | Forces the `await` to run in parallel regardless of order. |

Both the `@` and `#` prefixes are recognized. If `PURE` and `CONCURRENT` are both present, `PURE` wins; if neither is present, the `await` is treated as a normal one and follows the analysis result. After processing, the marker is removed from the comment, and any description written alongside it is kept.

## Limitations

- Calls whose purity cannot be determined stay sequential. Tell the plugin about calls that are safe to run in parallel with `pureFunctions` or a comment.
