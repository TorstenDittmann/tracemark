import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		hono: 'src/hono.ts',
		express: 'src/express.ts',
		fastify: 'src/fastify.ts',
		elysia: 'src/elysia.ts',
		ai: 'src/ai.ts'
	},
	format: 'esm',
	platform: 'neutral',
	target: 'es2022',
	dts: true,
	clean: true,
	// The flag evaluator and stack parser are bundled in, so the published package has no dependencies.
	deps: {
		alwaysBundle: ['@tracemark/flags', '@tracemark/errors'],
		// Only the AI helpers import a Node built-in (AsyncLocalStorage), which Bun and Deno provide too.
		neverBundle: [/^node:/, 'elysia', 'fastify']
	}
});
