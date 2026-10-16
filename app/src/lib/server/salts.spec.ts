import { describe, expect, it } from 'vitest';
import { dailySalts } from './db/schema';
import { currentSalts } from './salts';
import { createTestDb } from './test-db';

describe('currentSalts', () => {
	it('keeps one salt per day for today and tomorrow and forgets older days', async () => {
		const db = await createTestDb();
		const first = await currentSalts(db, Date.UTC(2026, 9, 16, 23, 59));
		expect(Object.keys(first)).toEqual(['2026-10-16', '2026-10-17']);
		expect(first['2026-10-16']).toMatch(/^[0-9a-f]{64}$/);
		expect(first['2026-10-16']).not.toBe(first['2026-10-17']);

		// Stable within the day, and tomorrow's salt is the one used once it is today.
		expect(await currentSalts(db, Date.UTC(2026, 9, 16, 23, 59, 30))).toEqual(first);
		const next = await currentSalts(db, Date.UTC(2026, 9, 17, 0, 1));
		expect(next['2026-10-17']).toBe(first['2026-10-17']);
		expect(Object.keys(next)).toEqual(['2026-10-17', '2026-10-18']);

		const stored = await db.select({ day: dailySalts.day }).from(dailySalts);
		expect(stored.map((row) => row.day).sort()).toEqual(['2026-10-17', '2026-10-18']);
	});
});
