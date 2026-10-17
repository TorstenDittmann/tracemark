import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: { index: 'src/index.ts', flags: 'src/flags-entry.ts', errors: 'src/errors-entry.ts' },
		format: 'esm',
		platform: 'browser',
		target: 'es2020',
		dts: true,
		minify: true,
		clean: true,
		// The shared stack parser is bundled in, so the published package has no dependencies.
		noExternal: ['@tracemark/errors']
	},
	{
		entry: { tracemark: 'src/iife.ts' },
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		globalName: 'tracemark',
		dts: false,
		minify: true,
		clean: false,
		outputOptions: { exports: 'default' }
	},
	{
		// Script-tag build of the flags plugin: `window.tracemarkFlags.createFlags`.
		entry: { 'tracemark-flags': 'src/flags-entry.ts' },
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		globalName: 'tracemarkFlags',
		dts: false,
		minify: true,
		clean: false
	},
	{
		// Script-tag build of the errors plugin: `window.tracemarkErrors.createErrors`.
		entry: { 'tracemark-errors': 'src/errors-entry.ts' },
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		globalName: 'tracemarkErrors',
		dts: false,
		minify: true,
		clean: false,
		noExternal: ['@tracemark/errors']
	}
]);
