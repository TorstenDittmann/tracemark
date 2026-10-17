import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Source map uploads are one file per request and can be large; BODY_SIZE_LIMIT overrides.
			adapter: adapter({ serverOptions: { maxRequestBodySize: 32 * 1024 * 1024 } })
		})
	],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		// Tests use the bundled price snapshot instead of fetching models.dev.
		env: { MODEL_PRICES_URL: 'off' },
		include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts']
	}
});
