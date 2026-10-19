// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiOverview, listTraces } from './ai';
import type { ClickHouseConfig } from './clickhouse';
import { clickhouseQuery } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents
} from './clickhouse-test';
import { experiments, featureFlags, insights, organizations, users } from './db/schema';
import { experimentCounts } from './experiment-results';
import { listGroups } from './groups';
import { lifecycle, paths } from './insights';
import { listIssues } from './issues';
import { addMockData, MOCK_FLAGS, MOCK_INSIGHTS, removeMockData } from './mock-data';
import { createProject } from './projects';
import { createTestDb } from './test-db';
import { webAnalytics, webVitals } from './web';

const now = new Date(Date.UTC(2026, 9, 16, 12, 0));
let config: ClickHouseConfig;

async function count(projectId: string) {
	const body = await clickhouseQuery(
		config,
		'SELECT count() FROM events WHERE project_id = {project:UUID}',
		{ params: { project: projectId } }
	);
	return Number(body.trim());
}

describe.skipIf(!clickhouseTestUrl)('mock data', () => {
	beforeAll(async () => {
		config = await createTestDatabase('mock');
	});
	afterAll(() => dropTestDatabase(config));

	// Generating and inserting a month of events twice takes a few seconds.
	it('fills every area, replaces itself when added again, and removes only itself', async () => {
		const db = await createTestDb();
		const [user] = await db
			.insert(users)
			.values({ email: 'ada@example.com', name: 'Ada' })
			.returning();
		const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
		const project = await createProject(db, org.id, 'Website');
		await insertEvents(
			config,
			[{ projectId: project.id, distinctId: 'real', event: '$pageview', minutesAgo: 5 }],
			now.getTime()
		);

		const added = await addMockData(db, config, project.id, user.id, now);
		expect(added).toBeGreaterThan(5000);
		expect(await count(project.id)).toBe(added + 1);

		const web = await webAnalytics(config, project.id, { range: '30d', now });
		expect(web.overview.visitors).toBeGreaterThan(100);
		expect(web.breakdowns.referrer.length).toBeGreaterThan(3);
		expect(web.breakdowns.country.length).toBeGreaterThan(3);

		const vitals = await webVitals(config, project.id, { range: '30d', now });
		expect(vitals.vitals.LCP.samples).toBeGreaterThan(100);
		expect(vitals.vitals.INP.p75).toBeGreaterThan(0);
		expect(vitals.paths.length).toBeGreaterThan(3);

		const issues = await listIssues(config, project.id, { range: '30d', now });
		expect(issues.issues.length).toBeGreaterThanOrEqual(5);

		const ai = await aiOverview(config, project.id, { range: '30d', now });
		expect(ai.totals.traces).toBeGreaterThan(20);
		expect(ai.totals.cost).toBeGreaterThan(0);
		expect(ai.scores.map((s) => s.name).sort()).toEqual(['accuracy', 'thumbs']);
		expect(ai.modelScores.length).toBeGreaterThan(2);
		expect((await listTraces(config, project.id, { range: '30d', now })).length).toBeGreaterThan(0);

		// The saved paths and lifecycle insights have something to show.
		const flows = await paths(
			config,
			project.id,
			{ label: 'page', start: '/', steps: 4, range: '30d', filters: [] },
			now
		);
		expect(flows.sessions).toBeGreaterThan(50);
		expect(flows.steps.length).toBeGreaterThan(2);
		expect(flows.steps[1].nodes.length).toBeGreaterThan(3);
		const states = await lifecycle(
			config,
			project.id,
			{ event: '$pageview', interval: 'week', range: '30d', filters: [] },
			now
		);
		for (const status of ['new', 'returning', 'resurrecting', 'dormant'] as const) {
			expect(states.counts[status].some((v) => v !== 0)).toBe(true);
		}

		const groups = await listGroups(config, project.id, 'company', { now });
		expect(groups.groups.length).toBe(10);

		const [experiment] = await db
			.select()
			.from(experiments)
			.where(eq(experiments.projectId, project.id));
		expect(experiment?.status).toBe('running');
		const results = await experimentCounts(config, project.id, {
			flag: 'pricing-page-redesign',
			variants: ['control', 'redesign'],
			metrics: [{ kind: 'conversion', event: 'signed_up' }],
			from: experiment?.startedAt ?? now,
			to: now
		});
		expect(results.every((r) => r.people > 10)).toBe(true);

		// Again: definitions aren't duplicated and old mock events are replaced.
		const again = await addMockData(db, config, project.id, user.id, now);
		expect(await count(project.id)).toBe(again + 1);
		expect(await db.select().from(featureFlags)).toHaveLength(MOCK_FLAGS.length);
		expect(await db.select().from(insights)).toHaveLength(MOCK_INSIGHTS.length);

		await removeMockData(db, config, project.id);
		expect(await count(project.id)).toBe(1);
		expect(await db.select().from(featureFlags)).toHaveLength(0);
		// A month of events, written twice, and every area queried: more than the default 5 seconds
		// on a busy machine.
	}, 30_000);
});
