import { defineConfig } from 'vitest/config';
import {} from 'vitest/';

export default defineConfig({
	test: {
		include: [
			'**/{test,spec}/**/.?(m|c)[jt]s?(x)',
			'**/*.{test,spec}.?(m|c)[jt]s?(x)',
			'**/{test,spec}.?(m|c)[jt]s?(x)',
		],
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/cypress/**',
			'**/.{idea,git,cache,output,temp}/**',
			'**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
		],
		reporters: 'verbose',
		snapshotSerializers: [],
		coverage: {
			enabled: true,
			include: ['packages/*/src/**/*.ts'],
		},
	},
});
