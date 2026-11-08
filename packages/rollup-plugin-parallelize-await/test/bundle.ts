import {
	rollup,
	type InputOptions,
	type OutputChunk,
	type OutputOptions,
	type Plugin,
} from 'rollup';
import parallelizeAwait, { type ParallelizeAwaitOptions } from '../src/main.js';

const ENTRY_ID = '\0parallelize-await-test-entry';

/** 단일 가상 모듈을 실제 Rollup 파이프라인으로 빌드한다. */
export async function bundle(
	source: string,
	options: ParallelizeAwaitOptions = {}
): Promise<string> {
	const chunks = await bundleModules(
		{ [ENTRY_ID]: source },
		{ input: ENTRY_ID, pluginOptions: options }
	);
	const chunk = chunks[0];
	if (!chunk) throw new Error('Rollup did not generate a chunk');
	return chunk.code;
}

/** 여러 가상 모듈을 사용하는 통합 테스트의 입력과 출력 설정이다. */
export interface BundleModulesOptions {
	input?: InputOptions['input'];
	pluginOptions?: ParallelizeAwaitOptions;
	treeshake?: InputOptions['treeshake'];
	external?: InputOptions['external'];
	format?: OutputOptions['format'];
	preserveModules?: boolean;
}

/** 여러 가상 모듈을 실제 Rollup 파이프라인으로 빌드해 모든 출력 청크를 반환한다. */
export async function bundleModules(
	modules: Readonly<Record<string, string>>,
	options: BundleModulesOptions = {}
): Promise<OutputChunk[]> {
	const fixture: Plugin = {
		name: 'parallelize-await-test-fixture',
		resolveId(id) {
			return Object.hasOwn(modules, id) ? id : null;
		},
		load(id) {
			return modules[id] ?? null;
		},
	};

	const build = await rollup({
		input: options.input ?? 'entry',
		treeshake: options.treeshake,
		external: options.external,
		plugins: [fixture, parallelizeAwait(options.pluginOptions)],
	});

	try {
		const generated = await build.generate({
			format: options.format ?? 'es',
			preserveModules: options.preserveModules,
		});
		return generated.output.filter(
			(output): output is OutputChunk => output.type === 'chunk'
		);
	} finally {
		await build.close();
	}
}
