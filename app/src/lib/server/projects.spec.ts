import { describe, expect, it } from 'vitest';
import { setupFirstUser } from './accounts';
import { createAuth } from './auth/index';
import { organizations, users } from './db/schema';
import {
	createProject,
	deleteProject,
	getProjectForUser,
	listOrganizationsForUser,
	listProjectsForUser,
	rotatePublicKey
} from './projects';
import { createTestDb } from './test-db';

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
	const [outsider] = await db
		.insert(users)
		.values({ email: 'eve@example.com', name: 'Eve' })
		.returning();
	if (!outsider) throw new Error('no outsider');
	return { db, owner, org, outsider };
}

describe('projects', () => {
	it('are visible to members of their organization only', async () => {
		const { db, owner, org, outsider } = await setup();
		const project = await createProject(db, org.id, 'Website');
		expect(project.publicKey).toMatch(/^fp_pub_/);

		expect((await listProjectsForUser(db, owner.id)).map((p) => p.name)).toEqual(['Website']);
		expect(await listProjectsForUser(db, outsider.id)).toEqual([]);
		expect((await getProjectForUser(db, owner.id, project.id))?.role).toBe('owner');
		expect(await getProjectForUser(db, outsider.id, project.id)).toBeNull();
	});

	it('does not leak projects of other organizations', async () => {
		const { db, owner } = await setup();
		const [other] = await db
			.insert(organizations)
			.values({ name: 'Other', slug: 'other' })
			.returning();
		if (!other) throw new Error('no org');
		const hidden = await createProject(db, other.id, 'Hidden');
		expect(await getProjectForUser(db, owner.id, hidden.id)).toBeNull();
	});

	it('rotates keys and deletes', async () => {
		const { db, owner, org } = await setup();
		const project = await createProject(db, org.id, 'Website');
		const key = await rotatePublicKey(db, project.id);
		expect(key).not.toBe(project.publicKey);
		expect((await getProjectForUser(db, owner.id, project.id))?.project.publicKey).toBe(key);
		await deleteProject(db, project.id);
		expect(await getProjectForUser(db, owner.id, project.id)).toBeNull();
	});
});
