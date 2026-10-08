/** Fixed-window, in-memory limiter. Good enough for one app instance guarding sign-in. */
export class RateLimiter {
	#hits = new Map<string, { count: number; resetAt: number }>();

	constructor(
		readonly limit: number,
		readonly windowMs: number
	) {}

	/** Records an attempt and returns false when `key` is over the limit. */
	consume(key: string, now = Date.now()): boolean {
		const entry = this.#hits.get(key);
		if (!entry || entry.resetAt <= now) {
			if (this.#hits.size > 10_000) this.#sweep(now);
			this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
			return true;
		}
		entry.count++;
		return entry.count <= this.limit;
	}

	reset(key: string): void {
		this.#hits.delete(key);
	}

	#sweep(now: number) {
		for (const [key, entry] of this.#hits) {
			if (entry.resetAt <= now) this.#hits.delete(key);
		}
	}
}
