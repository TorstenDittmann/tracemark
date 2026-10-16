import { inArray, lt } from 'drizzle-orm';
import type { Db } from './db/client';
import { dailySalts } from './db/schema';

const DAY_MS = 86_400_000;

function utcDay(time: number): string {
	return new Date(time).toISOString().slice(0, 10);
}

function randomSalt(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Today's and tomorrow's salts by UTC day, created on first use. Tomorrow's is handed out early
 * so ingest has it at midnight without waiting for its next poll. Older salts are deleted.
 */
export async function currentSalts(db: Db, now = Date.now()): Promise<Record<string, string>> {
	const days = [utcDay(now), utcDay(now + DAY_MS)];
	await db
		.insert(dailySalts)
		.values(days.map((day) => ({ day, salt: randomSalt() })))
		.onConflictDoNothing();
	await db.delete(dailySalts).where(lt(dailySalts.day, days[0]));
	const rows = await db.select().from(dailySalts).where(inArray(dailySalts.day, days));
	return Object.fromEntries(rows.map((row) => [row.day, row.salt]));
}
