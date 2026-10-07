import { count, eq } from 'drizzle-orm';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './auth/password';
import type { SessionUser } from './auth/session';
import type { Db } from './db/client';
import { memberships, organizations, users } from './db/schema';

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function validateCredentials(input: {
	email: string;
	password: string;
}): Record<string, string> | null {
	const errors: Record<string, string> = {};
	if (!/^[^\s@]+@[^\s@]+$/.test(input.email)) errors.email = 'Enter a valid email address.';
	if (input.password.length < MIN_PASSWORD_LENGTH) {
		errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
	} else if (input.password.length > 256) {
		errors.password = 'Use at most 256 characters.';
	}
	return Object.keys(errors).length ? errors : null;
}

export async function hasUsers(db: Db): Promise<boolean> {
	const [row] = await db.select({ n: count() }).from(users);
	return (row?.n ?? 0) > 0;
}

/**
 * Creates the instance's first user as owner of every existing organization
 * (projects made with the CLI before sign-in existed), or of a new one when there are none.
 * Returns null when a user already exists.
 */
export async function setupFirstUser(
	db: Db,
	input: { name: string; email: string; password: string; organization: string }
): Promise<SessionUser | null> {
	// Cheap check first so unauthenticated posts to a set-up instance never pay for scrypt;
	// the check inside the transaction still settles a race between two first users.
	if (await hasUsers(db)) return null;
	const passwordHash = await hashPassword(input.password);
	return db.transaction(async (tx) => {
		const [existing] = await tx.select({ n: count() }).from(users);
		if ((existing?.n ?? 0) > 0) return null;

		const [user] = await tx
			.insert(users)
			.values({ name: input.name, email: normalizeEmail(input.email), passwordHash })
			.returning({ id: users.id, email: users.email, name: users.name });
		if (!user) throw new Error('failed to create user');

		let orgIds = (await tx.select({ id: organizations.id }).from(organizations)).map((o) => o.id);
		if (orgIds.length === 0) {
			const [org] = await tx
				.insert(organizations)
				.values({ name: input.organization })
				.returning({ id: organizations.id });
			if (!org) throw new Error('failed to create organization');
			orgIds = [org.id];
		}
		await tx.insert(memberships).values(
			orgIds.map((organizationId) => ({
				organizationId,
				userId: user.id,
				role: 'owner' as const
			}))
		);
		return user;
	});
}

// Verified against when the email is unknown, so both paths take about as long.
let dummyHash: Promise<string> | undefined;

export async function authenticate(
	db: Db,
	email: string,
	password: string
): Promise<SessionUser | null> {
	const [user] = await db
		.select()
		.from(users)
		.where(eq(users.email, normalizeEmail(email)));
	if (!user) {
		dummyHash ??= hashPassword('not a real password');
		await verifyPassword(password, await dummyHash);
		return null;
	}
	if (!(await verifyPassword(password, user.passwordHash))) return null;
	return { id: user.id, email: user.email, name: user.name };
}

export async function setPassword(db: Db, userId: string, password: string): Promise<void> {
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(password) })
		.where(eq(users.id, userId));
}
