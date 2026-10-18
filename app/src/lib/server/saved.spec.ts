import { describe, expect, it } from 'vitest';
import { DEFAULT_FUNNEL, DEFAULT_LIFECYCLE, DEFAULT_PATHS, DEFAULT_TRENDS } from '../insights';
import { dashboardInsights, insights, organizations, users } from './db/schema';
import { createProject, deleteProject } from './projects';
import {
	addToDashboard,
	createDashboard,
	createInsight,
	dashboardItems,
	deleteInsight,
	getInsight,
	listInsights,
	moveOnDashboard,
	parseSavedQuery,
	removeFromDashboard,
	updateInsight
} from './saved';
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

describe('saved insights', () => {
	it('parses stored queries for their kind', () => {
		expect(parseSavedQuery('trends', 'not json')).toEqual({
			kind: 'trends',
			query: DEFAULT_TRENDS
		});
		expect(parseSavedQuery('funnel', '{"steps":["a","b"]}').query).toEqual({
			...DEFAULT_FUNNEL,
			steps: ['a', 'b']
		});
		expect(parseSavedQuery('paths', '{"start":"/pricing","steps":3}')).toEqual({
			kind: 'paths',
			query: { ...DEFAULT_PATHS, start: '/pricing', steps: 3 }
		});
		expect(parseSavedQuery('lifecycle', '[]')).toEqual({
			kind: 'lifecycle',
			query: DEFAULT_LIFECYCLE
		});
	});

	it('are scoped to their project', async () => {
		const { db, user, project, other } = await setup();
		const saved = parseSavedQuery('trends', '{}');
		const insight = await createInsight(db, {
			projectId: project.id,
			name: 'Page views',
			saved,
			userId: user.id
		});
		expect(insight.kind).toBe('trends');
		expect(JSON.parse(insight.query)).toEqual(DEFAULT_TRENDS);
		expect(await getInsight(db, other.id, insight.id)).toBeNull();
		expect(await updateInsight(db, other.id, insight.id, { name: 'x', saved })).toBe(false);
		expect(await updateInsight(db, project.id, insight.id, { name: 'Views', saved })).toBe(true);
		expect((await listInsights(db, project.id)).map((row) => row.name)).toEqual(['Views']);

		await deleteInsight(db, other.id, insight.id);
		expect(await getInsight(db, project.id, insight.id)).not.toBeNull();
		await deleteInsight(db, project.id, insight.id);
		expect(await getInsight(db, project.id, insight.id)).toBeNull();
	});

	it('leave out rows with an unknown kind', async () => {
		const { db, user, project } = await setup();
		const dashboard = await createDashboard(db, project.id, 'Growth');
		const good = await createInsight(db, {
			projectId: project.id,
			name: 'Good',
			saved: parseSavedQuery('trends', '{}'),
			userId: user.id
		});
		const [bad] = await db
			.insert(insights)
			// SQLite accepts any text here, as a hand-edited row would.
			.values({
				projectId: project.id,
				name: 'Bad',
				kind: 'stickiness' as 'trends',
				query: '{}',
				createdBy: user.id
			})
			.returning();
		const flows = await createInsight(db, {
			projectId: project.id,
			name: 'Flows',
			saved: parseSavedQuery('paths', '{"start":"/"}'),
			userId: user.id
		});
		await addToDashboard(db, project.id, dashboard.id, good.id);
		await db.insert(dashboardInsights).values({
			dashboardId: dashboard.id,
			insightId: bad.id,
			position: 1
		});
		await addToDashboard(db, project.id, dashboard.id, flows.id);
		expect((await listInsights(db, project.id)).map((row) => row.name).sort()).toEqual([
			'Flows',
			'Good'
		]);
		expect(await getInsight(db, project.id, bad.id)).toBeNull();
		expect((await dashboardItems(db, dashboard.id)).map((row) => row.insight.name)).toEqual([
			'Good',
			'Flows'
		]);
	});
});

describe('dashboards', () => {
	it('hold insights in order and lose them with the insight or project', async () => {
		const { db, user, project, other } = await setup();
		const saved = parseSavedQuery('trends', '{}');
		const [a, b, c] = await Promise.all(
			['A', 'B', 'C'].map((name) =>
				createInsight(db, { projectId: project.id, name, saved, userId: user.id })
			)
		);
		const dashboard = await createDashboard(db, project.id, 'Growth');
		for (const insight of [a, b, c, a]) {
			expect(await addToDashboard(db, project.id, dashboard.id, insight.id)).toBe(true);
		}
		const names = async () => (await dashboardItems(db, dashboard.id)).map((i) => i.insight.name);
		expect(await names()).toEqual(['A', 'B', 'C']);

		// Nothing crosses projects.
		const foreign = await createInsight(db, {
			projectId: other.id,
			name: 'X',
			saved,
			userId: user.id
		});
		expect(await addToDashboard(db, project.id, dashboard.id, foreign.id)).toBe(false);
		expect(await addToDashboard(db, other.id, dashboard.id, a.id)).toBe(false);

		await moveOnDashboard(db, project.id, dashboard.id, c.id, -1);
		expect(await names()).toEqual(['A', 'C', 'B']);
		await moveOnDashboard(db, project.id, dashboard.id, a.id, -1);
		expect(await names()).toEqual(['A', 'C', 'B']);

		await removeFromDashboard(db, project.id, dashboard.id, c.id);
		expect(await names()).toEqual(['A', 'B']);
		await deleteInsight(db, project.id, b.id);
		expect(await names()).toEqual(['A']);

		await deleteProject(db, project.id);
		expect(await dashboardItems(db, dashboard.id)).toEqual([]);
		expect(await listInsights(db, project.id)).toEqual([]);
	});
});
