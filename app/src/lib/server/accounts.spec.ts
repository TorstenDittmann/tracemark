import { describe, expect, it } from 'vitest';
import { hasUsers, setupFirstUser, slugify } from './accounts';
import { createAuth } from './auth/index';
import { invitations, organizations } from './db/schema';
import { listOrganizationsForUser } from './projects';
import { createTestDb } from './test-db';

const input = {
	name: 'Ada',
	email: ' Ada@Example.com ',
	password: 'correct horse battery',
	organization: 'Acme'
};

async function setup() {
	const db = await createTestDb();
	return { db, auth: createAuth(db, { secret: 'test-secret-test-secret-test-secret' }) };
}

describe('setupFirstUser', () => {
	it('creates the owner and an organization, once', async () => {
		const { db, auth } = await setup();
		expect(await hasUsers(db)).toBe(false);

		const user = await setupFirstUser(auth, db, input);
		expect(user?.email).toBe('ada@example.com');
		expect(await hasUsers(db)).toBe(true);
		if (!user) return;
		expect(await listOrganizationsForUser(db, user.id)).toEqual([
			{ id: expect.any(String), name: 'Acme', role: 'owner' }
		]);

		expect(await setupFirstUser(auth, db, { ...input, email: 'eve@example.com' })).toBeNull();
	});

	it('adopts organizations created before sign-in existed', async () => {
		const { db, auth } = await setup();
		await db.insert(organizations).values([
			{ name: 'Old A', slug: 'old-a' },
			{ name: 'Old B', slug: 'old-b' }
		]);
		const user = await setupFirstUser(auth, db, input);
		if (!user) throw new Error('no user');
		const orgs = await listOrganizationsForUser(db, user.id);
		expect(orgs.map((o) => o.name)).toEqual(['Old A', 'Old B']);
	});
});

describe('sign-up', () => {
	it('is closed after the first user unless there is a current invitation', async () => {
		const { db, auth } = await setup();
		const owner = await setupFirstUser(auth, db, input);
		if (!owner) throw new Error('no owner');

		const body = { name: 'Eve', email: 'eve@example.com', password: 'another long one' };
		await expect(auth.api.signUpEmail({ body })).rejects.toThrow(/closed/);

		const [org] = await listOrganizationsForUser(db, owner.id);
		if (!org) throw new Error('no org');
		const invite = {
			organizationId: org.id,
			email: 'eve@example.com',
			role: 'member',
			inviterId: owner.id
		};
		await db.insert(invitations).values({ ...invite, expiresAt: new Date(Date.now() - 1000) });
		await expect(auth.api.signUpEmail({ body })).rejects.toThrow(/closed/);

		await db.insert(invitations).values({ ...invite, expiresAt: new Date(Date.now() + 60_000) });
		expect((await auth.api.signUpEmail({ body })).user.email).toBe('eve@example.com');
	});
});

describe('signInEmail', () => {
	it('checks email (case-insensitively) and password', async () => {
		const { db, auth } = await setup();
		await setupFirstUser(auth, db, input);
		const ok = await auth.api.signInEmail({
			body: { email: 'ada@example.com', password: input.password }
		});
		expect(ok.user.name).toBe('Ada');
		await expect(
			auth.api.signInEmail({ body: { email: 'ada@example.com', password: 'wrong password!' } })
		).rejects.toThrow();
		await expect(
			auth.api.signInEmail({ body: { email: 'eve@example.com', password: input.password } })
		).rejects.toThrow();
	});
});

describe('slugify', () => {
	it('makes unique, URL-safe slugs', () => {
		expect(slugify('Acme Inc.')).toMatch(/^acme-inc-[0-9a-f]{8}$/);
		expect(slugify('日本')).toMatch(/^[0-9a-f]{8}$/);
		expect(slugify('Acme')).not.toBe(slugify('Acme'));
	});
});
