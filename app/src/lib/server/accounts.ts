import { count } from 'drizzle-orm';
import type { Auth } from './auth/index';
import type { Db } from './db/client';
import { members, organizations, users } from './db/schema';

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export async function hasUsers(db: Db): Promise<boolean> {
	const [row] = await db.select({ n: count() }).from(users);
	return (row?.n ?? 0) > 0;
}

/** URL-safe slug from a name plus a random suffix, since organization slugs must be unique. */
export function slugify(name: string): string {
	const base = name
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	const suffix = crypto.randomUUID().slice(0, 8);
	return base ? `${base}-${suffix}` : suffix;
}

/**
 * Signs up the instance's first user and makes them owner of every existing organization
 * (projects made with the CLI before sign-in existed), or of a new one when there are none.
 * Returns null when a user already exists. With the SvelteKit cookie plugin, the session cookie is set.
 */
export async function setupFirstUser(
	auth: Auth,
	db: Db,
	input: { name: string; email: string; password: string; organization: string },
	headers: Headers = new Headers()
) {
	// Cheap check first so posts to a set-up instance never pay for password hashing;
	// the sign-up hook refuses a second user as well.
	if (await hasUsers(db)) return null;
	const { user } = await auth.api.signUpEmail({
		body: { name: input.name, email: normalizeEmail(input.email), password: input.password },
		headers
	});

	let orgIds = (await db.select({ id: organizations.id }).from(organizations)).map((o) => o.id);
	if (orgIds.length === 0) {
		const [org] = await db
			.insert(organizations)
			.values({ name: input.organization, slug: slugify(input.organization) })
			.returning({ id: organizations.id });
		if (!org) throw new Error('failed to create organization');
		orgIds = [org.id];
	}
	await db
		.insert(members)
		.values(orgIds.map((organizationId) => ({ organizationId, userId: user.id, role: 'owner' })));
	return user;
}
