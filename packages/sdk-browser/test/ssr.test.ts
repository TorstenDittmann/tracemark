// @vitest-environment node
import { expect, it } from 'vitest';

it('imports and no-ops without window', async () => {
	expect(typeof window).toBe('undefined');
	const mod = await import('../src/index');
	const { footprint, createClient } = mod;
	expect(footprint.init({ apiKey: 'fp_pub_x', host: 'https://x.test' })).toBe(footprint);
	expect(() => {
		footprint.capture('x', { a: 1 });
		footprint.identify('u');
		footprint.group('company', 'acme');
		footprint.setPersonProperties({ set: { a: 1 } });
		footprint.reset();
		footprint.optOut();
		footprint.optIn();
		footprint.destroy();
	}).not.toThrow();
	expect(footprint.hasOptedOut()).toBe(false);
	expect(footprint.getDistinctId()).toBeUndefined();
	expect(footprint.getSessionId()).toBeUndefined();
	expect(footprint.config).toBeUndefined();
	await expect(footprint.flush()).resolves.toBeUndefined();
	const c = createClient({ apiKey: 'fp_pub_x', host: 'https://x.test' });
	expect(c.getDistinctId()).toBeUndefined();
	expect(mod.default).toBe(footprint);
});
