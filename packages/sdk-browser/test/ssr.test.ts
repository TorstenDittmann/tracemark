// @vitest-environment node
import { expect, it } from 'vitest';

it('imports and no-ops without window', async () => {
	expect(typeof window).toBe('undefined');
	const mod = await import('../src/index');
	const { tracemark, createClient } = mod;
	expect(tracemark.init({ apiKey: 'fp_pub_x', host: 'https://x.test' })).toBe(tracemark);
	expect(() => {
		tracemark.capture('x', { a: 1 });
		tracemark.identify('u');
		tracemark.group('company', 'acme');
		tracemark.setPersonProperties({ set: { a: 1 } });
		tracemark.reset();
		tracemark.optOut();
		tracemark.optIn();
		tracemark.destroy();
	}).not.toThrow();
	expect(tracemark.hasOptedOut()).toBe(false);
	expect(tracemark.getDistinctId()).toBeUndefined();
	expect(tracemark.getSessionId()).toBeUndefined();
	expect(tracemark.config).toBeUndefined();
	await expect(tracemark.flush()).resolves.toBeUndefined();
	const c = createClient({ apiKey: 'fp_pub_x', host: 'https://x.test' });
	expect(c.getDistinctId()).toBeUndefined();
	expect(mod.default).toBe(tracemark);
});
