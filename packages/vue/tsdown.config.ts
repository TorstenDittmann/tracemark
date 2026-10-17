import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { index: 'src/index.ts' },
	format: 'esm',
	platform: 'browser',
	target: 'es2020',
	dts: true,
	clean: true,
	external: [/^vue/, /^@tracemark\/browser/]
});
