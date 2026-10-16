import { describe, expect, it } from 'vitest';
import { organizations, users } from './db/schema';
import { issueStatuses, setIssueStatus } from './issue-status';
import { createProject } from './projects';
import { createTestDb } from './test-db';

async function setup() {
	const db = await createTestDb();
	const [user] = await db
		.insert(users)
		.values({ email: 'ada@example.com', name: 'Ada' })
		.returning();
	const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
	const project = await createProject(db, org.id, 'Website');
	const other = await createProject(db, org.id, 'App');
	return { db, user, project, other };
}

describe('issue status', () => {
	it('stores one status per issue and project', async () => {
		const { db, user, project, other } = await setup();
		const first = new Date('2026-10-01T00:00:00Z');
		const later = new Date('2026-10-02T00:00:00Z');
		await setIssueStatus(
			db,
			{ projectId: project.id, fingerprint: 'a', status: 'resolved', userId: user.id },
			first
		);
		await setIssueStatus(
			db,
			{ projectId: project.id, fingerprint: 'a', status: 'ignored', userId: user.id },
			later
		);
		await setIssueStatus(
			db,
			{ projectId: other.id, fingerprint: 'a', status: 'resolved', userId: user.id },
			first
		);

		const statuses = await issueStatuses(db, project.id);
		expect([...statuses.keys()]).toEqual(['a']);
		expect(statuses.get('a')).toMatchObject({
			status: 'ignored',
			statusChangedAt: later,
			statusChangedBy: user.id
		});
		expect((await issueStatuses(db, other.id)).get('a')?.status).toBe('resolved');
	});

	it('narrows to fingerprints', async () => {
		const { db, user, project } = await setup();
		for (const fingerprint of ['a', 'b']) {
			await setIssueStatus(db, {
				projectId: project.id,
				fingerprint,
				status: 'resolved',
				userId: user.id
			});
		}
		expect([...(await issueStatuses(db, project.id, ['b', 'c'])).keys()]).toEqual(['b']);
		expect((await issueStatuses(db, project.id, [])).size).toBe(0);
	});
});
