import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, parseUsageRange } from '../usage';
import { estimateBytes, storageUsage } from './usage';

const config = { url: 'http://clickhouse.test', user: 'tracemark', password: '', database: 'tm' };

describe('usage', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('splits table bytes by share of rows', () => {
		const rows = new Map([
			['a', 300],
			['b', 100],
			['elsewhere', 600]
		]);
		expect(estimateBytes(rows, 1000, ['a', 'b', 'none'])).toEqual({ a: 300, b: 100, none: 0 });
		expect(estimateBytes(new Map(), 1000, ['a'])).toEqual({ a: 0 });
	});

	it('returns no storage when ClickHouse refuses system tables', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('Code: 497. DB::Exception: Not enough privileges. (ACCESS_DENIED)', {
						status: 403
					})
			)
		);
		expect(await storageUsage(config, ['a'])).toBeNull();
		expect(warn).toHaveBeenCalled();
	});

	it('only takes the usage ranges', () => {
		expect(parseUsageRange('90d')).toBe('90d');
		expect(parseUsageRange('24h')).toBe('30d');
		expect(parseUsageRange(null)).toBe('30d');
	});

	it('formats bytes in binary units', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1536)).toBe('1.50 KB');
		expect(formatBytes(20.5 * 1024 ** 3)).toBe('20.5 GB');
		expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB');
	});
});
