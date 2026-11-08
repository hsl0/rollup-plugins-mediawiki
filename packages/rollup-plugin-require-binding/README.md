# rollup-plugin-require-binding

Bind selected imports to `require()` independently of Rollup's output format.

## Install

```console
npm install rollup-plugin-require-binding --save-dev
```

```js
import requireBinding from 'rollup-plugin-require-binding';

export default {
  input: 'src/main.js',
  external: ['external'],
  plugins: [
    requireBinding({
      importer: {
        include: ['src/**'],
        exclude: ['src/vendor/**']
      },
      target: {
        include: ['require', /^-cjs/]
      }
    })
  ],
  output: {
    format: 'es'
  }
};
```

Given:

```js
import localValue from './local.js';
import external from 'external';
import required from 'require';

export const run = () => [localValue, external, required];
```

the local module is bundled, `external` module remains a normal ES external, and the selected target is loaded with `require()` while the bundle still uses ES exports:

```js
import external from 'external';

const localValue = 42;
const required = require('require');

const run = () => [localValue, external, required];
export { run };
```

## Filters

`importer` selects the importing module and `target` selects its dependency.
Both accept `include` and `exclude` patterns from `@rollup/pluginutils`, and both match every non-virtual module when omitted. Exclusions take precedence.

Because matched targets are handled by this plugin, do not also list them in Rollup's `external` option. Restrict `target` when local imports should remain bundled.

## Dynamic imports

Matched dynamic imports are marked external and rendered normally by Rollup.
For CJS output, this follows `dynamicImportInCjs`:

- `true` (the Rollup default): `import('target')`
- `false`: `Promise.resolve().then(() => require('target'))`

Computed imports such as `import(moduleName)` are selected only when `target` itself is omitted; otherwise they are left to Rollup because their target cannot be matched statically. Other output formats retain their normal Rollup dynamic-import behavior. Static default, named, namespace, side-effect, explicit named re-exports, and namespace re-exports are supported. Bare `export * from 'target'` is rejected because Rollup cannot know a CommonJS module's runtime export names.
