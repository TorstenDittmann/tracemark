import { describe, expect, it } from 'vitest';
import { BRAND_ICONS } from './brand-icons';
import { agentPrompt, CATEGORIES, FRAMEWORKS, installCommand } from './install';

describe('installCommand', () => {
	it('uses each package manager’s own verb', () => {
		expect(installCommand('npm', ['a', 'b'])).toBe('npm install a b');
		expect(installCommand('pnpm', ['a'])).toBe('pnpm add a');
		expect(installCommand('yarn', ['a'])).toBe('yarn add a');
		expect(installCommand('bun', ['a'])).toBe('bun add a');
	});
});

describe('FRAMEWORKS', () => {
	it('has unique ids in known categories', () => {
		const ids = FRAMEWORKS.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
		const categories = new Set(CATEGORIES.map((c) => c.id));
		for (const f of FRAMEWORKS) expect(categories.has(f.category)).toBe(true);
	});

	it('puts the project key and host into every guide', () => {
		const ctx = { key: 'fp_pub_test', host: 'https://ingest.test' };
		for (const f of FRAMEWORKS) {
			expect(f.steps.length).toBeGreaterThan(0);
			const code = f.steps.flatMap((s) => (s.files ?? []).map((file) => file.code(ctx))).join('\n');
			expect(code, f.id).toContain(ctx.key);
			expect(code, f.id).toContain(ctx.host);
		}
	});

	it('only installs @tracemark packages and names a logo for most frameworks', () => {
		for (const f of FRAMEWORKS) {
			for (const s of f.steps) {
				for (const p of s.packages ?? []) expect(p).toMatch(/^@tracemark\//);
			}
		}
		const missing = FRAMEWORKS.filter((f) => !BRAND_ICONS[f.icon]).map((f) => f.id);
		expect(missing).toEqual(['elysia']);
	});
});

describe('agentPrompt', () => {
	const ctx = { key: 'fp_pub_test', host: 'https://ingest.test' };

	it('carries one framework’s steps and the key', () => {
		const next = FRAMEWORKS.find((f) => f.id === 'nextjs');
		const prompt = agentPrompt(next, ctx);
		expect(prompt).toContain('this Next.js project');
		expect(prompt).toContain(ctx.key);
		expect(prompt).toContain('app/layout.tsx');
		expect(prompt).not.toContain('## Nuxt');
	});

	it('asks the agent to detect the framework when none is picked', () => {
		const prompt = agentPrompt(undefined, ctx);
		expect(prompt).toContain('First work out which framework');
		for (const f of FRAMEWORKS) expect(prompt).toContain(`## ${f.label}`);
	});
});
