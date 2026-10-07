import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'fp_session';
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_LIFETIME = 30 * DAY;
/** Sessions used within this window of expiring are extended to a full lifetime. */
const RENEW_WITHIN = 15 * DAY;

export interface SessionUser {
	id: string;
	email: string;
	name: string;
}

export function generateSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

/** Sessions are stored by token hash, so a leaked database cannot be used to sign in. */
export function sessionIdFromToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: string, now = Date.now()) {
	const token = generateSessionToken();
	const expiresAt = new Date(now + SESSION_LIFETIME);
	await db.insert(sessions).values({ id: sessionIdFromToken(token), userId, expiresAt });
	return { token, expiresAt };
}

/** Returns the session's user, or null when the token is unknown or expired. Extends sessions close to expiry. */
export async function validateSession(
	db: Db,
	token: string,
	now = Date.now()
): Promise<{ user: SessionUser; expiresAt: Date; renewed: boolean } | null> {
	const id = sessionIdFromToken(token);
	const [row] = await db
		.select({
			expiresAt: sessions.expiresAt,
			user: { id: users.id, email: users.email, name: users.name }
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id));
	if (!row) return null;

	if (row.expiresAt.getTime() <= now) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}
	if (row.expiresAt.getTime() - now < RENEW_WITHIN) {
		const expiresAt = new Date(now + SESSION_LIFETIME);
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
		return { user: row.user, expiresAt, renewed: true };
	}
	return { user: row.user, expiresAt: row.expiresAt, renewed: false };
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, sessionIdFromToken(token)));
}

export async function invalidateUserSessions(db: Db, userId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}
