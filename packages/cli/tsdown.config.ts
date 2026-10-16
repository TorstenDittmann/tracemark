import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { index: 'src/index.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node20',
	dts: false,
	outExtensions: () => ({ js: '.js' }),
	clean: true
});
