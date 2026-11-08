# rollup-plugin-mediawiki-article

> **Work in progress**: the design is not final. This describes what the code does today.

A Rollup plugin that decides whether an `import` specifier is a wiki page title, a URL, or a ResourceLoader module, and hands it to the matching resolver.

## Requirements

This plugin requires Node.js v22+ and Rollup v4.34.9+.

## Install

```console
npm install rollup-plugin-mediawiki-article --save-dev
```

## Usage

Suppose you have a source file that imports several kinds of specifiers:

```js
// src/main.js
import 'http://example.org/A.js'; // URL
import 'User:A'; // wiki page
import 'mediawiki.api'; // ResourceLoader module
```

Create a `rollup.config.js` file and import the plugin. `wiki` and `loader` are functions with the same signature as Rollup's `resolveId`.

```js
import mwArticle from 'rollup-plugin-mediawiki-article';

export default {
	input: 'src/main.js',
	plugins: [
		mwArticle({
			wiki: (name, importer, options) => resolveWikiPage(name), // your implementation
			loader: (name, importer, options) => resolveLoaderModule(name), // your implementation
			fallbackResolution: 'wiki',
		}),
	],
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/command-line-interface/) or the [API](https://www.rollupjs.org/javascript-api/). The specifiers are handled like this:

```js
import 'http://example.org/A.js'; // a URL, so it is returned as is (protocols are case-insensitive)
import 'data:text/javascript,'; // same as above
import 'blob:https://example.org/id'; // same as above

import 'User:A'; // wiki namespace → passed to the wiki resolver
import 'MediaWiki:Gadget-a.js'; // same as above
import 'User_talk:A'; // normalized to the `User talk` namespace, then passed to the wiki resolver
import 'mediawiki.api'; // no prefix → passed to the loader resolver

// with forbiddenPrefix: ['User']
import 'USER:A'; // error (TypeError, the message contains `forbidden`)
```

## Options

### `wiki`

Type: `ResolveIdHook`<br>
Default: `() => null`

The resolver for wiki page titles. If it is not set, it always returns `null`, so nothing happens (and no warning is printed).

### `loader`

Type: `ResolveIdHook`<br>
Default: `() => null`

The resolver for ResourceLoader modules.

### `wikiNamespaces`

Type: `string[]`<br>
Default: the default MediaWiki namespaces

Prefixes treated as wiki pages.

### `urlProtocols`

Type: `string[]`<br>
Default: `data`, `blob`, `http`, and so on

Prefixes treated as URLs. If a prefix is also in `wikiNamespaces`, creating the plugin throws an error.

### `forbiddenPrefix`

Type: `string[]`<br>
Default: `[]`

Prefixes that cause an error when used.

### `fallbackResolution`

Type: `'wiki' | 'url' | 'loader' | 'never'`<br>
Default: `'wiki'`

How to handle unknown prefixes. `'never'` throws an error.

### `relative`

Type: `false | 'wiki'`

If `'wiki'`, specifiers starting with `./` or `../` are passed to the wiki resolver.

## Resolution order

1. Names containing `\0`, Windows paths such as `C:\`, and results already resolved by `node-resolve` are left alone.
2. A specifier starting with `/` is treated as a URL and left as is.
3. If `relative: 'wiki'` and the specifier starts with `./` or `../`, it is passed to the wiki resolver.
4. A specifier of the form `prefix:name` is classified as in the examples above, after lowercasing the prefix and replacing `_` with a space. Unknown prefixes follow `fallbackResolution`.
5. Anything else is passed to the loader resolver.

## Relative paths (`rel2abs`)

`src/rel2abs.ts` and `src/relative.ts` contain code that computes `./` and `../` relative to a page title. It is not connected to the main plugin yet. Even with `relative: 'wiki'`, relative paths are not converted; they are passed to the wiki resolver **as they are**.

## Known issues

- There is no feature that fetches namespaces automatically through the wiki API.
