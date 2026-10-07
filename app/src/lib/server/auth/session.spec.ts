import { describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { createTestDb } from '../test-db';
import {
	createSession,
	invalidateSession,
	SESSION_LIFETIME,
	sessionIdFromToken,
	validateSession
} from './session';

async function setup() {
	const db = await createTestDb();
	const [user] = await db
		.insert(users)
		.values({ email: 'ada@example.com', name: 'Ada', passwordHash: 'x' })
		.returning();
	if (!user) throw new Error('no user');
	return { db, user };
}

describe('sessions', () => {
	it('stores only the token hash', async () => {
		const { db, user } = await setup();
		const { token } = await createSession(db, user.id);
		const rows = await db.query.sessions.findMany();
		expect(rows.map((r) => r.id)).toEqual([sessionIdFromToken(token)]);
		expect(rows[0]?.id).not.toContain(token);
	});

	it('validates, renews near expiry and expires', async () => {
		const { db, user } = await setup();
		const now = Date.now();
		const { token } = await createSession(db, user.id, now);

		const fresh = await validateSession(db, token, now);
		expect(fresh?.user).toEqual({ id: user.id, email: 'ada@example.com', name: 'Ada' });
		expect(fresh?.renewed).toBe(false);

		const later = now + SESSION_LIFETIME - 1000;
		const renewed = await validateSession(db, token, later);
		expect(renewed?.renewed).toBe(true);
		expect(renewed?.expiresAt.getTime()).toBe(later + SESSION_LIFETIME);

		expect(await validateSession(db, token, later + SESSION_LIFETIME)).toBeNull();
		expect(await db.query.sessions.findMany()).toEqual([]);
	});

	it('rejects unknown and invalidated tokens', async () => {
		const { db, user } = await setup();
		const { token } = await createSession(db, user.id);
		expect(await validateSession(db, 'nope')).toBeNull();
		await invalidateSession(db, token);
		expect(await validateSession(db, token)).toBeNull();
	});
});
