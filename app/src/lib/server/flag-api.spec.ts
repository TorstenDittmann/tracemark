import { describe, expect, it } from 'vitest';
import { flagsResponse, parseFlagsBody } from './flag-api';

describe('parseFlagsBody', () => {
	it('reads a full request', () => {
		expect(
			parseFlagsBody({
				api_key: 'fp_pub_x',
				distinct_id: 'ada',
				person_properties: { plan: 'pro' },
				groups: { company: 'acme' },
				group_properties: { company: { seats: 4 }, team: { size: 2 } }
			})
		).toEqual({
			apiKey: 'fp_pub_x',
			request: {
				distinctId: 'ada',
				personProperties: { plan: 'pro' },
				groups: { company: 'acme' },
				// Properties of a group the request isn't in are dropped.
				groupProperties: { company: { seats: 4 } }
			}
		});
	});

	it.each([
		[[], /object/],
		[{ distinct_id: 'ada' }, /api_key/],
		[{ api_key: 'k' }, /distinct_id/],
		[{ api_key: 'k', distinct_id: 'x'.repeat(201) }, /distinct_id/],
		[{ api_key: 'k', distinct_id: 'ada', person_properties: [] }, /person_properties/],
		[{ api_key: 'k', distinct_id: 'ada', groups: { company: 7 } }, /groups/],
		[
			{
				api_key: 'k',
				distinct_id: 'ada',
				groups: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`t${i}`, 'k']))
			},
			/at most 5/
		]
	])('rejects %j', (body, message) => {
		expect(() => parseFlagsBody(body)).toThrow(message);
	});
});

describe('flagsResponse', () => {
	it('lists every value and the payloads of flags that are on', () => {
		expect(
			flagsResponse({
				a: { key: 'a', value: true, payload: { x: 1 }, reason: 'match' },
				b: { key: 'b', value: 'test', payload: null, reason: 'match' },
				c: { key: 'c', value: false, payload: null, reason: 'no_match' },
				d: { key: 'd', value: true, payload: 0, reason: 'match' }
			})
		).toEqual({
			flags: { a: true, b: 'test', c: false, d: true },
			payloads: { a: { x: 1 }, d: 0 }
		});
	});
});
