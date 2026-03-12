import baseConfig from './rollup.config.js';

export default {
	...baseConfig,
	input: 'main.ts',
	output: {
		...baseConfig.output,
		file: 'main.js',
	},
};
