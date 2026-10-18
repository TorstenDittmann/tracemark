import { describe, expect, it } from 'vitest';
import { DEFAULT_FUNNEL, DEFAULT_LIFECYCLE, DEFAULT_PATHS } from '../insights';
import {
	bearerKey,
	eventsResponse,
	InvalidRequest,
	MAX_BODY_BYTES,
	parseLimit,
	parseQueryBody,
	readJson
} from './query-api';

describe('query API requests', () => {
	it('reads the bearer key', () => {
		const request = (authorization?: string) =>
			new Request('http://x/api/v1/query', {
				headers: authorization ? { authorization } : {}
			});
		expect(bearerKey(request('Bearer fp_sec_abc '))).toBe('fp_sec_abc');
		expect(bearerKey(request('Basic abc'))).toBe('');
		expect(bearerKey(request())).toBe('');
	});

	it('parses query bodies, normalizing the query', () => {
		expect(
			parseQueryBody({
				kind: 'trends',
				query: { series: [{ event: 'signup', math: 'unique_users' }], range: '30d' }
			})
		).toEqual({
			kind: 'trends',
			query: { series: [{ event: 'signup', math: 'unique_users' }], range: '30d', filters: [] }
		});
		expect(parseQueryBody({ kind: 'funnel' })).toEqual({ kind: 'funnel', query: DEFAULT_FUNNEL });
		expect(parseQueryBody({ kind: 'paths' })).toEqual({ kind: 'paths', query: DEFAULT_PATHS });
		expect(
			parseQueryBody({ kind: 'lifecycle', query: { event: 'login', interval: 'week' } })
		).toEqual({
			kind: 'lifecycle',
			query: { ...DEFAULT_LIFECYCLE, event: 'login', interval: 'week' }
		});
		expect(() => parseQueryBody({ kind: 'stickiness' })).toThrow(InvalidRequest);
		expect(() => parseQueryBody({ kind: 'trends', query: [] })).toThrow(/query must be an object/);
		expect(() => parseQueryBody('trends')).toThrow(/JSON object/);
	});

	it('rejects bad and oversized bodies', async () => {
		const post = (body: string) => new Request('http://x', { method: 'POST', body });
		await expect(readJson(post('{"kind":"trends"}'))).resolves.toEqual({ kind: 'trends' });
		await expect(readJson(post('{'))).rejects.toThrow(/not valid JSON/);
		await expect(readJson(post(' '.repeat(MAX_BODY_BYTES + 1)))).rejects.toThrow(/64 KB/);
	});

	it('clamps limits', () => {
		expect(parseLimit(null, 500)).toBe(50);
		expect(parseLimit('10', 500)).toBe(10);
		expect(parseLimit('9999', 500)).toBe(500);
		expect(parseLimit('0', 500)).toBe(50);
		expect(parseLimit('2.5', 500)).toBe(50);
	});

	it('formats the next cursor', () => {
		const uuid = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
		expect(
			eventsResponse({ events: [], next: { timestamp: '2026-10-16T12:00:00.000Z', uuid } })
		).toEqual({ events: [], next: `2026-10-16T12:00:00.000Z_${uuid}` });
		expect(eventsResponse({ events: [], next: null }).next).toBeNull();
	});
});
