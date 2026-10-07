import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bodies, make, mockFetch } from './helpers';

// node:path, not URL: happy-dom replaces the global URL class in this environment.
const dir = process.env.FP_FIXTURES_DIR ?? join(import.meta.dirname, '../../schema/fixtures/valid');
const fixtures = existsSync(dir)
	? readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => ({ name: f, body: JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
	: [];

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

async function sdkBody() {
	const f = mockFetch();
	const c = make();
	c.group('company', 'acme');
	c.identify('user_123', { set: { plan: 'pro' }, set_once: { first_seen_on: 'web' } });
	c.capture('$pageview', { nested: { a: [1, 2] } });
	await c.flush();
	const [body] = bodies(f);
	if (!body) throw new Error('no body sent');
	return body as unknown as Record<string, unknown> & { batch: Record<string, unknown>[] };
}

/** Hand-written check of the rules in docs/ingest-protocol.md. */
describe('wire format', () => {
	it('matches the ingest protocol rules', async () => {
		const body = await sdkBody();
		expect(Object.keys(body).sort()).toEqual(['api_key', 'batch', 'sent_at']);
		expect(body.batch.length).toBeGreaterThan(0);
		expect(body.batch.length).toBeLessThanOrEqual(1000);
		for (const ev of body.batch) {
			for (const k of Object.keys(ev)) {
				expect([
					'uuid',
					'event',
					'distinct_id',
					'timestamp',
					'session_id',
					'properties',
					'person',
					'groups'
				]).toContain(k);
			}
			expect(kind(ev.uuid)).toBe('string');
			expect(String(ev.event).length).toBeGreaterThan(0);
			expect(String(ev.event).length).toBeLessThanOrEqual(200);
			expect(String(ev.distinct_id).length).toBeGreaterThan(0);
			expect(String(ev.timestamp)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
			expect(kind(ev.properties)).toBe('object');
			if (ev.person)
				expect(Object.keys(ev.person as object).every((k) => k === 'set' || k === 'set_once')).toBe(
					true
				);
			if (ev.groups) {
				const g = Object.entries(ev.groups as Record<string, unknown>);
				expect(g.length).toBeLessThanOrEqual(5);
				for (const [k, v] of g) {
					expect(typeof v).toBe('string');
					expect(k.length).toBeLessThanOrEqual(200);
				}
			}
		}
	});

	it.skipIf(fixtures.length === 0)(
		'has the same shape as packages/schema/fixtures/valid',
		async () => {
			const top = new Map<string, string>();
			const event = new Map<string, string>();
			for (const { body } of fixtures) {
				for (const [k, v] of Object.entries(body)) top.set(k, kind(v));
				for (const ev of body.batch ?? [])
					for (const [k, v] of Object.entries(ev)) event.set(k, kind(v));
			}
			const body = await sdkBody();
			for (const [k, v] of Object.entries(body)) {
				expect(top.has(k), `top-level key ${k} not in any fixture`).toBe(true);
				expect(kind(v), `top-level ${k}`).toBe(top.get(k));
			}
			for (const ev of body.batch) {
				for (const [k, v] of Object.entries(ev)) {
					expect(event.has(k), `event key ${k} not in any fixture`).toBe(true);
					expect(kind(v), `event.${k}`).toBe(event.get(k));
				}
			}
		}
	);
});
