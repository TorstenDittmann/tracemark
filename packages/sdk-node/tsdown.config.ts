import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { index: 'src/index.ts' },
	format: 'esm',
	platform: 'neutral',
	target: 'es2022',
	dts: true,
	clean: true,
	// The flag evaluator and stack parser are bundled in, so the published package has no dependencies.
	noExternal: ['@footprint/flags', '@footprint/errors']
});
