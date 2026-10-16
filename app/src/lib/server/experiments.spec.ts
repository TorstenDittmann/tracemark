import { describe, expect, it } from 'vitest';
import { organizations, users } from './db/schema';
import {
	createExperiment,
	deleteExperiment,
	getExperiment,
	launchExperiment,
	listExperiments,
	stopExperiment,
	updateExperiment
} from './experiments';
import { createFlag, deleteFlag } from './flags';
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
	const flag = await createFlag(db, {
		projectId: project.id,
		key: 'pricing',
		description: '',
		userId: user.id
	});
	const experiment = await createExperiment(db, {
		projectId: project.id,
		flagId: flag.id,
		name: 'Pricing page',
		description: '',
		userId: user.id
	});
	return { db, user, project, other, flag, experiment };
}

describe('experiments', () => {
	it('start as drafts without metrics and list with their flag', async () => {
		const { db, project, other, experiment } = await setup();
		expect(experiment.status).toBe('draft');
		expect(experiment.metrics).toBe('[]');
		expect(experiment.startedAt).toBeNull();
		const list = await listExperiments(db, project.id);
		expect(list.map((row) => [row.experiment.name, row.flagKey])).toEqual([
			['Pricing page', 'pricing']
		]);
		expect(await listExperiments(db, other.id)).toEqual([]);
		expect(await getExperiment(db, other.id, experiment.id)).toBeNull();
	});

	it('save their name and metrics', async () => {
		const { db, project, experiment } = await setup();
		await updateExperiment(db, experiment, {
			name: 'Cheaper plans',
			description: 'Does a lower price sell more?',
			metrics: [{ kind: 'conversion', event: 'purchase' }]
		});
		const row = await getExperiment(db, project.id, experiment.id);
		expect(row?.name).toBe('Cheaper plans');
		expect(JSON.parse(row?.metrics ?? '')).toEqual([{ kind: 'conversion', event: 'purchase' }]);
	});

	it('launch once from a draft and stop once while running', async () => {
		const { db, project, experiment } = await setup();
		const start = new Date(Date.UTC(2026, 9, 1));
		const end = new Date(Date.UTC(2026, 9, 15));
		expect(await stopExperiment(db, experiment, end)).toBe(false);
		expect(await launchExperiment(db, experiment, start)).toBe(true);
		expect(await launchExperiment(db, experiment, end)).toBe(false);
		let row = await getExperiment(db, project.id, experiment.id);
		expect([row?.status, row?.startedAt, row?.endedAt]).toEqual(['running', start, null]);
		expect(await stopExperiment(db, experiment, end)).toBe(true);
		row = await getExperiment(db, project.id, experiment.id);
		expect([row?.status, row?.startedAt, row?.endedAt]).toEqual(['complete', start, end]);
	});

	it('go away with their flag or on their own', async () => {
		const { db, user, project, flag, experiment } = await setup();
		const second = await createExperiment(db, {
			projectId: project.id,
			flagId: flag.id,
			name: 'Second run',
			description: '',
			userId: user.id
		});
		await deleteExperiment(db, project.id, second.id);
		expect((await listExperiments(db, project.id)).map((row) => row.experiment.id)).toEqual([
			experiment.id
		]);
		await deleteFlag(db, project.id, flag.id);
		expect(await listExperiments(db, project.id)).toEqual([]);
	});
});
