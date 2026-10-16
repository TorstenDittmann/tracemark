// @vitest-environment happy-dom
import * as sdk from '@footprint/browser';
import * as errorsEntry from '@footprint/browser/errors';
import { describe, expect, it, vi } from 'vitest';
import integration, { pageScript } from '../src/index';

const HOST = 'https://footprint.example.com';

/** Runs a page script with its imports resolved to the SDK sources. */
function run(code: string) {
	const modules: Record<string, unknown> = {
		'@footprint/browser': sdk,
		'@footprint/browser/errors': errorsEntry
	};
	const body = code.replace(
		/^import \{ (\w+) \} from '([^']+)';$/gm,
		(_line, name: string, from: string) => `const { ${name} } = modules[${JSON.stringify(from)}];`
	);
	new Function('modules', body)(modules);
}

describe('astro integration', () => {
	it('adds a page script that sets up the SDK and error capture', () => {
		const scripts: [string, string][] = [];
		const added = integration({
			apiKey: 'fp_pub_test',
			host: HOST,
			persistence: 'cookie',
			errors: { release: '1.2.3' }
		});
		expect(added.name).toBe('@footprint/astro');
		added.hooks['astro:config:setup']({
			injectScript: (stage, content) => scripts.push([stage, content])
		});
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.[0]).toBe('page');
		expect(pageScript({ apiKey: 'k', host: HOST })).not.toContain('errors');

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, status: 202, json: async () => ({}) }))
		);
		run(scripts[0]?.[1] ?? '');
		expect(sdk.footprint.config).toMatchObject({
			apiKey: 'fp_pub_test',
			host: HOST,
			persistence: 'cookie'
		});
		sdk.footprint.destroy();
	});
});
