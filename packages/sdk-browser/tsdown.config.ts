import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: { index: 'src/index.ts', flags: 'src/flags-entry.ts' },
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
	},
	{
		// Script-tag build of the flags plugin: `window.footprintFlags.createFlags`.
		entry: { 'footprint-flags': 'src/flags-entry.ts' },
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		globalName: 'footprintFlags',
		dts: false,
		minify: true,
		clean: false
	}
]);
