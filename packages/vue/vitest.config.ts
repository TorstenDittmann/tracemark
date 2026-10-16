import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const browser = (path: string) =>
	fileURLToPath(new URL(`../sdk-browser/src/${path}`, import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@footprint\/browser\/flags$/, replacement: browser('flags-entry.ts') },
			{ find: /^@footprint\/browser\/errors$/, replacement: browser('errors-entry.ts') },
			{ find: /^@footprint\/browser$/, replacement: browser('index.ts') }
		]
	},
	test: {
		environment: 'happy-dom',
		include: ['test/**/*.test.ts'],
		restoreMocks: true
	}
});
