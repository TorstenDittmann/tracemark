import { describe, expect, it, vi } from 'vitest';
import { MAX_QUEUE } from '../src/client';
import { API_KEY, bodies, HOST, make, mockFetch, sentEvents } from './helpers';

function stubBeacon(result = true) {
	const beacon = vi.fn((_url: string, _data: Blob) => result);
	Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
	return beacon;
}

describe('batching', () => {
	it('flushes immediately when the queue reaches maxBatchSize', async () => {
		vi.useFakeTimers();
		const f = mockFetch();
		const c = make({ maxBatchSize: 3 });
		c.capture('a');
		c.capture('b');
		expect(f).not.toHaveBeenCalled();
		c.capture('c');
		await vi.advanceTimersByTimeAsync(0);
		expect(f).toHaveBeenCalledTimes(1);
		expect(bodies(f)[0]?.batch.map((e) => e.event)).toEqual(['a', 'b', 'c']);
	});

	it('flushes on the interval', async () => {
		vi.useFakeTimers();
		const f = mockFetch();
		make({ flushIntervalMs: 2000 }).capture('a');
		await vi.advanceTimersByTimeAsync(1999);
		expect(f).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(f).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('splits a large queue into batches of maxBatchSize', async () => {
		const f = mockFetch();
		const c = make({ maxBatchSize: 1000, flushIntervalMs: 1e9 });
		for (let i = 0; i < 120; i++) c.capture(`e${i}`);
		await c.flush();
		expect(f).toHaveBeenCalledTimes(1);
		const d = make({ maxBatchSize: 50, flushIntervalMs: 1e9 });
		f.mockClear();
		for (let i = 0; i < 49; i++) d.capture(`e${i}`);
		c.destroy();
		await d.flush();
		expect(bodies(f).map((b) => b.batch.length)).toEqual([49]);
	});

	it('caps the queue at 1000 events, dropping the oldest', async () => {
		const f = mockFetch();
		const c = make({ maxBatchSize: 5000, flushIntervalMs: 1e9 });
		for (let i = 0; i < MAX_QUEUE + 5; i++) c.capture(`e${i}`);
		await c.flush();
		const evs = sentEvents(f);
		expect(evs).toHaveLength(MAX_QUEUE);
		expect(evs[0]?.event).toBe('e5');
		expect(evs.at(-1)?.event).toBe(`e${MAX_QUEUE + 4}`);
	});
});

describe('retries', () => {
	it('retries 5xx with exponential backoff, then keeps events for later', async () => {
		vi.useFakeTimers();
		const f = mockFetch(async () => ({ status: 503 }));
		const c = make({ flushIntervalMs: 60_000 });
		c.capture('a');
		const p = c.flush();
		await vi.advanceTimersByTimeAsync(0);
		expect(f).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(999);
		expect(f).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(f).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2000);
		expect(f).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(4000);
		expect(f).toHaveBeenCalledTimes(4);
		await p;
		await vi.advanceTimersByTimeAsync(8000);
		expect(f).toHaveBeenCalledTimes(4);
		f.mockImplementation(async () => ({ status: 202 }));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f).toHaveBeenCalledTimes(5);
		expect(bodies(f).map((b) => b.batch[0]?.event)).toEqual(['a', 'a', 'a', 'a', 'a']);
		await c.flush();
		expect(f).toHaveBeenCalledTimes(5);
	});

	it('retries network errors', async () => {
		vi.useFakeTimers();
		let n = 0;
		const f = mockFetch(async () => {
			if (n++ === 0) throw new TypeError('Failed to fetch');
			return { status: 202 };
		});
		const c = make();
		c.capture('a');
		const p = c.flush();
		await vi.advanceTimersByTimeAsync(1000);
		await p;
		expect(f).toHaveBeenCalledTimes(2);
		f.mockClear();
		await c.flush();
		expect(f).not.toHaveBeenCalled();
	});

	it.each([400, 401, 413])('drops the batch on %i without retrying', async (status) => {
		vi.useFakeTimers();
		const f = mockFetch(async () => ({ status }));
		const c = make();
		c.capture('a');
		await c.flush();
		await vi.advanceTimersByTimeAsync(60_000);
		await c.flush();
		expect(f).toHaveBeenCalledTimes(1);
	});
});

describe('unload', () => {
	it('flushes with sendBeacon as a text/plain Blob on pagehide', async () => {
		const beacon = stubBeacon();
		const f = mockFetch();
		const c = make({ maxBatchSize: 2 });
		c.capture('x');
		window.dispatchEvent(new Event('pagehide'));
		expect(beacon).toHaveBeenCalledTimes(1);
		const [url, blob] = beacon.mock.calls[0] ?? [];
		expect(url).toBe(`${HOST}/e`);
		expect(blob?.type).toBe('text/plain');
		const body = JSON.parse((await blob?.text()) ?? '');
		expect(body.api_key).toBe(API_KEY);
		expect(body.batch.map((e: { event: string }) => e.event)).toEqual(['x']);
		await c.flush();
		expect(f).not.toHaveBeenCalled();
	});

	it('flushes with sendBeacon when the page becomes hidden', () => {
		const beacon = stubBeacon();
		mockFetch();
		const c = make();
		c.capture('x');
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(beacon).toHaveBeenCalledTimes(1);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(beacon).toHaveBeenCalledTimes(1);
	});

	it('falls back to fetch keepalive when sendBeacon refuses', () => {
		stubBeacon(false);
		const f = mockFetch();
		const c = make();
		c.capture('x');
		window.dispatchEvent(new Event('pagehide'));
		expect(f).toHaveBeenCalledTimes(1);
		expect(f.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
	});
});
