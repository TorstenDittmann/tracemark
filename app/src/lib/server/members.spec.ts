import { describe, expect, it } from 'vitest';
import { setupFirstUser } from './accounts';
import { createAuth } from './auth/index';
import { invitations } from './db/schema';
import {
	acceptInvitation,
	getOpenInvitation,
	invite,
	joinWithInvitation,
	listMembers,
	listPendingInvitations
} from './members';
import { listOrganizationsForUser } from './projects';
import { createTestDb } from './test-db';

async function signIn(auth: ReturnType<typeof createAuth>, email: string, password: string) {
	const { headers } = await auth.api.signInEmail({
		body: { email, password },
		returnHeaders: true
	});
	return new Headers({
		cookie: headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ')
	});
}

async function setup() {
	const db = await createTestDb();
	const auth = createAuth(db, { secret: 'test-secret-test-secret-test-secret' });
	const owner = await setupFirstUser(auth, db, {
		name: 'Ada',
		email: 'ada@example.com',
		password: 'correct horse battery',
		organization: 'Acme'
	});
	if (!owner) throw new Error('no owner');
	const [org] = await listOrganizationsForUser(db, owner.id);
	if (!org) throw new Error('no org');
	const ownerHeaders = await signIn(auth, 'ada@example.com', 'correct horse battery');
	return { db, auth, owner, org, ownerHeaders };
}

describe('invitations', () => {
	it('lets an invited person create an account and join', async () => {
		const { db, auth, org, ownerHeaders } = await setup();
		const created = await invite(auth, ownerHeaders, {
			organizationId: org.id,
			email: 'Eve@Example.com',
			role: 'admin'
		});
		expect(created.email).toBe('eve@example.com');
		expect((await listPendingInvitations(db, org.id)).map((i) => i.email)).toEqual([
			'eve@example.com'
		]);

		const open = await getOpenInvitation(db, created.id);
		expect(open).toMatchObject({ organizationName: 'Acme', inviterName: 'Ada', role: 'admin' });
		if (!open) return;

		const headers = await joinWithInvitation(auth, open, {
			name: 'Eve',
			password: 'eve password!'
		});
		expect(headers.getSetCookie().join()).toContain('session_token');
		expect((await listMembers(db, org.id)).map((m) => [m.name, m.role])).toEqual([
			['Ada', 'owner'],
			['Eve', 'admin']
		]);
		expect(await getOpenInvitation(db, created.id)).toBeNull();
		expect(await listPendingInvitations(db, org.id)).toEqual([]);
	});

	it('lets an existing user accept only their own invitation', async () => {
		const { db, auth, org, ownerHeaders } = await setup();
		const first = await invite(auth, ownerHeaders, {
			organizationId: org.id,
			email: 'eve@example.com',
			role: 'member'
		});
		const open = await getOpenInvitation(db, first.id);
		if (!open) throw new Error('no invitation');
		await joinWithInvitation(auth, open, { name: 'Eve', password: 'eve password!' });
		const eve = await signIn(auth, 'eve@example.com', 'eve password!');

		// Eve is a member, so she may not invite.
		await expect(
			invite(auth, eve, { organizationId: org.id, email: 'bob@example.com', role: 'member' })
		).rejects.toThrow();

		const forBob = await invite(auth, ownerHeaders, {
			organizationId: org.id,
			email: 'bob@example.com',
			role: 'member'
		});
		await expect(acceptInvitation(auth, eve, forBob.id)).rejects.toThrow();
	});

	it('hides expired and cancelled invitations', async () => {
		const { db, auth, org, owner, ownerHeaders } = await setup();
		const [expired] = await db
			.insert(invitations)
			.values({
				organizationId: org.id,
				email: 'old@example.com',
				role: 'member',
				inviterId: owner.id,
				expiresAt: new Date(Date.now() - 1000)
			})
			.returning();
		if (!expired) throw new Error('no invitation');
		expect(await getOpenInvitation(db, expired.id)).toBeNull();

		const created = await invite(auth, ownerHeaders, {
			organizationId: org.id,
			email: 'eve@example.com',
			role: 'member'
		});
		await auth.api.cancelInvitation({ body: { invitationId: created.id }, headers: ownerHeaders });
		expect(await getOpenInvitation(db, created.id)).toBeNull();
		expect(await listPendingInvitations(db, org.id)).toEqual([]);
	});
});
