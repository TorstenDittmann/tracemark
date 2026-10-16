import { describe, expect, it } from 'vitest';
import {
	cohortSpec,
	createCohort,
	deleteCohort,
	getCohort,
	listCohorts,
	updateCohort
} from './cohorts';
import { cohorts, organizations, users } from './db/schema';
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

describe('cohorts', () => {
	it('are scoped to their project', async () => {
		const { db, user, project, other } = await setup();
		const filters = [{ property: 'plan', operator: 'eq' as const, value: 'pro' }];
		const pro = await createCohort(db, {
			projectId: project.id,
			name: 'Pro',
			kind: 'properties',
			filters,
			userId: user.id
		});
		expect(cohortSpec(pro)).toEqual({ kind: 'properties', id: pro.id, filters });
		expect(await getCohort(db, other.id, pro.id)).toBeNull();
		expect(await updateCohort(db, other.id, pro.id, { name: 'x' })).toBe(false);
		expect(await updateCohort(db, project.id, pro.id, { name: 'Paying', filters: [] })).toBe(true);
		const updated = await getCohort(db, project.id, pro.id);
		expect(updated && cohortSpec(updated)).toEqual({ kind: 'properties', id: pro.id, filters: [] });

		await deleteCohort(db, other.id, pro.id);
		expect(await getCohort(db, project.id, pro.id)).not.toBeNull();
		await deleteCohort(db, project.id, pro.id);
		expect(await getCohort(db, project.id, pro.id)).toBeNull();
	});

	it('keep no filters on a static list and skip unknown kinds', async () => {
		const { db, user, project } = await setup();
		const list = await createCohort(db, {
			projectId: project.id,
			name: 'Beta testers',
			kind: 'static',
			filters: [{ property: 'plan', operator: 'is_set' }],
			userId: user.id
		});
		expect(list.filters).toBe('[]');
		expect(cohortSpec(list)).toEqual({ kind: 'static', id: list.id });
		await db.insert(cohorts).values({
			projectId: project.id,
			name: 'Odd',
			kind: 'behavioral' as 'static',
			createdBy: user.id
		});
		expect((await listCohorts(db, project.id)).map((c) => c.name)).toEqual(['Beta testers']);
	});
});
