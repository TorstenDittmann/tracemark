// Feature flag definitions in libSQL, with every saved state kept in `flag_versions`.
import { type FlagDefinition, parseFlag } from '@tracemark/flags';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { type FeatureFlag, featureFlags, flagVersions, users } from './db/schema';

/** What a new flag starts as: off, and once turned on, served to everyone. */
export const NEW_FLAG_RULES = {
	conditions: [{ filters: [], rollout: 100 }],
	variants: [],
	payloads: {}
} satisfies Omit<FlagDefinition, 'key' | 'active'>;

/** The flag a row describes, or null if its stored definition no longer validates. */
export function flagDefinition(row: FeatureFlag): FlagDefinition | null {
	try {
		return parseFlag({ ...JSON.parse(row.definition), key: row.key, active: row.active });
	} catch {
		return null;
	}
}

/** Everything but the key and active state, as stored in `definition`. */
function stored(flag: FlagDefinition): string {
	const { key: _key, active: _active, ...rest } = flag;
	return JSON.stringify(rest);
}

export async function listFlags(db: Db, projectId: string) {
	return db
		.select()
		.from(featureFlags)
		.where(eq(featureFlags.projectId, projectId))
		.orderBy(asc(featureFlags.key));
}

/** Definitions of a project's flags, for evaluation. Rows that don't validate are left out. */
export async function projectFlags(db: Db, projectId: string): Promise<FlagDefinition[]> {
	return (await listFlags(db, projectId))
		.map(flagDefinition)
		.filter((flag): flag is FlagDefinition => flag !== null);
}

export async function getFlag(db: Db, projectId: string, flagId: string) {
	const [row] = await db
		.select()
		.from(featureFlags)
		.where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.id, flagId)));
	return row ?? null;
}

export async function flagKeyTaken(db: Db, projectId: string, key: string, exceptId?: string) {
	const [row] = await db
		.select({ id: featureFlags.id })
		.from(featureFlags)
		.where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.key, key)));
	return row !== undefined && row.id !== exceptId;
}

export async function createFlag(
	db: Db,
	values: { projectId: string; key: string; description: string; userId: string }
) {
	const flag = parseFlag({ key: values.key, active: false, ...NEW_FLAG_RULES });
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(featureFlags)
			.values({
				projectId: values.projectId,
				key: flag.key,
				description: values.description,
				active: false,
				definition: stored(flag),
				createdBy: values.userId
			})
			.returning();
		if (!row) throw new Error('failed to create flag');
		await tx.insert(flagVersions).values({
			flagId: row.id,
			version: row.version,
			description: row.description,
			active: row.active,
			definition: row.definition,
			changedBy: values.userId
		});
		return row;
	});
}

/** Saves a new state of a flag and records it as the next version. */
export async function updateFlag(
	db: Db,
	row: FeatureFlag,
	values: { flag: FlagDefinition; description: string; userId: string }
) {
	const definition = stored(values.flag);
	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(featureFlags)
			.set({
				key: values.flag.key,
				description: values.description,
				active: values.flag.active,
				definition,
				version: row.version + 1
			})
			.where(and(eq(featureFlags.id, row.id), eq(featureFlags.version, row.version)))
			.returning();
		// Someone else saved first; the caller reloads and tries again.
		if (!updated) return null;
		await tx.insert(flagVersions).values({
			flagId: row.id,
			version: updated.version,
			description: updated.description,
			active: updated.active,
			definition,
			changedBy: values.userId
		});
		return updated;
	});
}

/** The latest saved states of a flag, newest first, with who saved each. */
export async function flagHistory(db: Db, flagId: string, limit = 20) {
	return db
		.select({
			version: flagVersions.version,
			active: flagVersions.active,
			description: flagVersions.description,
			definition: flagVersions.definition,
			createdAt: flagVersions.createdAt,
			changedBy: users.name
		})
		.from(flagVersions)
		.leftJoin(users, eq(users.id, flagVersions.changedBy))
		.where(eq(flagVersions.flagId, flagId))
		.orderBy(desc(flagVersions.version))
		.limit(limit);
}

export async function deleteFlag(db: Db, projectId: string, flagId: string) {
	await db
		.delete(featureFlags)
		.where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.id, flagId)));
}
