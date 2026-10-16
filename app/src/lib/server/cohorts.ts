// Cohort definitions in libSQL. Static members live in ClickHouse (see cohort-people.ts).
import { and, asc, eq } from 'drizzle-orm';
import { type CohortKind, type CohortSpec, parseCohortFilters } from '../cohorts';
import type { PropertyFilter } from '../insights';
import type { Db } from './db/client';
import { type Cohort, cohorts } from './db/schema';

function isCohortKind(value: unknown): value is CohortKind {
	return value === 'static' || value === 'properties';
}

/** What queries need to narrow to a cohort. */
export function cohortSpec(cohort: Cohort): CohortSpec {
	return cohort.kind === 'properties'
		? { kind: 'properties', id: cohort.id, filters: parseCohortFilters(cohort.filters) }
		: { kind: 'static', id: cohort.id };
}

// SQLite doesn't enforce the kind enum; rows with an unknown kind are left out.

export async function listCohorts(db: Db, projectId: string) {
	const rows = await db
		.select()
		.from(cohorts)
		.where(eq(cohorts.projectId, projectId))
		.orderBy(asc(cohorts.name));
	return rows.filter((row) => isCohortKind(row.kind));
}

export async function getCohort(db: Db, projectId: string, cohortId: string) {
	const [row] = await db
		.select()
		.from(cohorts)
		.where(and(eq(cohorts.projectId, projectId), eq(cohorts.id, cohortId)));
	return row && isCohortKind(row.kind) ? row : null;
}

export async function createCohort(
	db: Db,
	values: {
		projectId: string;
		name: string;
		kind: CohortKind;
		filters?: PropertyFilter[];
		userId: string;
	}
) {
	const [row] = await db
		.insert(cohorts)
		.values({
			projectId: values.projectId,
			name: values.name,
			kind: values.kind,
			filters: JSON.stringify(values.kind === 'properties' ? (values.filters ?? []) : []),
			createdBy: values.userId
		})
		.returning();
	return row;
}

/** Renames a cohort and, for a properties cohort, replaces its filters. False when missing. */
export async function updateCohort(
	db: Db,
	projectId: string,
	cohortId: string,
	values: { name: string; filters?: PropertyFilter[] }
): Promise<boolean> {
	const rows = await db
		.update(cohorts)
		.set({
			name: values.name,
			...(values.filters ? { filters: JSON.stringify(values.filters) } : {})
		})
		.where(and(eq(cohorts.projectId, projectId), eq(cohorts.id, cohortId)))
		.returning({ id: cohorts.id });
	return rows.length > 0;
}

export async function deleteCohort(db: Db, projectId: string, cohortId: string) {
	await db.delete(cohorts).where(and(eq(cohorts.projectId, projectId), eq(cohorts.id, cohortId)));
}
