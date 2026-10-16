import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { featureFlags, organizations, projects, users } from './db/schema';
import {
	createFlag,
	deleteFlag,
	flagDefinition,
	flagHistory,
	flagKeyTaken,
	getFlag,
	projectFlags,
	updateFlag
} from './flags';
import { createProject, projectByPublicKey, projectBySecretKey, rotateSecretKey } from './projects';
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

describe('feature flags', () => {
	it('start off, served to everyone once on, at version 1', async () => {
		const { db, user, project } = await setup();
		const row = await createFlag(db, {
			projectId: project.id,
			key: 'new-checkout',
			description: 'The one-page checkout',
			userId: user.id
		});
		expect(row.version).toBe(1);
		expect(flagDefinition(row)).toEqual({
			key: 'new-checkout',
			active: false,
			conditions: [{ filters: [], rollout: 100 }],
			variants: [],
			payloads: {}
		});
		expect(await flagHistory(db, row.id)).toMatchObject([
			{ version: 1, active: false, changedBy: 'Ada' }
		]);
	});

	it('keep every saved version and refuse a stale save', async () => {
		const { db, user, project } = await setup();
		const row = await createFlag(db, {
			projectId: project.id,
			key: 'pricing',
			description: '',
			userId: user.id
		});
		const flag = flagDefinition(row);
		if (!flag) throw new Error('invalid');
		const saved = await updateFlag(db, row, {
			flag: {
				...flag,
				key: 'pricing-page',
				active: true,
				variants: [
					{ key: 'control', rollout: 50 },
					{ key: 'test', rollout: 50 }
				],
				payloads: { test: { price: 9 } }
			},
			description: 'Price test',
			userId: user.id
		});
		expect(saved?.version).toBe(2);
		expect(saved && flagDefinition(saved)).toMatchObject({
			key: 'pricing-page',
			active: true,
			payloads: { test: { price: 9 } }
		});
		// `row` still says version 1, so a second save from it lost the race.
		expect(await updateFlag(db, row, { flag, description: '', userId: user.id })).toBeNull();
		expect((await flagHistory(db, row.id)).map((v) => [v.version, v.active])).toEqual([
			[2, true],
			[1, false]
		]);
	});

	it('are scoped to their project, keys unique within it', async () => {
		const { db, user, project, other } = await setup();
		const row = await createFlag(db, {
			projectId: project.id,
			key: 'beta',
			description: '',
			userId: user.id
		});
		expect(await flagKeyTaken(db, project.id, 'beta')).toBe(true);
		expect(await flagKeyTaken(db, project.id, 'beta', row.id)).toBe(false);
		expect(await flagKeyTaken(db, other.id, 'beta')).toBe(false);
		await expect(
			createFlag(db, { projectId: project.id, key: 'beta', description: '', userId: user.id })
		).rejects.toThrow();
		expect(await getFlag(db, other.id, row.id)).toBeNull();
		await deleteFlag(db, other.id, row.id);
		expect(await getFlag(db, project.id, row.id)).not.toBeNull();
		await deleteFlag(db, project.id, row.id);
		expect(await getFlag(db, project.id, row.id)).toBeNull();
	});

	it('leave out rows that no longer validate', async () => {
		const { db, user, project } = await setup();
		const good = await createFlag(db, {
			projectId: project.id,
			key: 'good',
			description: '',
			userId: user.id
		});
		const bad = await createFlag(db, {
			projectId: project.id,
			key: 'bad',
			description: '',
			userId: user.id
		});
		await db
			.update(featureFlags)
			.set({ definition: '{"variants":[{"key":"a","rollout":10}]}' })
			.where(eq(featureFlags.id, bad.id));
		expect((await projectFlags(db, project.id)).map((f) => f.key)).toEqual([good.key]);
	});
});

describe('project keys', () => {
	it('find a project by its public or secret key', async () => {
		const { db, project, other } = await setup();
		expect(project.secretKey).toMatch(/^fp_sec_[0-9a-f]{32}$/);
		expect((await projectBySecretKey(db, project.secretKey ?? ''))?.id).toBe(project.id);
		expect((await projectByPublicKey(db, other.publicKey))?.id).toBe(other.id);
		expect(await projectBySecretKey(db, project.publicKey)).toBeNull();
		expect(await projectBySecretKey(db, 'fp_sec_nope')).toBeNull();

		const rotated = await rotateSecretKey(db, project.id);
		expect(await projectBySecretKey(db, project.secretKey ?? '')).toBeNull();
		expect((await projectBySecretKey(db, rotated))?.id).toBe(project.id);
	});

	it('are backfilled for projects created before secret keys', async () => {
		const { db, project } = await setup();
		await db.update(projects).set({ secretKey: null }).where(eq(projects.id, project.id));
		// Re-runs the backfill from the migration that added secret keys.
		const migration = await readFile(
			resolve(import.meta.dirname, '../../../drizzle/0005_flags.sql'),
			'utf8'
		);
		const backfill = migration
			.split('--> statement-breakpoint')
			.find((s) => s.includes('UPDATE `projects`'));
		if (!backfill) throw new Error('no backfill in the migration');
		await db.run(sql.raw(backfill));
		const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
		expect(row?.secretKey).toMatch(/^fp_sec_[0-9a-f]{32}$/);
	});
});
