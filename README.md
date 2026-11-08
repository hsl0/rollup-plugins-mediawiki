# rollup-plugins-mediawiki

A monorepo of Rollup and Vite plugins for building MediaWiki gadgets and user scripts. Each plugin is a separate npm package under `packages/`, with its own README.

## Packages

### General-purpose plugins

These plugins know nothing about MediaWiki and can be used in any Rollup project.

| Package | Purpose |
| --- | --- |
| [`rollup-plugin-require-binding`](packages/rollup-plugin-require-binding) | Bind selected imports to `require()` independently of the output format. |
| [`rollup-plugin-parallelize-await`](packages/rollup-plugin-parallelize-await) | Group consecutive independent `await` expressions into `Promise.all`. |
| [`rollup-plugin-import-to-dynamic-import`](packages/rollup-plugin-import-to-dynamic-import) | Turn static imports of external modules into top-level `await import()`. |
| [`rollup-plugin-input-anything`](packages/rollup-plugin-input-anything) | Use non-JS files (CSS, JSON, ...) as Rollup inputs and emit them as assets. |
| [`rollup-plugin-wrap-dynamic-import`](packages/rollup-plugin-wrap-dynamic-import) | Wrap dynamic `import()` in `new Function`. |

### MediaWiki plugins

These plugins are built for MediaWiki gadgets and user scripts.

| Package | Purpose |
| --- | --- |
| [`rollup-plugin-mediawiki`](packages/rollup-plugin-mediawiki) | Use MediaWiki ResourceLoader modules as external dependencies. |
| [`rollup-plugin-mediawiki-resolve`](packages/rollup-plugin-mediawiki-resolve) | Resolve ResourceLoader modules to `load.php` URLs. |
| [`rollup-plugin-mediawiki-article`](packages/rollup-plugin-mediawiki-article) | Route import specifiers to wiki page and ResourceLoader resolvers (work in progress). |
| [`rollup-plugin-mediawiki-gadget2`](packages/rollup-plugin-mediawiki-gadget2) | Build a gadget from a single JSON definition (Rollup). |
| [`vite-plugin-mediawiki-gadget`](packages/vite-plugin-mediawiki-gadget) | The gadget build for Vite. |

### Dependencies between packages

The MediaWiki plugins build on the general-purpose ones; the general-purpose plugins never depend on the MediaWiki plugins.

- `rollup-plugin-import-to-dynamic-import` uses `rollup-plugin-parallelize-await`.
- `rollup-plugin-mediawiki` uses `rollup-plugin-require-binding`.
- `rollup-plugin-mediawiki-gadget2` uses `rollup-plugin-input-anything` and `rollup-plugin-mediawiki`.
- `vite-plugin-mediawiki-gadget` uses `rollup-plugin-mediawiki-gadget2`.

## Requirements

- Node.js 22 or later (some packages use newer built-ins such as `Set.prototype.intersection`).
- npm with workspaces support.

## Getting started

```console
npm install --save-dev
npm run build
npm test
```

## Repository layout

```
package.json          the workspace list, shared scripts and repository-wide tooling
tsconfig.json         shared compiler options; used by the editor and `tsc --noEmit`
vitest.config.ts      test runner configuration for all packages
.prettierrc           formatting rules
packages/<name>/
	src/main.ts       the entry point (other sources are next to it)
	test/             the tests
	tsconfig.json     builds `src/` into `dist/`
	package.json      `main` and `types` point into `dist/`
	dist/             build output (ignored by Git)
```

## Build

Every package is compiled with `tsc`; there is no bundling step. A package's `build` script (`tsc -p .`) writes JavaScript, declaration files and source maps to its `dist/` folder.

Build all packages:

```console
npm run build
```

Build a single package:

```console
npm run build -w rollup-plugin-mediawiki
```

Packages import each other by name, and a name resolves to the dependency's `dist/` (its `main` and `types` fields). A package can therefore only be built or tested after the packages it depends on have been built. `npm run build` handles this because the `workspaces` list in the root `package.json` is ordered by dependency and npm runs the `build` script in that order. When you build a single package, build its dependencies first.

## Test

Tests run with [Vitest](https://vitest.dev/) from the repository root. They live in each package's `test/` folder, in files named `*.test.ts` (or `test.ts`).

Run all tests:

```console
npm test
```

Run the tests of one package:

```console
npx vitest run packages/rollup-plugin-mediawiki
```

Coverage (V8) is collected for `packages/*/src/**/*.ts` by default. Turn it off with `--coverage.enabled=false`.

Because packages resolve each other through `dist/`, **build before you test**, and rebuild a package after you change it if another package's tests use it. If a test fails with a "cannot find module" error for one of these packages, the dependency has not been built yet.

## Formatting

The code is formatted with [Prettier](https://prettier.io/): tabs, single quotes, 90 columns, ES5 trailing commas and LF line endings (see `.prettierrc`).

```console
npm run format         # rewrite files
npm run format:check   # report files that need formatting
```

Relative imports use the `.js` extension (for example `import x from './x.js'`), as in compiled ES modules.

If you check the repository out on Windows with `core.autocrlf=true`, the files in your working copy have CRLF line endings and `format:check` reports them. The committed files are LF; to check only the formatting, run `npx prettier --check --end-of-line auto "**/*.{ts,js,mjs}"`.

## Dependencies

Declare a dependency in the package that uses it.

- **Root `devDependencies`** hold only repository-wide tooling: Prettier, Vitest with its coverage and UI plugins, TypeScript and `@types/node`.
- **Each package** declares what its own source and tests import: `typescript` (its build script runs `tsc`), `vitest`, `rollup` (also a `peerDependency`), `@types/node` when it uses Node built-ins, and any package-specific tools. Runtime needs go in `dependencies` or `peerDependencies`; only these are installed by users.

## Adding a package

1. Create `packages/<name>/` with a `package.json` (`"main": "dist/main.js"`, `"types": "dist/main.d.ts"`, `"files": ["dist"]`, `"scripts": { "build": "tsc -p ." }`), a `tsconfig.json` like the other packages (extends `../../tsconfig.json`, `noEmit: false`, `outDir: "dist"`, `rootDir: "src"`, `paths: {}`, includes `src/**/*.ts`), `src/main.ts`, a `test/` folder and a `README.md`.
2. Add the folder to `workspaces` in the root `package.json`, **after the packages it depends on**.
3. Add its name to `paths` in the root `tsconfig.json` (so the editor resolves the package to its source), then run `npm install`.
