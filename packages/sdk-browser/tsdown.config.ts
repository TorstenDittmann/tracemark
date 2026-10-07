import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: { index: 'src/index.ts' },
		format: 'esm',
		platform: 'browser',
		target: 'es2020',
		dts: true,
		minify: true,
		clean: true
	},
	{
		entry: { footprint: 'src/iife.ts' },
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		globalName: 'footprint',
		dts: false,
		minify: true,
		clean: false,
		outputOptions: { exports: 'default' }
	}
]);
