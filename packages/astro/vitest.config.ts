import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@tracemark\/node$/, replacement: source('sdk-node/src/index.ts') },
			{
				find: /^@tracemark\/browser\/errors$/,
				replacement: source('sdk-browser/src/errors-entry.ts')
			},
			{ find: /^@tracemark\/browser$/, replacement: source('sdk-browser/src/index.ts') }
		]
	},
	test: {
		include: ['test/**/*.test.ts'],
		restoreMocks: true
	}
});
