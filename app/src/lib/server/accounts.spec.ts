import { describe, expect, it } from 'vitest';
import { authenticate, hasUsers, setupFirstUser, validateCredentials } from './accounts';
import { organizations } from './db/schema';
import { listOrganizationsForUser } from './projects';
import { createTestDb } from './test-db';

const input = {
	name: 'Ada',
	email: ' Ada@Example.com ',
	password: 'correct horse battery',
	organization: 'Acme'
};

describe('setupFirstUser', () => {
	it('creates the owner and an organization, once', async () => {
		const db = await createTestDb();
		expect(await hasUsers(db)).toBe(false);

		const user = await setupFirstUser(db, input);
		expect(user?.email).toBe('ada@example.com');
		expect(await hasUsers(db)).toBe(true);
		if (!user) return;
		expect(await listOrganizationsForUser(db, user.id)).toEqual([
			{ id: expect.any(String), name: 'Acme', role: 'owner' }
		]);

		expect(await setupFirstUser(db, { ...input, email: 'eve@example.com' })).toBeNull();
	});

	it('adopts organizations created before sign-in existed', async () => {
		const db = await createTestDb();
		await db.insert(organizations).values([{ name: 'Old A' }, { name: 'Old B' }]);
		const user = await setupFirstUser(db, input);
		if (!user) throw new Error('no user');
		const orgs = await listOrganizationsForUser(db, user.id);
		expect(orgs.map((o) => o.name)).toEqual(['Old A', 'Old B']);
	});
});

describe('authenticate', () => {
	it('checks email (case-insensitively) and password', async () => {
		const db = await createTestDb();
		await setupFirstUser(db, input);
		expect((await authenticate(db, 'ADA@example.com', input.password))?.name).toBe('Ada');
		expect(await authenticate(db, 'ada@example.com', 'wrong password!')).toBeNull();
		expect(await authenticate(db, 'eve@example.com', input.password)).toBeNull();
	});
});

describe('validateCredentials', () => {
	it('requires an email and a long enough password', () => {
		expect(validateCredentials({ email: 'ada@example.com', password: 'long enough' })).toBeNull();
		expect(validateCredentials({ email: 'ada', password: 'short' })).toEqual({
			email: expect.any(String),
			password: expect.any(String)
		});
	});
});
