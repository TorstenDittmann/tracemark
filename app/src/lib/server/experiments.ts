// Experiment definitions in libSQL. Results come from ClickHouse (see experiment-results.ts).
import { and, desc, eq } from 'drizzle-orm';
import type { ExperimentMetric } from '../experiments';
import type { Db } from './db/client';
import { type Experiment, experiments, featureFlags } from './db/schema';

export async function listExperiments(db: Db, projectId: string) {
	return db
		.select({ experiment: experiments, flagKey: featureFlags.key })
		.from(experiments)
		.innerJoin(featureFlags, eq(featureFlags.id, experiments.flagId))
		.where(eq(experiments.projectId, projectId))
		.orderBy(desc(experiments.createdAt));
}

export async function getExperiment(db: Db, projectId: string, experimentId: string) {
	const [row] = await db
		.select()
		.from(experiments)
		.where(and(eq(experiments.projectId, projectId), eq(experiments.id, experimentId)));
	return row ?? null;
}

export async function createExperiment(
	db: Db,
	values: { projectId: string; flagId: string; name: string; description: string; userId: string }
) {
	const [row] = await db
		.insert(experiments)
		.values({
			projectId: values.projectId,
			flagId: values.flagId,
			name: values.name,
			description: values.description,
			createdBy: values.userId
		})
		.returning();
	if (!row) throw new Error('failed to create experiment');
	return row;
}

export async function updateExperiment(
	db: Db,
	row: Experiment,
	values: { name: string; description: string; metrics: ExperimentMetric[] }
) {
	await db
		.update(experiments)
		.set({
			name: values.name,
			description: values.description,
			metrics: JSON.stringify(values.metrics)
		})
		.where(eq(experiments.id, row.id));
}

/** Starts collecting results from now. Only a draft can be launched. */
export async function launchExperiment(db: Db, row: Experiment, now = new Date()) {
	const updated = await db
		.update(experiments)
		.set({ status: 'running', startedAt: now, endedAt: null })
		.where(and(eq(experiments.id, row.id), eq(experiments.status, 'draft')))
		.returning({ id: experiments.id });
	return updated.length > 0;
}

/** Freezes the results window at now. Only a running experiment can be stopped. */
export async function stopExperiment(db: Db, row: Experiment, now = new Date()) {
	const updated = await db
		.update(experiments)
		.set({ status: 'complete', endedAt: now })
		.where(and(eq(experiments.id, row.id), eq(experiments.status, 'running')))
		.returning({ id: experiments.id });
	return updated.length > 0;
}

export async function deleteExperiment(db: Db, projectId: string, experimentId: string) {
	await db
		.delete(experiments)
		.where(and(eq(experiments.projectId, projectId), eq(experiments.id, experimentId)));
}
